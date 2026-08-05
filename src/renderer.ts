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
type LabelBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  visibleArea: number;
  totalArea: number;
};
type NatureLabelCandidate = {
  dedupKey: string;
  textKey: string;
  fragment: string;
  bounds: LabelBounds;
  score: number;
};

type RenderAttributes = Record<string, unknown>;

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

function getFeatureDataId(feature: { id?: unknown; properties?: Record<string, unknown> }): string | undefined {
  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }

  const properties = feature.properties ?? {};
  const candidates = [properties.id, properties["@id"], properties.osm_id, properties.osmId];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate).trim().length > 0) {
      return String(candidate);
    }
  }

  return undefined;
}

function buildFeatureRenderAttributes(feature: {
  id?: unknown;
  properties?: Record<string, unknown>;
}): RenderAttributes {
  const dataId = getFeatureDataId(feature);
  const properties = feature.properties ?? {};
  const protectClass = properties.protect_class;
  const attributes: RenderAttributes = {};
  if (dataId) {
    attributes["data-id"] = dataId;
  }
  if (protectClass !== undefined && protectClass !== null && String(protectClass).trim().length > 0) {
    attributes["data-protect-class"] = String(protectClass);
  }
  return attributes;
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

const ROAD_LABEL_CLASSES_MIN_ZOOM_14 = new Set(["minor", "track", "path", "transit"]);

function shouldRenderRoadLabelByZoom(roadClass: string, zoom?: number): boolean {
  if (roadClass === "rail") return false;
  // Keep road labels in sync with when their geometry starts rendering (minor/track/path
  // only show from zoom 14, see ROAD_CLASS_MIN_ZOOM in styles.ts).
  if (ROAD_LABEL_CLASSES_MIN_ZOOM_14.has(roadClass) && (!Number.isInteger(zoom) || (zoom ?? 0) < 14)) {
    return false;
  }
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
  const isStillWater =
    waterClass.includes("lake") ||
    waterClass.includes("pond") ||
    waterClass.includes("reservoir") ||
    waterClass.includes("basin") ||
    waterClass.includes("lagoon") ||
    waterClass.includes("pool") ||
    waterClass.includes("weiher");

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

  if (geometry.kind === "Point" && isStillWater) {
    return false;
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

function shouldSuppressNatureLabel(properties: FeatureProps): boolean {
  const tokens = getClassificationTokens(properties);
  // Naturparks and bird sanctuaries (Vogelschutzgebiet / EU special protection areas)
  // are too low-priority for the map style to warrant their own area label.
  if (tokens.includes("naturpark") || tokens.includes("vogelschutzgebiet")) {
    return true;
  }
  // Requirement 11.5: generic protected_area features must only get a label when
  // they can actually be identified as nature-related (protect_class or object/title
  // tags). Otherwise this catches unrelated administrative "protected_area" polygons.
  if (tokens.includes("protected_area") && !isNatureRelatedProtectedArea(properties)) {
    return true;
  }
  return false;
}

function getClassificationTokens(properties: FeatureProps): string[] {
  return [
    properties.class,
    properties.subclass,
    properties.kind,
    properties.type,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function isNatureRelatedProtectedArea(properties: FeatureProps): boolean {
  const tokens = getClassificationTokens(properties);
  if (!tokens.includes("protected_area")) {
    return false;
  }

  const protectClass = getNumericStyleValue(properties.protect_class, Number.NaN);
  if (Number.isFinite(protectClass)) {
    if ((protectClass >= 1 && protectClass <= 7) || (protectClass >= 97 && protectClass <= 99)) {
      return true;
    }
    return false;
  }

  const objectTokens = [
    properties.protection_object,
    properties.protection_title,
    properties.boundary,
    properties.natural,
    properties.landuse,
  ]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter((value) => value.length > 0)
    .join(" ");

  return [
    "nature",
    "habitat",
    "landscape",
    "wildlife",
    "flora",
    "fauna",
    "ecosystem",
    "biotope",
    "water",
    "wetland",
    "forest",
    "bird",
    "geo",
  ].some((token) => objectTokens.includes(token));
}

function isNatureReserve(properties: FeatureProps): boolean {
  const tokens = getClassificationTokens(properties);

  return tokens.includes("naturschutzgebiet") || isNatureRelatedProtectedArea(properties);
}

function getNatureLabelStyle(
  baseStyle: SvgStyle | null,
  properties: FeatureProps,
  theme: "water" | "nature"
): SvgStyle | null {
  if (!baseStyle) return null;
  if (theme === "nature" && isNatureReserve(properties)) {
    const baseFontSize = getNumericStyleValue(baseStyle["font-size"], 10);
    return {
      ...baseStyle,
      fill: "#2f7d32",
      "font-size": Number(Math.max(8.5, baseFontSize - 1.5).toFixed(1)),
      "stroke-width": Number(Math.max(1.6, getNumericStyleValue(baseStyle["stroke-width"], 2.2) - 0.4).toFixed(1)),
    };
  }
  return baseStyle;
}

function normalizeLabelText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function getNumericStyleValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === " ") {
      units += 0.34;
    } else if ("ilI.,:;'|!".includes(char)) {
      units += 0.3;
    } else if ("mwMW@#%&".includes(char)) {
      units += 0.92;
    } else if (/[A-Z0-9]/.test(char)) {
      units += 0.68;
    } else {
      units += 0.58;
    }
  }
  return Math.max(fontSize, units * fontSize);
}

function buildAnchoredLabelBounds(
  anchor: { x: number; y: number } | null,
  labelText: string,
  textStyle: SvgStyle | null
): LabelBounds | null {
  if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || !textStyle) {
    return null;
  }

  const fontSize = getNumericStyleValue(textStyle["font-size"], 10);
  const estimatedWidth = estimateTextWidth(labelText, fontSize);
  const estimatedHeight = fontSize * 1.3;
  const minX = anchor.x - estimatedWidth / 2;
  const maxX = anchor.x + estimatedWidth / 2;
  const minY = anchor.y - estimatedHeight / 2;
  const maxY = anchor.y + estimatedHeight / 2;
  const visibleWidth = Math.max(0, Math.min(maxX, 256) - Math.max(minX, 0));
  const visibleHeight = Math.max(0, Math.min(maxY, 256) - Math.max(minY, 0));
  const visibleArea = visibleWidth * visibleHeight;
  if (visibleArea <= 0) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    visibleArea,
    totalArea: estimatedWidth * estimatedHeight,
  };
}

function shouldRenderAnchoredLabelInTile(
  anchor: { x: number; y: number } | null,
  labelText: string,
  textStyle: SvgStyle | null
): boolean {
  return buildAnchoredLabelBounds(anchor, labelText, textStyle) !== null;
}

function doLabelBoundsOverlap(a: LabelBounds, b: LabelBounds): boolean {
  const overlapWidth = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const overlapHeight = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return false;
  }

  const overlapArea = overlapWidth * overlapHeight;
  const minArea = Math.min(a.visibleArea, b.visibleArea);
  return overlapArea >= minArea * 0.35;
}

function pushBestNatureLabels(
  candidates: NatureLabelCandidate[],
  labelFragments: string[]
): void {
  const bestByKey = new Map<string, NatureLabelCandidate>();
  for (const candidate of candidates) {
    const existing = bestByKey.get(candidate.dedupKey);
    if (!existing || candidate.score > existing.score) {
      bestByKey.set(candidate.dedupKey, candidate);
    }
  }

  const selected: NatureLabelCandidate[] = [];
  const usedTextKeys = new Set<string>();
  for (const candidate of [...bestByKey.values()].sort((a, b) => b.score - a.score)) {
    // A single named area (e.g. a nature reserve split into several disjoint OSM
    // multipolygon pieces) must not produce more than one label per tile.
    if (usedTextKeys.has(candidate.textKey)) {
      continue;
    }
    if (selected.some((existing) => doLabelBoundsOverlap(existing.bounds, candidate.bounds))) {
      continue;
    }
    selected.push(candidate);
    usedTextKeys.add(candidate.textKey);
  }

  for (const candidate of selected) {
    labelFragments.push(candidate.fragment);
  }
}

function shouldSuppressSmallNatureReserveLabel(
  properties: FeatureProps,
  geometry: NormalizedGeometry,
  bounds: LabelBounds
): boolean {
  if (!isNatureReserve(properties) || geometry.kind !== "Polygon") {
    return false;
  }

  const visiblePolygonArea = getPolygonArea(geometry.rings);
  const minimumAreaForLabel = Math.max(1200, bounds.totalArea * 1.5);
  return visiblePolygonArea < minimumAreaForLabel;
}

function buildLabelTextKey(theme: "water" | "nature", labelText: string): string {
  return `${theme}|${normalizeLabelText(labelText)}`;
}

function buildGlobalLabelBucketKey(
  theme: "water" | "nature",
  labelText: string,
  anchor: { x: number; y: number } | null,
  tileX?: number,
  tileY?: number
): string {
  const normalized = normalizeLabelText(labelText);
  if (anchor === null) {
    return `${theme}|${normalized}`;
  }
  const { x, y } = anchor;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return `${theme}|${normalized}`;
  }

  const normalizedTileX = Number.isInteger(tileX) ? Number(tileX) : 0;
  const normalizedTileY = Number.isInteger(tileY) ? Number(tileY) : 0;
  const globalX = normalizedTileX * 256 + x;
  const globalY = normalizedTileY * 256 + y;
  const bucketSize = 192;
  return `${theme}|${normalized}|${Math.floor(globalX / bucketSize)}|${Math.floor(globalY / bucketSize)}`;
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

  const candidates: NatureLabelCandidate[] = [];
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
        const properties = (feature.properties ?? {}) as FeatureProps;
        const labelText = getFeatureLabel(properties);
        if (!labelText) continue;
        if (!config.canRender(properties, geometry)) continue;
        if (config.theme === "nature" && shouldSuppressNatureLabel(properties)) continue;

        const className = buildFeatureClasses(config.targetGroup, properties);
        const labelStyle = getNatureLabelStyle(config.style, properties, config.theme);
        if (!labelStyle) continue;
        const renderAttributes = buildFeatureRenderAttributes(feature as { id?: unknown; properties?: Record<string, unknown> });
        if (config.lineLabels && geometry.kind === "LineString") {
          const longestLine = pickLongestLine(geometry.lines);
          if (longestLine.length < 2) continue;
          const pathData = lineToPathData(longestLine);
          if (!pathData) continue;
          const anchor = longestLine[Math.floor(longestLine.length / 2)] ?? null;
          const bounds = buildAnchoredLabelBounds(anchor, labelText, labelStyle);
          if (!bounds) continue;
          const dedupKey = buildGlobalLabelBucketKey(
            config.theme,
            labelText,
            anchor,
            tileX,
            tileY
          );
          labelId += 1;
          const label = renderLineLabelElement(
            `nature-label-${labelId}`,
            pathData,
            labelText,
            className ? `${className} nature-label` : "nature-label",
            labelStyle,
            renderAttributes
          );
          if (label) {
            candidates.push({
              dedupKey,
              textKey: buildLabelTextKey(config.theme, labelText),
              fragment: label,
              bounds,
              score: bounds.visibleArea / Math.max(1, bounds.totalArea),
            });
          }
          continue;
        }

        const anchor = getLabelAnchor(geometry);
        const bounds = buildAnchoredLabelBounds(anchor, labelText, labelStyle);
        if (!bounds) continue;
        if (shouldSuppressSmallNatureReserveLabel(properties, geometry, bounds)) continue;
        const dedupKey = buildGlobalLabelBucketKey(
          config.theme,
          labelText,
          anchor,
          tileX,
          tileY
        );
        const label = renderLabelElement(
          anchor,
          labelText,
          className ? `${className} nature-label` : "nature-label",
          labelStyle,
          renderAttributes
        );
        if (label) {
          candidates.push({
            dedupKey,
            textKey: buildLabelTextKey(config.theme, labelText),
            fragment: label,
            bounds,
            score: bounds.visibleArea / Math.max(1, bounds.totalArea),
          });
        }
      }
    }
  }

  pushBestNatureLabels(candidates, labelFragments);
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
      if (!isFeatureAllowedForLayer(layerName, properties, zoomLevel)) continue;
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
      const renderAttributes = buildFeatureRenderAttributes(feature as { id?: unknown; properties?: Record<string, unknown> });
      if (!style) continue;

      if (layerName === "railways") {
        fragments.push(
          ...renderRailwayElements(geometry, style, getRailSleeperStyle(), className, renderAttributes)
        );
      } else {
        fragments.push(...renderGeometryElements(geometry, style, className, renderAttributes));
      }

      if (renderLabels && labelText && textStyle) {
        const anchor = getLabelAnchor(geometry);
        if (!shouldRenderAnchoredLabelInTile(anchor, labelText, textStyle)) continue;
        const text = renderLabelElement(anchor, labelText, className, textStyle, renderAttributes);
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
      const renderAttributes = buildFeatureRenderAttributes( feature as { id?: unknown; properties?: Record<string, unknown> });
      const label = renderLineLabelElement(
        `road-label-${roadLabelId}`,
        pathData,
        labelText,
        className,
        textStyle,
        renderAttributes
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
