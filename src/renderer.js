import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  decodeFeatureGeometry,
  getLabelAnchor,
  getLineLength,
  getPolygonArea,
} from "./geometry.js";
import {
  buildFeatureClasses,
  getLayerOrder,
  getNatureTextStyle,
  getSourceLayerNames,
  isFeatureAllowedForLayer,
  normalizeRoadClass,
  getStyleForFeature,
  getTextStyleForLayer,
  isSupportedLayer,
} from "./styles.js";
import {
  buildSvgDocument,
  lineToPathData,
  renderGeometryElements,
  renderRailwayElements,
  renderLabelElement,
  renderLineLabelElement,
} from "./svg.js";

function decodeVectorTile(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new VectorTile(new PbfReader(bytes));
}

function getFeatureLabel(properties = {}) {
  const candidates = [
    properties.name,
    properties.name_de,
    properties["name:de"],
    properties.name_en,
    properties["name:en"],
    properties.name_int,
    properties.ref,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function pickLongestLine(lines) {
  let best = [];
  let bestLength = 0;
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) continue;
    const length = getLineLength(line);
    if (length > bestLength) {
      best = line;
      bestLength = length;
    }
  }
  return bestLength > 12 ? best : [];
}

function shouldRenderRoadLabelByZoom(roadClass, zoom) {
  if (roadClass === "rail") return false;
  if (!Number.isInteger(zoom) || zoom < 13) return true;
  return roadClass === "motorway" || roadClass === "trunk" || roadClass === "primary";
}

function shouldRenderWaterLabel(properties, geometry, zoom) {
  if (!Number.isInteger(zoom) || zoom < 6) return false;
  if (!geometry) return false;
  const waterClass = String(properties.class ?? "").toLowerCase();
  const isRiverLike =
    waterClass.includes("river") ||
    waterClass.includes("stream") ||
    waterClass.includes("canal");

  if (geometry.kind === "LineString") {
    const longest = pickLongestLine(geometry.lines);
    const length = getLineLength(longest);
    if (isRiverLike) {
      return zoom >= 12 && length >= 48;
    }
    return length >= 34;
  }

  if (geometry.kind === "Polygon") {
    const area = getPolygonArea(geometry.rings);
    return area >= 120;
  }

  return true;
}

function shouldRenderNatureAreaLabel(geometry, zoom) {
  if (!Number.isInteger(zoom) || zoom < 10) return false;
  if (!geometry) return false;
  if (geometry.kind === "Polygon") {
    return getPolygonArea(geometry.rings) >= 120;
  }
  if (geometry.kind === "LineString") {
    const longest = pickLongestLine(geometry.lines);
    return getLineLength(longest) >= 48;
  }
  return true;
}

function appendToGroup(groups, layerName, fragment) {
  if (!fragment) return;
  const existing = groups.get(layerName) ?? "";
  groups.set(layerName, `${existing}${fragment}`);
}

function normalizeLabelText(text) {
  return String(text).trim().toLowerCase().replace(/\s+/g, " ");
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

function isNatureLabelOwner(dedupKey, tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) return true;
  const hash = hashString(dedupKey);
  const ownerParityX = hash & 1;
  const ownerParityY = (hash >> 1) & 1;
  return (tileX & 1) === ownerParityX && (tileY & 1) === ownerParityY;
}

function buildNatureDedupKey(theme, labelText, anchor, tileX, tileY) {
  const normalized = normalizeLabelText(labelText);
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return `${theme}|${normalized}`;
  }
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    const localBucketX = Math.floor(anchor.x / 64);
    const localBucketY = Math.floor(anchor.y / 64);
    return `${theme}|${normalized}|${localBucketX}|${localBucketY}`;
  }
  const globalX = tileX * 256 + anchor.x;
  const globalY = tileY * 256 + anchor.y;
  const bucketX = Math.floor(globalX / 96);
  const bucketY = Math.floor(globalY / 96);
  return `${theme}|${normalized}|${bucketX}|${bucketY}`;
}

function renderNatureLabels(tile, groups, zoomLevel, tileX, tileY) {
  const waterTextStyle = getNatureTextStyle("water");
  const natureTextStyle = getNatureTextStyle("nature");
  if (!waterTextStyle && !natureTextStyle) return;

  const seen = new Set();
  const labelConfigs = [
    {
      sourceLayers: ["water_name"],
      targetGroup: "water",
      theme: "water",
      style: waterTextStyle,
      canRender: (properties, geometry) => shouldRenderWaterLabel(properties, geometry, zoomLevel),
      lineLabels: true,
    },
    {
      sourceLayers: ["waterway"],
      targetGroup: "water",
      theme: "water",
      style: waterTextStyle,
      canRender: (properties, geometry) => shouldRenderWaterLabel(properties, geometry, zoomLevel),
      lineLabels: true,
    },
    {
      sourceLayers: ["park"],
      targetGroup: "landuse",
      theme: "nature",
      style: natureTextStyle,
      canRender: (_, geometry) => shouldRenderNatureAreaLabel(geometry, zoomLevel),
      lineLabels: false,
    },
  ];

  let labelId = 0;
  for (const config of labelConfigs) {
    if (!config.style) continue;
    for (const sourceLayerName of config.sourceLayers) {
      const layer = tile.layers[sourceLayerName];
      if (!layer) continue;
      const extent = layer.extent || 4096;
      for (let i = 0; i < layer.length; i += 1) {
        const feature = layer.feature(i);
        const geometry = decodeFeatureGeometry(feature, extent);
        if (!geometry) continue;
        const labelText = getFeatureLabel(feature.properties);
        if (!labelText) continue;
        if (!config.canRender(feature.properties ?? {}, geometry)) continue;

        const className = buildFeatureClasses(config.targetGroup, feature.properties);
        if (config.lineLabels && geometry.kind === "LineString") {
          const longestLine = pickLongestLine(geometry.lines);
          if (longestLine.length < 2) continue;
          const pathData = lineToPathData(longestLine);
          if (!pathData) continue;
          const anchor = longestLine[Math.floor(longestLine.length / 2)];
          const ownershipKey = buildNatureDedupKey(
            config.theme,
            labelText,
            anchor,
            tileX,
            tileY
          );
          if (!isNatureLabelOwner(ownershipKey, tileX, tileY)) continue;
          const dedupKey = `${config.targetGroup}|${labelText}|${pathData}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          labelId += 1;
          const labelPathId = `nature-label-${labelId}`;
          const label = renderLineLabelElement(
            labelPathId,
            pathData,
            labelText,
            className ? `${className} nature-label` : "nature-label",
            config.style
          );
          appendToGroup(groups, config.targetGroup, label);
          continue;
        }

        const anchor = getLabelAnchor(geometry);
        const ownershipKey = buildNatureDedupKey(
          config.theme,
          labelText,
          anchor,
          tileX,
          tileY
        );
        if (!isNatureLabelOwner(ownershipKey, tileX, tileY)) continue;
        const dedupKey = `${config.targetGroup}|${labelText}|${anchor?.x ?? 0}|${anchor?.y ?? 0}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const label = renderLabelElement(
          anchor,
          labelText,
          className ? `${className} nature-label` : "nature-label",
          config.style
        );
        appendToGroup(groups, config.targetGroup, label);
      }
    }
  }
}

export function renderTileToSvg(tileBuffer, options = {}) {
  if (!tileBuffer || tileBuffer.byteLength === 0) return null;

  let tile;
  try {
    tile = decodeVectorTile(tileBuffer);
  } catch {
    return null;
  }

  const groups = new Map();
  const renderLabels = Boolean(options.labels);
  const renderRoadLabels = Boolean(options.roadLabels);
  const renderNatureLabelsEnabled = Boolean(options.natureLabels);
  const zoomLevel = Number.isInteger(options.zoom) ? options.zoom : undefined;
  const tileX = Number.isInteger(options.tileX) ? options.tileX : undefined;
  const tileY = Number.isInteger(options.tileY) ? options.tileY : undefined;
  let roadLabelId = 0;

  for (const layerName of getLayerOrder()) {
    if (!isSupportedLayer(layerName)) continue;
    const fragments = [];
    for (const sourceLayerName of getSourceLayerNames(layerName)) {
      const layer = tile.layers[sourceLayerName];
      if (!layer) continue;
      const layerExtent = layer.extent || 4096;

      for (let i = 0; i < layer.length; i += 1) {
        const feature = layer.feature(i);
        const geometry = decodeFeatureGeometry(feature, layerExtent);
        if (!geometry) continue;
        if (!isFeatureAllowedForLayer(layerName, feature.properties)) continue;

        const className = buildFeatureClasses(layerName, feature.properties);
        const style = getStyleForFeature(layerName, geometry.kind, feature.properties);
        if (!style) continue;

        if (layerName === "railways") {
          fragments.push(...renderRailwayElements(geometry, style, className));
        } else {
          fragments.push(...renderGeometryElements(geometry, style, className));
        }

        const labelText = getFeatureLabel(feature.properties);
        if (renderLabels && labelText) {
          const textStyle = getTextStyleForLayer(layerName);
          if (!textStyle) continue;
          const anchor = getLabelAnchor(geometry);
          const text = renderLabelElement(anchor, labelText, className, textStyle);
          if (text) fragments.push(text);
        }

      }
    }

    if (layerName === "roads" && renderRoadLabels) {
      const seenRoadLabels = new Set();
      for (const roadNameLayerName of [
        "transportation_name",
        "road_name",
        "roads",
        "transportation",
      ]) {
        const roadNameLayer = tile.layers[roadNameLayerName];
        if (!roadNameLayer) continue;
        const layerExtent = roadNameLayer.extent || 4096;
        for (let i = 0; i < roadNameLayer.length; i += 1) {
          const feature = roadNameLayer.feature(i);
          const geometry = decodeFeatureGeometry(feature, layerExtent);
          if (!geometry || geometry.kind !== "LineString") continue;
          const labelText = getFeatureLabel(feature.properties);
          if (!labelText) continue;
          const roadClass = normalizeRoadClass(feature.properties);
          if (!shouldRenderRoadLabelByZoom(roadClass, zoomLevel)) continue;
          const className = buildFeatureClasses("roads", feature.properties);
          const textStyle = getTextStyleForLayer("roads");
          if (!textStyle) continue;
          const longestLine = pickLongestLine(geometry.lines);
          if (longestLine.length < 2) continue;
          const pathData = lineToPathData(longestLine);
          if (!pathData) continue;
          const dedupKey = `${labelText}|${pathData}`;
          if (seenRoadLabels.has(dedupKey)) continue;
          seenRoadLabels.add(dedupKey);
          roadLabelId += 1;
          const labelPathId = `road-label-${roadLabelId}`;
          const label = renderLineLabelElement(
            labelPathId,
            pathData,
            labelText,
            className,
            textStyle
          );
          if (label) fragments.push(label);
        }
      }
    }

    if (fragments.length > 0) {
      groups.set(layerName, fragments.join(""));
    }
  }

  if (renderNatureLabelsEnabled) {
    renderNatureLabels(tile, groups, zoomLevel, tileX, tileY);
  }

  return buildSvgDocument(groups);
}
