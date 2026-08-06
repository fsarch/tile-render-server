import { PbfWriter } from "pbf";
import { describe, expect, it } from "vitest";
import { renderTileToSvg, type TileSource } from "./renderer.js";

// --- Minimal hand-rolled MVT (Mapbox Vector Tile) encoder, just enough to build a
// "park" layer with Point and/or Polygon features for these tests. There is no MVT
// encoder dependency in this project (only the @mapbox/vector-tile *decoder*), and
// hand-encoding real tile bytes here lets the tests exercise the actual MVT decode
// path renderer.ts runs against in production, not a mocked-out shortcut.

const EXTENT = 4096;

function zigzag(n: number): number {
  return (n << 1) ^ (n >> 31);
}

type ParkFeature = (
  | { name: string; kind: "Point"; x: number; y: number }
  | { name: string; kind: "Polygon"; ring: Array<[number, number]> }
) & { id?: number };

function encodePointGeometry(x: number, y: number): number[] {
  return [(1 & 0x7) | (1 << 3), zigzag(x), zigzag(y)];
}

function encodePolygonGeometry(ring: Array<[number, number]>): number[] {
  const [firstX, firstY] = ring[0];
  const commands = [(1 & 0x7) | (1 << 3), zigzag(firstX), zigzag(firstY)];
  const remaining = ring.slice(1);
  commands.push((2 & 0x7) | (remaining.length << 3));
  let prevX = firstX;
  let prevY = firstY;
  for (const [x, y] of remaining) {
    commands.push(zigzag(x - prevX), zigzag(y - prevY));
    prevX = x;
    prevY = y;
  }
  commands.push((7 & 0x7) | (1 << 3));
  return commands;
}

function writeValue(value: string, pbf: PbfWriter): void {
  pbf.writeStringField(1, value);
}

function writeFeature(feature: ParkFeature, pbf: PbfWriter): void {
  if (feature.id !== undefined) {
    pbf.writeVarintField(1, feature.id); // MVT Feature.id (protobuf field 1)
  }
  // tags: interleaved [nameKeyIndex, nameValueIndex] - "name" is always keys[0].
  pbf.writePackedVarint(2, [0, 0]);
  if (feature.kind === "Point") {
    pbf.writeVarintField(3, 1); // GeomType.POINT
    pbf.writePackedVarint(4, encodePointGeometry(feature.x, feature.y));
  } else {
    pbf.writeVarintField(3, 3); // GeomType.POLYGON
    pbf.writePackedVarint(4, encodePolygonGeometry(feature.ring));
  }
}

function writeParkLayer(features: ParkFeature[], pbf: PbfWriter): void {
  pbf.writeVarintField(15, 2); // version
  pbf.writeStringField(1, "park");
  for (const feature of features) {
    pbf.writeMessage(2, writeFeature, feature);
  }
  pbf.writeStringField(3, "name"); // keys[0]
  for (const feature of features) {
    pbf.writeMessage(4, writeValue, feature.name); // values[i]
  }
  pbf.writeVarintField(5, EXTENT);
}

function encodeParkTile(features: ParkFeature[]): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(3, writeParkLayer, features);
  return pbf.finish();
}

// --- Tests -------------------------------------------------------------------------

describe("cross-tile nature area label resolution", () => {
  it("suppresses a fragment-only (point marker) tile and labels the tile that owns the resolved area center exactly once", async () => {
    const zoom = 12;
    const tileAX = 100;
    const tileAY = 100; // has only a point marker for "Testwald" - no polygon at all
    const tileBX = 100;
    const tileBY = 101; // directly south of tile A - has the real polygon

    const tileABytes = encodeParkTile([{ name: "Testwald", kind: "Point", x: 2048, y: 2048 }]);
    const tileBBytes = encodeParkTile([
      {
        name: "Testwald",
        kind: "Polygon",
        ring: [
          [1536, 1536],
          [2560, 1536],
          [2560, 2560],
          [1536, 2560],
        ],
      },
    ]);

    const tiles = new Map<string, Uint8Array>([
      [`${zoom}/${tileAX}/${tileAY}`, tileABytes],
      [`${zoom}/${tileBX}/${tileBY}`, tileBBytes],
    ]);

    const archive: TileSource = {
      async getTile(z, x, y) {
        return tiles.get(`${z}/${x}/${y}`);
      },
    };

    const renderOptions = { labels: false, roadLabels: false, natureLabels: true, zoom };

    const svgA = await renderTileToSvg(tileABytes, { ...renderOptions, tileX: tileAX, tileY: tileAY }, archive);
    const svgB = await renderTileToSvg(tileBBytes, { ...renderOptions, tileX: tileBX, tileY: tileBY }, archive);

    expect(svgA).not.toBeNull();
    expect(svgB).not.toBeNull();

    // Regression guard: previously, a tile whose only local representation of the
    // named area was a point marker (no polygon) would fail cross-tile resolution
    // entirely and fall back to rendering its own local duplicate, instead of
    // deferring to whichever tile actually owns the resolved area center.
    expect(svgA).not.toContain("Testwald");
    expect(svgB?.match(/Testwald/g)?.length ?? 0).toBe(1);
  });

  it("resolves a single feature id split across tiles the same way name-based resolution did", async () => {
    const zoom = 12;
    const tileAX = 200;
    const tileAY = 200; // point marker only, feature id 777
    const tileBX = 200;
    const tileBY = 201; // real polygon, same feature id 777

    const tileABytes = encodeParkTile([{ id: 777, name: "Idwald", kind: "Point", x: 2048, y: 2048 }]);
    const tileBBytes = encodeParkTile([
      {
        id: 777,
        name: "Idwald",
        kind: "Polygon",
        ring: [
          [1536, 1536],
          [2560, 1536],
          [2560, 2560],
          [1536, 2560],
        ],
      },
    ]);

    const tiles = new Map<string, Uint8Array>([
      [`${zoom}/${tileAX}/${tileAY}`, tileABytes],
      [`${zoom}/${tileBX}/${tileBY}`, tileBBytes],
    ]);
    const archive: TileSource = {
      async getTile(z, x, y) {
        return tiles.get(`${z}/${x}/${y}`);
      },
    };
    const renderOptions = { labels: false, roadLabels: false, natureLabels: true, zoom };

    const svgA = await renderTileToSvg(tileABytes, { ...renderOptions, tileX: tileAX, tileY: tileAY }, archive);
    const svgB = await renderTileToSvg(tileBBytes, { ...renderOptions, tileX: tileBX, tileY: tileBY }, archive);

    expect(svgA).not.toContain("Idwald");
    expect(svgB?.match(/Idwald/g)?.length ?? 0).toBe(1);
  });

  it("does not merge two distinct feature ids that happen to share the same name (the Borkenberge case)", async () => {
    // Real-world motivation: a forest called "Borkenberge" turned out to be several
    // genuinely separate OSM relations sharing one name. Name-based matching wrongly
    // unioned them into one bogus combined center; id-based matching must resolve
    // each independently and render both, since they're different real features.
    const zoom = 12;
    const tileCX = 300;
    const tileCY = 300;
    const tileDX = 350; // far enough away to also rule out any accidental neighbor-scan bridging
    const tileDY = 350;

    // Extent-space square with ~1024 units per side -> 64px per side in the rendered
    // 256px tile space (well above the min-area threshold nature area labels require).
    const square = (offsetX: number, offsetY: number): Array<[number, number]> => [
      [1536 + offsetX, 1536 + offsetY],
      [2560 + offsetX, 1536 + offsetY],
      [2560 + offsetX, 2560 + offsetY],
      [1536 + offsetX, 2560 + offsetY],
    ];

    const tileCBytes = encodeParkTile([{ id: 57628083, name: "Borkenberge", kind: "Polygon", ring: square(0, 0) }]);
    const tileDBytes = encodeParkTile([{ id: 3250242342, name: "Borkenberge", kind: "Polygon", ring: square(0, 0) }]);

    const tiles = new Map<string, Uint8Array>([
      [`${zoom}/${tileCX}/${tileCY}`, tileCBytes],
      [`${zoom}/${tileDX}/${tileDY}`, tileDBytes],
    ]);
    const archive: TileSource = {
      async getTile(z, x, y) {
        return tiles.get(`${z}/${x}/${y}`);
      },
    };
    const renderOptions = { labels: false, roadLabels: false, natureLabels: true, zoom };

    const svgC = await renderTileToSvg(tileCBytes, { ...renderOptions, tileX: tileCX, tileY: tileCY }, archive);
    const svgD = await renderTileToSvg(tileDBytes, { ...renderOptions, tileX: tileDX, tileY: tileDY }, archive);

    expect(svgC?.match(/Borkenberge/g)?.length ?? 0).toBe(1);
    expect(svgD?.match(/Borkenberge/g)?.length ?? 0).toBe(1);
  });
});
