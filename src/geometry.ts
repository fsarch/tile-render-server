import type { VectorTileFeature } from "@mapbox/vector-tile";

const TILE_SIZE = 256;
const DEFAULT_EXTENT = 4096;

export interface Point2D {
  x: number;
  y: number;
}

export interface PolygonGeometry {
  kind: "Polygon";
  rings: Point2D[][];
}

export interface LineStringGeometry {
  kind: "LineString";
  lines: Point2D[][];
}

export interface PointGeometry {
  kind: "Point";
  points: Point2D[];
}

export type NormalizedGeometry = PolygonGeometry | LineStringGeometry | PointGeometry;

function toTileCoord(value: number, extent: number): number {
  return (value / extent) * TILE_SIZE;
}

function ringArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function getLineLength(line: Point2D[]): number {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    const dx = line[i].x - line[i - 1].x;
    const dy = line[i].y - line[i - 1].y;
    length += Math.hypot(dx, dy);
  }
  return length;
}

export function getPolygonArea(rings: Point2D[][]): number {
  if (!Array.isArray(rings) || rings.length === 0) return 0;
  let area = 0;
  for (const ring of rings) {
    area += Math.abs(ringArea(ring));
  }
  return area;
}

export function decodeFeatureGeometry(
  feature: VectorTileFeature,
  extent = DEFAULT_EXTENT
): NormalizedGeometry | null {
  if (!feature || typeof feature.loadGeometry !== "function") return null;
  const geometry = feature.loadGeometry();
  if (!Array.isArray(geometry) || geometry.length === 0) return null;

  const normalized = geometry
    .map((line) =>
      line.map((point) => ({
        x: toTileCoord(point.x, extent),
        y: toTileCoord(point.y, extent),
      }))
    )
    .filter((line) => line.length > 0);

  if (normalized.length === 0) return null;

  if (feature.type === 3) {
    const rings = normalized.filter((ring) => ring.length >= 3);
    if (rings.length === 0) return null;
    return { kind: "Polygon", rings };
  }

  if (feature.type === 2) {
    const lines = normalized.filter((line) => line.length >= 2);
    if (lines.length === 0) return null;
    return { kind: "LineString", lines };
  }

  if (feature.type === 1) {
    const points = normalized.flat().filter((point) => Number.isFinite(point.x));
    if (points.length === 0) return null;
    return { kind: "Point", points };
  }

  return null;
}

function perpendicularDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared;
  const clampedT = Math.max(0, Math.min(1, t));
  const projectedX = lineStart.x + clampedT * dx;
  const projectedY = lineStart.y + clampedT * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

// Douglas-Peucker line simplification: drops points that stay within `tolerance` of
// the straight line between their neighbors, collapsing tight zigzags into longer,
// straighter runs while keeping the overall shape. Used to smooth the path a label's
// text follows (rivers/roads that wiggle a lot otherwise flip each letter's angle),
// not the actual rendered geometry of the feature itself.
export function simplifyLine(points: Point2D[], tolerance: number): Point2D[] {
  if (!Array.isArray(points) || points.length < 3 || tolerance <= 0) {
    return points;
  }

  const end = points.length - 1;
  let maxDistance = 0;
  let splitIndex = 0;
  for (let i = 1; i < end; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = i;
    }
  }

  if (maxDistance <= tolerance) {
    return [points[0], points[end]];
  }

  const left = simplifyLine(points.slice(0, splitIndex + 1), tolerance);
  const right = simplifyLine(points.slice(splitIndex), tolerance);
  return left.slice(0, -1).concat(right);
}

export function getLabelAnchor(geometry: NormalizedGeometry): Point2D | null {
  if (geometry.kind === "Point") {
    return geometry.points[0] ?? null;
  }

  if (geometry.kind === "LineString") {
    const firstLine = geometry.lines[0];
    if (!firstLine || firstLine.length === 0) return null;
    return firstLine[Math.floor(firstLine.length / 2)];
  }

  const outer = [...geometry.rings].sort(
    (a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a))
  )[0];
  if (!outer || outer.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of outer) {
    x += point.x;
    y += point.y;
  }
  return { x: x / outer.length, y: y / outer.length };
}
