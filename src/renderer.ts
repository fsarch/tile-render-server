import { VectorTile, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  decodeFeatureGeometry,
  getLabelAnchor,
  getLineLength,
  getPolygonArea,
  simplifyLine,
  type LineStringGeometry,
  type NormalizedGeometry,
  type Point2D,
  type PolygonGeometry,
} from "./geometry.js";
import {
  InMemoryLabelAnchorCache,
  type GlobalAreaAnchor,
  type LabelAnchorCache,
  type LabelAnchorKey,
} from "./label-anchor-cache.js";
import {
  buildFeatureClasses,
  getLayerOrder,
  getNatureTextStyle,
  getRailSleeperStyle,
  getRoadRenderPriority,
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

// Minimal read access to the PMTiles archive, so the renderer can look at ancestor
// and neighboring tiles to find the true extent of a large, multi-fragment named
// area (e.g. a nature reserve split into many disjoint polygons across many tiles).
// Both LocalPMTilesArchive and TilesService's TileArchive satisfy this structurally.
export interface TileSource {
  getTile(z: number, x: number, y: number): Promise<ArrayBuffer | Uint8Array | undefined>;
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

// Motorways/trunk roads are identified by their route number in normal map use
// (e.g. "A 40"), not by a historical or colloquial name (e.g. "Ruhrschnellweg").
function getRoadLabelText(properties: FeatureProps, roadClass: string): string | null {
  if (roadClass === "motorway" || roadClass === "trunk") {
    const ref = properties.ref;
    if (typeof ref === "string" && ref.trim().length > 0) {
      return ref.trim();
    }
  }
  return getFeatureLabel(properties);
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

// Rivers/streams (and occasionally roads) can zigzag tightly enough that text
// following the raw path via <textPath> flips each letter's angle and becomes
// unreadable. Simplifying just the line used for label placement smooths that out
// without touching the actual rendered geometry of the feature.
const LABEL_LINE_SIMPLIFY_TOLERANCE = 6;

function simplifyLineForLabel(line: LineStringGeometry["lines"][number]): LineStringGeometry["lines"][number] {
  return simplifyLine(line, LABEL_LINE_SIMPLIFY_TOLERANCE);
}

const ROAD_LABEL_MIN_ZOOM: Partial<Record<string, number>> = {
  // Keep road labels in sync with when their geometry starts rendering, see
  // ROAD_CLASS_MIN_ZOOM in styles.ts.
  minor: 14,
  track: 14,
  path: 14,
  transit: 14,
  trunk: 10,
  tertiary: 13,
};

function shouldRenderRoadLabelByZoom(roadClass: string, zoom?: number): boolean {
  if (roadClass === "rail") return false;
  const minZoom = ROAD_LABEL_MIN_ZOOM[roadClass];
  if (minZoom !== undefined && (!Number.isInteger(zoom) || (zoom ?? 0) < minZoom)) {
    return false;
  }
  if (!Number.isInteger(zoom) || (zoom ?? 0) < 13) return true;
  return (
    roadClass === "motorway" ||
    roadClass === "trunk" ||
    roadClass === "primary" ||
    roadClass === "tertiary"
  );
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
  if (!Number.isInteger(zoom) || (zoom ?? 0) < 12) return false;
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
  // Naturparks, bird sanctuaries (Vogelschutzgebiet / EU special protection areas), and
  // Landschaftsschutzgebiete (landscape protection areas, the lowest protection tier and
  // often named after every stream/valley they cover, producing unwieldy long labels) are
  // too low-priority for the map style to warrant their own area label.
  if (
    tokens.includes("naturpark") ||
    tokens.includes("vogelschutzgebiet") ||
    tokens.includes("landschaftsschutzgebiet")
  ) {
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
  // A label whose anchor sits close to a tile edge (common when a feature is split
  // into several per-tile geometry fragments, e.g. a large nature reserve, or when a
  // line label's midpoint happens to fall right at/beyond the boundary) would
  // otherwise render with part of its text cut off by the tile boundary, which reads
  // as broken/garbled rather than merely cropped. Require the text to be almost
  // entirely visible in this tile, in both directions.
  const MIN_VISIBLE_FRACTION = 0.9;
  if (
    visibleWidth < estimatedWidth * MIN_VISIBLE_FRACTION ||
    visibleHeight < estimatedHeight * MIN_VISIBLE_FRACTION
  ) {
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

// Bounding box of exactly the portion of `line` between arc-length distances
// [startDist, endDist] from its start, clipping the segments that straddle the
// window boundaries instead of just picking whichever vertices happen to fall
// inside it.
function boundsOfLineWindow(
  line: Point2D[],
  startDist: number,
  endDist: number
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;
  const include = (x: number, y: number): void => {
    found = true;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  let traveled = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const segStart = traveled;
    const segEnd = traveled + segLen;
    if (segEnd >= startDist && segStart <= endDist) {
      const t0 = segLen > 0 ? Math.max(0, (startDist - segStart) / segLen) : 0;
      const t1 = segLen > 0 ? Math.min(1, (endDist - segStart) / segLen) : 1;
      include(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
      include(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
    }
    traveled = segEnd;
  }
  return found ? { minX, maxX, minY, maxY } : null;
}

// Line labels (road names, river names) render via <textPath>, which distributes
// the text along the *actual curve* of the line, centered at 50% of its arc length -
// not in a straight symmetric box around one vertex. A curving line can easily have
// its midpoint vertex safely inside the tile while the portion the text physically
// covers still sweeps outside it (exactly what happened with "Am Sondert": the
// middle vertex sat at y=250, comfortably inside, while the line's ends curved down
// to y=264, past the tile's bottom edge, taking part of the text with them). This
// windows the line to the arc-length span the text will actually occupy and checks
// *that* portion's visibility, instead of an estimated box around a single point.
function buildLineLabelBounds(
  line: Point2D[],
  labelText: string,
  textStyle: SvgStyle | null
): LabelBounds | null {
  if (!Array.isArray(line) || line.length < 2 || !textStyle) return null;

  const fontSize = getNumericStyleValue(textStyle["font-size"], 10);
  const estimatedWidth = estimateTextWidth(labelText, fontSize);
  const estimatedHeight = fontSize * 1.3;
  const totalLength = getLineLength(line);
  if (totalLength <= 0) return null;

  const center = totalLength / 2;
  const startDist = Math.max(0, center - estimatedWidth / 2);
  const endDist = Math.min(totalLength, center + estimatedWidth / 2);
  const window = boundsOfLineWindow(line, startDist, endDist);
  if (!window) return null;

  const minY = window.minY - estimatedHeight / 2;
  const maxY = window.maxY + estimatedHeight / 2;
  const visibleWidth = Math.max(0, Math.min(window.maxX, 256) - Math.max(window.minX, 0));
  const visibleHeight = Math.max(0, Math.min(maxY, 256) - Math.max(minY, 0));
  const visibleArea = visibleWidth * visibleHeight;
  if (visibleArea <= 0) return null;

  const totalWidth = window.maxX - window.minX;
  const totalHeight = maxY - minY;
  const MIN_VISIBLE_FRACTION = 0.9;
  if (
    (totalWidth > 0 && visibleWidth < totalWidth * MIN_VISIBLE_FRACTION) ||
    visibleHeight < totalHeight * MIN_VISIBLE_FRACTION
  ) {
    return null;
  }

  return {
    minX: window.minX,
    maxX: window.maxX,
    minY,
    maxY,
    visibleArea,
    totalArea: Math.max(totalWidth, 1) * totalHeight,
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

// --- Cross-tile area anchor resolution -------------------------------------------
//
// A single named nature area (e.g. a large Naturschutzgebiet) is frequently split by
// Planetiler into many disjoint polygon fragments spread across several tiles. Each
// tile only ever sees its own local fragment(s), so independently placing a label per
// tile produces the same name repeated across many neighboring tiles. To place just
// one label for the whole area, we look for its true extent outside the current tile:
//
//   1. Zoom out one level at a time, looking for a (coarser) ancestor tile that still
//      contains a same-named "park" polygon. Keep going while it's still there.
//   2. If, at some ancestor zoom, the area is fully inside that one tile (its bounds
//      don't touch the tile edges), that tile's centroid is the answer.
//   3. If the area disappears while zooming out before that happens, fall back to the
//      last zoom level where it was still present and scan outward (left/right/up/
//      down) from there until each direction stops finding it, to approximate the
//      overall bounding box and use its center.
//
// The result is cached (by name) per process, since resolving it involves several
// extra archive reads and every fragment/tile of the same area asks the same question.

const MIN_AREA_ANCHOR_ZOOM = 4;
const AREA_ANCHOR_NEIGHBOR_SCAN_RADIUS = 8;
const AREA_ANCHOR_EDGE_EPSILON = 0.75;

type PixelBounds = { minX: number; maxX: number; minY: number; maxY: number };

// In-process single-flight de-dup: concurrent fragments/requests within one process
// asking about the same name share one computation (and, once persisted, one round
// trip to the injected LabelAnchorCache) instead of racing to compute it separately.
const areaAnchorCache = new Map<string, Promise<GlobalAreaAnchor | null>>();

// Used whenever no LabelAnchorCache is injected (e.g. the batch CLI/worker.ts, or
// direct renderer.ts callers/tests) - preserves the pre-persistence, process-lifetime
// caching behavior exactly as it worked before.
const defaultLabelAnchorCache = new InMemoryLabelAnchorCache();

function polygonPixelBounds(geometry: PolygonGeometry): PixelBounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of geometry.rings) {
    for (const point of ring) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

function unionPixelBounds(boundsList: PixelBounds[]): PixelBounds | null {
  let combined: PixelBounds | null = null;
  for (const bounds of boundsList) {
    if (!combined) {
      combined = { ...bounds };
      continue;
    }
    combined.minX = Math.min(combined.minX, bounds.minX);
    combined.maxX = Math.max(combined.maxX, bounds.maxX);
    combined.minY = Math.min(combined.minY, bounds.minY);
    combined.maxY = Math.max(combined.maxY, bounds.maxY);
  }
  return combined;
}

// A named area can be represented in a tile either by its actual polygon fragment or
// by a standalone point marker (common Planetiler technique for placing a label
// reference once per tile a large multipolygon touches, independent of whether that
// tile also carries a polygon fragment). Both must count as "the name is present
// here" for the ancestor/neighbor search below, or the search can wrongly conclude
// the area doesn't extend into a tile that only has the point representation.
function featureLocalBounds(geometry: NormalizedGeometry): PixelBounds | null {
  if (geometry.kind === "Polygon") return polygonPixelBounds(geometry);
  if (geometry.kind === "Point") {
    const point = geometry.points[0];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
  }
  return null;
}

function touchesTileEdge(bounds: PixelBounds): boolean {
  return (
    bounds.minX <= AREA_ANCHOR_EDGE_EPSILON ||
    bounds.minY <= AREA_ANCHOR_EDGE_EPSILON ||
    bounds.maxX >= 256 - AREA_ANCHOR_EDGE_EPSILON ||
    bounds.maxY >= 256 - AREA_ANCHOR_EDGE_EPSILON
  );
}

async function safeGetVectorTile(
  source: TileSource,
  z: number,
  x: number,
  y: number
): Promise<VectorTile | null> {
  const maxIndex = 2 ** z;
  if (z < 0 || x < 0 || y < 0 || x >= maxIndex || y >= maxIndex) return null;
  try {
    const data = await source.getTile(z, x, y);
    if (!data) return null;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength === 0) return null;
    return decodeVectorTile(bytes);
  } catch {
    return null;
  }
}

type FeatureBoundsMatch = { bounds: PixelBounds; isPolygon: boolean };

// A synthetic id used when a feature has no real MVT/OSM id at all (see
// resolveAreaGlobalAnchor) - such features are matched by name everywhere, exactly
// like before this file supported id-based matching.
const SYNTHETIC_FEATURE_ID_PREFIX = "name:";

function findMatchingParkFeatureBoundsById(tile: VectorTile, featureId: string): FeatureBoundsMatch[] {
  const layer = tile.layers.park;
  if (!layer) return [];
  const extent = layer.extent || 4096;
  const result: FeatureBoundsMatch[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    if (getFeatureDataId(feature) !== featureId) continue;
    const properties = (feature.properties ?? {}) as FeatureProps;
    if (shouldSuppressNatureLabel(properties)) continue;
    const geometry = decodeFeatureGeometry(feature, extent);
    if (!geometry) continue;
    const bounds = featureLocalBounds(geometry);
    if (bounds) result.push({ bounds, isPolygon: geometry.kind === "Polygon" });
  }
  return result;
}

function findMatchingParkFeatureBoundsByName(tile: VectorTile, normalizedName: string): FeatureBoundsMatch[] {
  const layer = tile.layers.park;
  if (!layer) return [];
  const extent = layer.extent || 4096;
  const result: FeatureBoundsMatch[] = [];
  for (let i = 0; i < layer.length; i += 1) {
    const feature = layer.feature(i);
    const properties = (feature.properties ?? {}) as FeatureProps;
    const label = getFeatureLabel(properties);
    if (!label || normalizeLabelText(label) !== normalizedName) continue;
    if (shouldSuppressNatureLabel(properties)) continue;
    const geometry = decodeFeatureGeometry(feature, extent);
    if (!geometry) continue;
    const bounds = featureLocalBounds(geometry);
    if (bounds) result.push({ bounds, isPolygon: geometry.kind === "Polygon" });
  }
  return result;
}

// Looks up matches for `featureId` in `tile`'s park layer. A real MVT/OSM id is
// matched strictly - except when `allowNameFallbackForThisTile` is set (used only by
// the ancestor zoom-out walk) and this specific tile has zero id matches, in which
// case it falls back to name-matching for that one hop only: ids reliably survive
// Planetiler's tile-clipping within one zoom level, but aren't guaranteed to survive
// its cross-zoom generalization, so the fallback is a narrow, explicit safety net
// rather than something to rely on generally (the same-zoom neighbor scan, where
// false merges actually matter, never uses it). A synthetic "name:" id (the feature
// had no real id at all) always matches by name, everywhere - i.e. behaves exactly as
// this whole mechanism did before id-based matching existed.
function findMatchingParkFeatureBounds(
  tile: VectorTile,
  featureId: string,
  normalizedName: string,
  allowNameFallbackForThisTile: boolean
): FeatureBoundsMatch[] {
  if (featureId.startsWith(SYNTHETIC_FEATURE_ID_PREFIX)) {
    return findMatchingParkFeatureBoundsByName(tile, normalizedName);
  }
  const byId = findMatchingParkFeatureBoundsById(tile, featureId);
  if (byId.length > 0 || !allowNameFallbackForThisTile) return byId;
  return findMatchingParkFeatureBoundsByName(tile, normalizedName);
}

function unionFeatureBounds(matches: FeatureBoundsMatch[]): PixelBounds | null {
  return unionPixelBounds(matches.map((match) => match.bounds));
}

async function computeAreaGlobalAnchor(
  source: TileSource,
  featureId: string,
  normalizedName: string,
  zoom: number,
  tileX: number,
  tileY: number
): Promise<GlobalAreaAnchor | null> {
  let lastMatch: { zoom: number; x: number; y: number; bounds: PixelBounds } | null = null;

  for (let ancestorZoom = zoom; ancestorZoom >= MIN_AREA_ANCHOR_ZOOM; ancestorZoom -= 1) {
    const shift = zoom - ancestorZoom;
    const ax = tileX >> shift;
    const ay = tileY >> shift;
    const ancestorTile = await safeGetVectorTile(source, ancestorZoom, ax, ay);
    if (!ancestorTile) break;
    const matches = findMatchingParkFeatureBounds(ancestorTile, featureId, normalizedName, true);
    if (matches.length === 0) break;
    const bounds = unionFeatureBounds(matches);
    if (!bounds) break;
    lastMatch = { zoom: ancestorZoom, x: ax, y: ay, bounds };
    // A lone point marker carries no extent information (it's a label reference, not
    // the area's outline), so it must never by itself end the search early - only a
    // polygon fragment lets us conclude "the whole area fits in this tile".
    const hasPolygon = matches.some((match) => match.isPolygon);
    if (hasPolygon && !touchesTileEdge(bounds)) {
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const scale = 256 * 2 ** ancestorZoom;
      return { fx: (ax * 256 + centerX) / scale, fy: (ay * 256 + centerY) / scale };
    }
  }

  // Fell back out of the loop: the area either vanished while zooming out, or never
  // fit inside a single tile down to MIN_AREA_ANCHOR_ZOOM. Scan outward from the last
  // zoom level where it was seen (or the original render tile, if it was never seen
  // in any ancestor at all) to approximate the overall extent. The seed tile itself
  // may have nothing at all (e.g. only a point marker was found at an ancestor zoom,
  // or the name was never found in any ancestor) - that must NOT stop the scan, since
  // the real polygon fragment(s) can still be sitting in an immediate neighbor tile.
  const scanZoom = lastMatch?.zoom ?? zoom;
  const seedX = lastMatch?.x ?? tileX;
  const seedY = lastMatch?.y ?? tileY;

  let combinedBounds = lastMatch?.bounds ?? null;
  if (!combinedBounds) {
    const seedTile = await safeGetVectorTile(source, scanZoom, seedX, seedY);
    combinedBounds = seedTile
      ? unionFeatureBounds(findMatchingParkFeatureBounds(seedTile, featureId, normalizedName, false))
      : null;
  }
  let minGX = combinedBounds ? seedX * 256 + combinedBounds.minX : Number.POSITIVE_INFINITY;
  let maxGX = combinedBounds ? seedX * 256 + combinedBounds.maxX : Number.NEGATIVE_INFINITY;
  let minGY = combinedBounds ? seedY * 256 + combinedBounds.minY : Number.POSITIVE_INFINITY;
  let maxGY = combinedBounds ? seedY * 256 + combinedBounds.maxY : Number.NEGATIVE_INFINITY;
  let foundAny = combinedBounds !== null;

  const directions: Array<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of directions) {
    let x = seedX;
    let y = seedY;
    for (let step = 0; step < AREA_ANCHOR_NEIGHBOR_SCAN_RADIUS; step += 1) {
      x += dx;
      y += dy;
      const neighborTile = await safeGetVectorTile(source, scanZoom, x, y);
      if (!neighborTile) break;
      const matches = findMatchingParkFeatureBounds(neighborTile, featureId, normalizedName, false);
      if (matches.length === 0) break;
      const bounds = unionFeatureBounds(matches);
      if (!bounds) break;
      foundAny = true;
      minGX = Math.min(minGX, x * 256 + bounds.minX);
      maxGX = Math.max(maxGX, x * 256 + bounds.maxX);
      minGY = Math.min(minGY, y * 256 + bounds.minY);
      maxGY = Math.max(maxGY, y * 256 + bounds.maxY);
    }
  }

  if (!foundAny) return null;
  const scale = 256 * 2 ** scanZoom;
  return { fx: (minGX + maxGX) / 2 / scale, fy: (minGY + maxGY) / 2 / scale };
}

// `featureId` is the feature's real MVT/OSM id when available, or a synthetic
// "name:<normalized>" id otherwise (see the call site in renderNatureLabels) - see
// findMatchingParkFeatureBounds for how that affects matching, and the "ID vs name"
// discussion in REQUIREMENTS.md §9 for why a bare id alone isn't used as the cache key
// (it's only unique within one source layer, not globally).
function getAreaGlobalAnchor(
  source: TileSource | undefined,
  theme: "water" | "nature",
  featureId: string,
  normalizedName: string,
  zoom?: number,
  tileX?: number,
  tileY?: number,
  labelAnchorCache: LabelAnchorCache = defaultLabelAnchorCache
): Promise<GlobalAreaAnchor | null> {
  if (!source || theme !== "nature" || !Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    return Promise.resolve(null);
  }
  const cacheKey = `${theme}|${featureId}`;
  let cached = areaAnchorCache.get(cacheKey);
  if (!cached) {
    cached = resolveAreaGlobalAnchor(
      source,
      featureId,
      normalizedName,
      zoom as number,
      tileX as number,
      tileY as number,
      labelAnchorCache
    ).catch(() => null);
    areaAnchorCache.set(cacheKey, cached);
  }
  return cached;
}

// Checks the injected (possibly persistent/shared) cache before falling back to the
// live ancestor/neighbor-scan computation, and writes the result back so future
// lookups - in this process or, once backed by a shared store, in others - don't
// repeat the same archive reads.
async function resolveAreaGlobalAnchor(
  source: TileSource,
  featureId: string,
  normalizedName: string,
  zoom: number,
  tileX: number,
  tileY: number,
  labelAnchorCache: LabelAnchorCache
): Promise<GlobalAreaAnchor | null> {
  const key: LabelAnchorKey = { sourceLayer: "park", featureId };
  const persisted = await labelAnchorCache.get(key);
  if (persisted !== undefined) return persisted;

  const computed = await computeAreaGlobalAnchor(source, featureId, normalizedName, zoom, tileX, tileY);
  await labelAnchorCache.set(key, computed);
  return computed;
}

// Given a resolved global anchor, decide whether the CURRENT tile is the one that
// should render the label, and if so, at which local (0..256) position.
function resolveOwnedLocalAnchor(
  globalAnchor: GlobalAreaAnchor,
  zoom: number,
  tileX: number,
  tileY: number
): { x: number; y: number } | null {
  const scale = 256 * 2 ** zoom;
  const gx = globalAnchor.fx * scale;
  const gy = globalAnchor.fy * scale;
  const ownerX = Math.floor(gx / 256);
  const ownerY = Math.floor(gy / 256);
  if (ownerX !== tileX || ownerY !== tileY) return null;
  return { x: gx - ownerX * 256, y: gy - ownerY * 256 };
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

async function renderNatureLabels(
  tile: VectorTile,
  labelFragments: string[],
  zoomLevel: number | undefined,
  tileX: number | undefined,
  tileY: number | undefined,
  source: TileSource | undefined,
  labelAnchorCache: LabelAnchorCache
): Promise<void> {
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
          const longestLine = simplifyLineForLabel(pickLongestLine(geometry.lines));
          if (longestLine.length < 2) continue;
          const pathData = lineToPathData(longestLine);
          if (!pathData) continue;
          const bounds = buildLineLabelBounds(longestLine, labelText, labelStyle);
          if (!bounds) continue;
          const anchor = longestLine[Math.floor(longestLine.length / 2)] ?? null;
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

        let anchor = getLabelAnchor(geometry);
        let usesGlobalAreaAnchor = false;

        // For polygon-anchored nature labels (parks/reserves/etc.), a single named
        // area can be split into many disjoint per-tile fragments - including a mix
        // of polygon pieces and separate point representations of the same name. Try
        // to resolve one canonical position for the whole area (memoized per feature
        // id, so this is only ever computed once regardless of how many fragments/
        // tiles ask); if this tile isn't the owner of that position, skip this
        // fragment entirely instead of placing a local duplicate. Grouping is by the
        // feature's own MVT/OSM id where available (falls back to name only when no
        // id exists at all) - names alone can be ambiguous (see REQUIREMENTS.md §9:
        // several distinct real-world features can share one name).
        const normalizedLabelText = normalizeLabelText(labelText);
        const featureId =
          getFeatureDataId(feature as { id?: unknown; properties?: Record<string, unknown> }) ??
          `${SYNTHETIC_FEATURE_ID_PREFIX}${normalizedLabelText}`;
        const globalAnchor = await getAreaGlobalAnchor(
          source,
          config.theme,
          featureId,
          normalizedLabelText,
          zoomLevel,
          tileX,
          tileY,
          labelAnchorCache
        );
        if (globalAnchor) {
          if (!Number.isInteger(zoomLevel) || !Number.isInteger(tileX) || !Number.isInteger(tileY)) {
            continue;
          }
          const owned = resolveOwnedLocalAnchor(globalAnchor, zoomLevel as number, tileX as number, tileY as number);
          if (!owned) continue;
          anchor = owned;
          usesGlobalAreaAnchor = true;
        }

        const bounds = buildAnchoredLabelBounds(anchor, labelText, labelStyle);
        if (!bounds) continue;
        if (!usesGlobalAreaAnchor && shouldSuppressSmallNatureReserveLabel(properties, geometry, bounds)) {
          continue;
        }
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
  const isRoadsLayer = layerName === "roads";
  const roadFragments: Array<{ priority: number; html: string }> = [];
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
      const style = getStyleForFeature(layerName, geometry.kind, properties, zoomLevel);
      const renderAttributes = buildFeatureRenderAttributes(feature as { id?: unknown; properties?: Record<string, unknown> });
      if (!style) continue;

      if (layerName === "railways") {
        fragments.push(
          ...renderRailwayElements(geometry, style, getRailSleeperStyle(), className, renderAttributes)
        );
      } else if (isRoadsLayer) {
        const priority = getRoadRenderPriority(normalizeRoadClass(properties));
        for (const html of renderGeometryElements(geometry, style, className, renderAttributes)) {
          roadFragments.push({ priority, html });
        }
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

  if (isRoadsLayer && roadFragments.length > 0) {
    // Stable sort: higher-priority roads (Autobahn) end up later in the document,
    // i.e. painted on top of lower-priority ones (Bundesstraße -> Landstraße -> ...).
    roadFragments.sort((a, b) => a.priority - b.priority);
    groups.set(layerName, roadFragments.map((entry) => entry.html).join(""));
  } else if (fragments.length > 0) {
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
      const roadClass = normalizeRoadClass(properties);
      const labelText = getRoadLabelText(properties, roadClass);
      if (!labelText) continue;
      if (!shouldRenderRoadLabelByZoom(roadClass, zoomLevel)) continue;
      const textStyle = getTextStyleForLayer("roads");
      if (!textStyle) continue;
      const longestLine = simplifyLineForLabel(pickLongestLine(geometry.lines));
      if (longestLine.length < 2) continue;
      const pathData = lineToPathData(longestLine);
      if (!pathData) continue;
      // The text renders along the line's actual curve, centered at 50% arc length;
      // require the portion of the line it will actually cover to stay in the tile.
      if (!buildLineLabelBounds(longestLine, labelText, textStyle)) continue;
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

export async function renderTileToSvg(
  tileBuffer: ArrayBuffer | Uint8Array,
  options: RenderOptions = {},
  archive?: TileSource,
  labelAnchorCache: LabelAnchorCache = defaultLabelAnchorCache
): Promise<string | null> {
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
    await renderNatureLabels(tile, natureLabelFragments, zoomLevel, tileX, tileY, archive, labelAnchorCache);
  }

  const overlayContent = [
    ...roadLabelFragments,
    ...featureLabelFragments,
    ...natureLabelFragments,
  ].join("");
  return buildSvgDocument(groups, overlayContent);
}
