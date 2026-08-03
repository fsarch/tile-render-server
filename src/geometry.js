const TILE_SIZE = 256;
const DEFAULT_EXTENT = 4096;

function toTileCoord(value, extent) {
  return (value / extent) * TILE_SIZE;
}

function ringArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function getLineLength(line) {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    const dx = line[i].x - line[i - 1].x;
    const dy = line[i].y - line[i - 1].y;
    length += Math.hypot(dx, dy);
  }
  return length;
}

export function getPolygonArea(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return 0;
  let area = 0;
  for (const ring of rings) {
    area += Math.abs(ringArea(ring));
  }
  return area;
}

export function decodeFeatureGeometry(feature, extent = DEFAULT_EXTENT) {
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

export function getLabelAnchor(geometry) {
  if (!geometry) return null;
  if (geometry.kind === "Point") {
    return geometry.points[0] ?? null;
  }

  if (geometry.kind === "LineString") {
    const firstLine = geometry.lines[0];
    if (!firstLine || firstLine.length === 0) return null;
    return firstLine[Math.floor(firstLine.length / 2)];
  }

  if (geometry.kind === "Polygon") {
    const outer = [...geometry.rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))[0];
    if (!outer || outer.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const point of outer) {
      x += point.x;
      y += point.y;
    }
    return { x: x / outer.length, y: y / outer.length };
  }

  return null;
}
