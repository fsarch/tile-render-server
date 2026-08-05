import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  decodeFeatureGeometry,
  getLabelAnchor,
  getLineLength,
  getPolygonArea,
  type LineStringGeometry,
  type NormalizedGeometry,
} from "./geometry.js";
import {
  buildFeatureClasses,
  getLayerOrder,
  getNatureTextStyle,
  getRailSleeperStyle,
  getSourceLayerNames,
  getStyleForFeature,
  getTextStyleForFeature,
  getTextStyleForLayer,
  isFeatureAllowedForLayer,
  isSupportedLayer,
  normalizeRoadClass,
  type SvgStyle,
} from "./styles.js";
import {
  buildSvgDocument,
  lineToPathData,
  renderGeometryElements,
  renderLabelElement,
  renderLineLabelElement,
  renderRailwayElements,
} from "./svg.js";

export interface RenderOptions {
  labels?: boolean;
  roadLabels?: boolean;
  natureLabels?: boolean;
  zoom?: number;
  tileX?: number;
  tileY?: number;
}

type FeatureProps = Record<string, unknown>;

function decodeVectorTile(buffer: ArrayBuffer | Uint8Array): VectorTile {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new VectorTile(new PbfReader(bytes));
}

function getFeatureLabel(properties: FeatureProps = {}): string | null {
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

function pickLongestLine(lines: LineStringGeometry["lines"]): LineStringGeometry["lines"][number] {
  let best: LineStringGeometry["lines"][number] = [];
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

function shouldRenderRoadLabelByZoom(roadClass: string, zoom?: number): boolean {
  if (roadClass === "rail") return false;
  if (!Number.isInteger(zoom) || (zoom ?? 0) < 13) return true;
  return roadClass === "motorway" || roadClass === "trunk" || roadClass === "primary";
}

function shouldRenderWaterLabel(
  properties: FeatureProps,
  geometry: NormalizedGeometry,
  zoom?: number
): boolean {
  if (!Number.isInteger(zoom) || (zoom ?? 0) < 6) return false;
  const waterClass = String(properties.class ?? "").toLowerCase();
  const isRiverLike =
    waterClass.includes("river") ||
    waterClass.includes("stream") ||
    waterClass.includes("canal");

  if (geometry.kind === "LineString") {
    const longest = pickLongestLine(geometry.lines);
    const length = getLineLength(longest);
    if (isRiverLike) {
      return (zoom ?? 0) >= 12 && length >= 48;
    }
    return length >= 34;
  }

  if (geometry.kind === "Polygon") {
    return getPolygonArea(geometry.rings) >= 120;
  }

  return true;
}

function shouldRenderNatureAreaLabel(geometry: NormalizedGeometry, zoom?: number): boolean {
  if (!Number.isInteger(zoom) || (zoom ?? 0) < 10) return false;
  if (geometry.kind === "Polygon") {
    return getPolygonArea(geometry.rings) >= 120;
  }
  if (geometry.kind === "LineString") {
    const longest = pickLongestLine(geometry.lines);
    return getLineLength(longest) >= 48;
  }
  return true;
}

function normalizeLabelText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
}

function isNatureLabelOwner(dedupKey: string, tileX?: number, tileY?: number): boolean {
  const tx = Number.isInteger(tileX) ? tileX : undefined;
  const ty = Number.isInteger(tileY) ? tileY : undefined;
  if (tx === undefined || ty === undefined) return true;
  const hash = hashString(dedupKey);
  const ownerParityX = hash & 1;
  const ownerParityY = (hash >> 1) & 1;
  return (tx & 1) === ownerParityX && (ty & 1) === ownerParityY;
}

function buildNatureDedupKey(
  theme: "water" | "nature",
  labelText: string,
  anchor: { x: number; y: number } | null,
  tileX?: number,
  tileY?: number
): string {
  const normalized = normalizeLabelText(labelText);
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    return `${theme}|${normalized}`;
  }
  const tx = Number.isInteger(tileX) ? tileX : undefined;
  const ty = Number.isInteger(tileY) ? tileY : undefined;
  if (tx === undefined || ty === undefined) {
    return `${theme}|${normalized}|${Math.floor(anchor.x / 64)}|${Math.floor(anchor.y / 64)}`;
  }
  const globalX = tx * 256 + anchor.x;
  const globalY = ty * 256 + anchor.y;
  return `${theme}|${normalized}|${Math.floor(globalX / 96)}|${Math.floor(globalY / 96)}`;
}

function renderNatureLabels(
  tile: VectorTile,
  labelFragments: string[],
  zoomLevel: number | undefined,
  tileX: number | undefined,
  tileY: number | undefined
): void {
  const waterTextStyle = getNatureTextStyle("water");
  const natureTextStyle = getNatureTextStyle("nature");
  if (!waterTextStyle && !natureTextStyle) return;

  const seen = new Set<string>();
  const labelConfigs: Array<{
    sourceLayers: string[];
    targetGroup: "water" | "landuse";
    theme: "water" | "nature";
    style: SvgStyle | null;
    canRender: (properties: FeatureProps, geometry: NormalizedGeometry) => boolean;
    lineLabels: boolean;
  }> = [
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
        const labelText = getFeatureLabel(feature.properties as FeatureProps);
        if (!labelText) continue;
        if (!config.canRender((feature.properties ?? {}) as FeatureProps, geometry)) continue;

        const className = buildFeatureClasses(config.targetGroup, (feature.properties ?? {}) as FeatureProps);
        if (config.lineLabels && geometry.kind === "LineString") {
          const longestLine = pickLongestLine(geometry.lines);
          if (longestLine.length < 2) continue;
          const pathData = lineToPathData(longestLine);
          if (!pathData) continue;
          const anchor = longestLine[Math.floor(longestLine.length / 2)] ?? null;
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
          const label = renderLineLabelElement(
            `nature-label-${labelId}`,
            pathData,
            labelText,
            className ? `${className} nature-label` : "nature-label",
            config.style
          );
          if (label) labelFragments.push(label);
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
        if (label) labelFragments.push(label);
      }
    }
  }
}

function renderLayerFeatures(
  groups: Map<string, string>,
  tile: VectorTile,
  layerName: ReturnType<typeof getLayerOrder>[number],
  renderLabels: boolean,
  zoomLevel: number | undefined,
  labelFragments: string[]
): void {
  const fragments: string[] = [];
  for (const sourceLayerName of getSourceLayerNames(layerName)) {
    const layer: VectorTileLayer | undefined = tile.layers[sourceLayerName];
    if (!layer) continue;
    const layerExtent = layer.extent || 4096;

    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      const properties = (feature.properties ?? {}) as FeatureProps;
      const geometry = decodeFeatureGeometry(feature, layerExtent);
      if (!geometry) continue;
      if (!isFeatureAllowedForLayer(layerName, properties)) continue;
      const labelText = getFeatureLabel(properties);
      const textStyle =
        renderLabels && labelText ? getTextStyleForFeature(layerName, properties, zoomLevel) : null;
      const hidePlacePoint =
        layerName === "places" &&
        geometry.kind === "Point" &&
        (!renderLabels || !labelText || !textStyle);
      if (hidePlacePoint) continue;

      const className = buildFeatureClasses(layerName, properties);
      const style = getStyleForFeature(layerName, geometry.kind, properties);
      if (!style) continue;

      if (layerName === "railways") {
        fragments.push(...renderRailwayElements(geometry, style, getRailSleeperStyle(), className));
      } else {
        fragments.push(...renderGeometryElements(geometry, style, className));
      }

      if (renderLabels && labelText && textStyle) {
        const anchor = getLabelAnchor(geometry);
        const text = renderLabelElement(anchor, labelText, className, textStyle);
        if (text) labelFragments.push(text);
      }
    }
  }

  if (fragments.length > 0) {
    groups.set(layerName, fragments.join(""));
  }
}

function renderRoadLabels(
  tile: VectorTile,
  labelFragments: string[],
  zoomLevel: number | undefined
): void {
  const seenRoadLabels = new Set<string>();
  let roadLabelId = 0;
  for (const roadNameLayerName of ["transportation_name", "road_name", "roads", "transportation"]) {
    const roadNameLayer = tile.layers[roadNameLayerName];
    if (!roadNameLayer) continue;
    const layerExtent = roadNameLayer.extent || 4096;
    for (let i = 0; i < roadNameLayer.length; i += 1) {
      const feature = roadNameLayer.feature(i);
      const geometry = decodeFeatureGeometry(feature, layerExtent);
      if (!geometry || geometry.kind !== "LineString") continue;
      const properties = (feature.properties ?? {}) as FeatureProps;
      const labelText = getFeatureLabel(properties);
      if (!labelText) continue;
      const roadClass = normalizeRoadClass(properties);
      if (!shouldRenderRoadLabelByZoom(roadClass, zoomLevel)) continue;
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
      const className = buildFeatureClasses("roads", properties);
      const label = renderLineLabelElement(
        `road-label-${roadLabelId}`,
        pathData,
        labelText,
        className,
        textStyle
      );
      if (label) labelFragments.push(label);
    }
  }
}

export function renderTileToSvg(
  tileBuffer: ArrayBuffer | Uint8Array,
  options: RenderOptions = {}
): string | null {
  if (!tileBuffer || tileBuffer.byteLength === 0) return null;

  let tile: VectorTile;
  try {
    tile = decodeVectorTile(tileBuffer);
  } catch {
    return null;
  }

  const groups = new Map<string, string>();
  const roadLabelFragments: string[] = [];
  const featureLabelFragments: string[] = [];
  const natureLabelFragments: string[] = [];
  const renderLabels = Boolean(options.labels);
  const renderRoadLabelsEnabled = Boolean(options.roadLabels);
  const renderNatureLabelsEnabled = Boolean(options.natureLabels);
  const zoomLevel = Number.isInteger(options.zoom) ? options.zoom : undefined;
  const tileX = Number.isInteger(options.tileX) ? options.tileX : undefined;
  const tileY = Number.isInteger(options.tileY) ? options.tileY : undefined;

  for (const layerName of getLayerOrder()) {
    if (!isSupportedLayer(layerName)) continue;
    renderLayerFeatures(groups, tile, layerName, renderLabels, zoomLevel, featureLabelFragments);

    if (layerName === "roads" && renderRoadLabelsEnabled) {
      renderRoadLabels(tile, roadLabelFragments, zoomLevel);
    }
  }

  if (renderNatureLabelsEnabled) {
    renderNatureLabels(tile, natureLabelFragments, zoomLevel, tileX, tileY);
  }

  const overlayContent = [
    ...roadLabelFragments,
    ...featureLabelFragments,
    ...natureLabelFragments,
  ].join("");
  return buildSvgDocument(groups, overlayContent);
}
