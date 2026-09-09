import { describe, expect, it } from "vitest";
import { computeOverzoomTransform, decodeFeatureGeometry, type OverzoomTransform } from "./geometry.js";
import type { VectorTileFeature } from "@mapbox/vector-tile";

function fakePointFeature(x: number, y: number): VectorTileFeature {
  return {
    type: 1,
    loadGeometry: () => [[{ x, y }]],
  } as unknown as VectorTileFeature;
}

describe("computeOverzoomTransform", () => {
  it("is the identity transform when z is within the dataset's max zoom", () => {
    expect(computeOverzoomTransform(10, 3, 4, 14)).toEqual({
      sourceZoom: 10,
      sourceX: 3,
      sourceY: 4,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(computeOverzoomTransform(14, 3, 4, 14)).toMatchObject({ scale: 1 });
  });

  it("is the identity transform when maxZoom is not a finite number", () => {
    expect(computeOverzoomTransform(20, 3, 4, Number.NaN)).toMatchObject({ scale: 1, sourceZoom: 20 });
  });

  it("resolves the owning ancestor tile and crop window one level beyond max zoom", () => {
    // z15 tile (3,4) sits inside z14 ancestor (1,2) - shift=1, factor=2, so it's the
    // top-left quadrant: sub index (3-1*2, 4-2*2) = (1, 0).
    const transform = computeOverzoomTransform(15, 3, 4, 14);
    expect(transform).toEqual({
      sourceZoom: 14,
      sourceX: 1,
      sourceY: 2,
      scale: 2,
      offsetX: 128,
      offsetY: 0,
    });
  });

  it("resolves further beyond a single zoom level", () => {
    // z16, factor=4 beyond z14. Tile (5, 9) -> ancestor (1, 2), sub index (1, 1).
    const transform = computeOverzoomTransform(16, 5, 9, 14);
    expect(transform).toEqual({
      sourceZoom: 14,
      sourceX: 1,
      sourceY: 2,
      scale: 4,
      offsetX: 64,
      offsetY: 64,
    });
  });

  it("each of the four overzoomed children of one ancestor tile crops a different quadrant", () => {
    const ancestorX = 3;
    const ancestorY = 5;
    const transforms = [0, 1].flatMap((dx) =>
      [0, 1].map((dy) => computeOverzoomTransform(15, ancestorX * 2 + dx, ancestorY * 2 + dy, 14))
    );
    const offsets = transforms.map((t) => `${t.offsetX},${t.offsetY}`);
    expect(new Set(offsets).size).toBe(4);
    for (const t of transforms) {
      expect(t.sourceZoom).toBe(14);
      expect(t.sourceX).toBe(ancestorX);
      expect(t.sourceY).toBe(ancestorY);
      expect(t.scale).toBe(2);
    }
  });
});

describe("decodeFeatureGeometry with an overzoom transform", () => {
  it("leaves geometry untouched under the identity transform", () => {
    const identity: OverzoomTransform = { sourceZoom: 14, sourceX: 1, sourceY: 2, scale: 1, offsetX: 0, offsetY: 0 };
    const geometry = decodeFeatureGeometry(fakePointFeature(2048, 2048), 4096, identity);
    expect(geometry).toEqual({ kind: "Point", points: [{ x: 128, y: 128 }] });
  });

  it("crops and scales a point into the requested child tile's local space", () => {
    // Ancestor-local point at (192, 64) - inside the top-right quadrant (offsetX=128,
    // offsetY=0, scale=2) - should land at ((192-128)*2, (64-0)*2) = (128, 128).
    const transform = computeOverzoomTransform(15, 3, 4, 14);
    const rawX = (192 / 256) * 4096;
    const rawY = (64 / 256) * 4096;
    const geometry = decodeFeatureGeometry(fakePointFeature(rawX, rawY), 4096, transform);
    expect(geometry).toEqual({ kind: "Point", points: [{ x: 128, y: 128 }] });
  });

  it("maps ancestor-local points outside the requested child's quadrant outside 0..256", () => {
    // Same transform as above (top-right quadrant), but this point lives in the
    // ancestor's bottom-left quadrant - the overzoomed child tile should see it appear
    // well outside its own 0..256 viewport, so the SVG viewBox naturally clips it away.
    const transform = computeOverzoomTransform(15, 3, 4, 14);
    const rawX = (10 / 256) * 4096;
    const rawY = (200 / 256) * 4096;
    const geometry = decodeFeatureGeometry(fakePointFeature(rawX, rawY), 4096, transform);
    expect(geometry?.kind).toBe("Point");
    const point = (geometry as { points: Array<{ x: number; y: number }> }).points[0];
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeGreaterThan(256);
  });
});
