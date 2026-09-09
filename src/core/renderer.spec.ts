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

// --- Minimal "transportation_name" (road label) layer encoder - single LineString
// feature per tile, same simplifying assumption as encodeParkTile above (tags always
// reference values[0]/values[1], which is only correct for exactly one feature).

type RoadFeature = {
  id: number;
  name: string;
  roadClass: string;
  line: Array<[number, number]>;
};

function encodeLineGeometry(line: Array<[number, number]>): number[] {
  const [firstX, firstY] = line[0];
  const commands = [(1 & 0x7) | (1 << 3), zigzag(firstX), zigzag(firstY)];
  const remaining = line.slice(1);
  commands.push((2 & 0x7) | (remaining.length << 3));
  let prevX = firstX;
  let prevY = firstY;
  for (const [x, y] of remaining) {
    commands.push(zigzag(x - prevX), zigzag(y - prevY));
    prevX = x;
    prevY = y;
  }
  return commands;
}

function writeRoadFeature(feature: RoadFeature, pbf: PbfWriter): void {
  pbf.writeVarintField(1, feature.id); // MVT Feature.id (protobuf field 1)
  // tags: interleaved [keyIndex, valueIndex] - keys[0]="name"/values[0]=name,
  // keys[1]="class"/values[1]=class (only valid for a single feature, see above).
  pbf.writePackedVarint(2, [0, 0, 1, 1]);
  pbf.writeVarintField(3, 2); // GeomType.LINESTRING
  pbf.writePackedVarint(4, encodeLineGeometry(feature.line));
}

function writeRoadLayer(feature: RoadFeature, pbf: PbfWriter): void {
  pbf.writeVarintField(15, 2); // version
  pbf.writeStringField(1, "transportation_name");
  pbf.writeMessage(2, writeRoadFeature, feature);
  pbf.writeStringField(3, "name"); // keys[0]
  pbf.writeStringField(3, "class"); // keys[1]
  pbf.writeMessage(4, writeValue, feature.name); // values[0]
  pbf.writeMessage(4, writeValue, feature.roadClass); // values[1]
  pbf.writeVarintField(5, EXTENT);
}

function encodeRoadTile(feature: RoadFeature): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(3, writeRoadLayer, feature);
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

describe("cross-tile road/river label continuation", () => {
  it("splits one road name across two vertically adjacent tiles instead of suppressing or duplicating it", async () => {
    // Real-world motivation ("Am Sondert"): a road line touching a tile's edge has its
    // text center (50% arc length) land close enough to that edge that only ~90% of
    // the text would be visible in either tile alone - previously suppressed entirely.
    // The fix stitches each tile's local segment to its neighbor's matching segment
    // (by feature id) before placing the label, so the *same* combined line is used in
    // both tiles and the SVG viewport naturally clips each to its own half - "upper
    // half in the upper tile, lower half in the lower tile" per the reported behavior.
    const zoom = 12;
    const tileX = 300;
    const tileAY = 500; // north tile: local segment touches the tile's bottom edge
    const tileBY = 501; // south tile: local segment touches the tile's top edge
    const featureId = 55123456;
    const name = "Am Sondert";
    const roadClass = "residential";

    // Both segments lie on one straight diagonal line, in each tile's own local
    // 256px space, that meets exactly at the shared tile boundary (y=256 / y=0):
    //   tile A (north): (108,231) -> (128,256)
    //   tile B (south): (128,0)   -> (148,25)
    // i.e. one continuous road from (108,-25) to (148,281) in tile A's local frame.
    const toExtent = ([x, y]: [number, number]): [number, number] => [x * 16, y * 16];
    const tileABytes = encodeRoadTile({
      id: featureId,
      name,
      roadClass,
      line: [toExtent([108, 231]), toExtent([128, 256])],
    });
    const tileBBytes = encodeRoadTile({
      id: featureId,
      name,
      roadClass,
      line: [toExtent([128, 0]), toExtent([148, 25])],
    });

    const tiles = new Map<string, Uint8Array>([
      [`${zoom}/${tileX}/${tileAY}`, tileABytes],
      [`${zoom}/${tileX}/${tileBY}`, tileBBytes],
    ]);
    const archive: TileSource = {
      async getTile(z, x, y) {
        return tiles.get(`${z}/${x}/${y}`);
      },
    };
    const renderOptions = { labels: false, roadLabels: true, natureLabels: false, zoom };

    const svgA = await renderTileToSvg(tileABytes, { ...renderOptions, tileX, tileY: tileAY }, archive);
    const svgB = await renderTileToSvg(tileBBytes, { ...renderOptions, tileX, tileY: tileBY }, archive);

    expect(svgA).not.toBeNull();
    expect(svgB).not.toBeNull();

    // Regression guard: without stitching, this near-edge segment's text center falls
    // just past the ~90%-visible threshold in the *raw*, unextended local line alone,
    // so both tiles would previously suppress the label entirely.
    expect(svgA?.match(/Am Sondert/g)?.length ?? 0).toBe(1);
    expect(svgB?.match(/Am Sondert/g)?.length ?? 0).toBe(1);

    // Each tile's rendered path must actually be the *extended*, cross-tile-joined
    // line (reaching past its own 0..256 edge into the neighbor's half), not just its
    // own short local fragment - i.e. true stitching, not two independent renders.
    const pathDataOf = (svg: string): string => {
      const match = svg.match(/<path id="road-label-1" d="([^"]+)"/);
      if (!match) throw new Error("expected a road-label path in the SVG");
      return match[1];
    };
    const pathA = pathDataOf(svgA as string);
    const pathB = pathDataOf(svgB as string);
    expect(pathA).toMatch(/28[0-9](\.\d+)?\s*$/); // extends down past y=256 into tile B's half
    expect(pathB).toMatch(/M 1\d\d(\.\d+)? -2\d(\.\d+)?/); // extends up past y=0 into tile A's half
  });
});

describe("overzoom", () => {
  it("crops and scales the deepest real ancestor tile's geometry, and only the owning overzoomed child renders its area label", async () => {
    // The dataset only has data up to z12; z13 is requested (overzoom by one level).
    // The park polygon sits at local (32,96)x(32,96) in the real z12 tile - well
    // inside its top-left quadrant, not touching the z12 tile's own edges.
    const datasetMaxZoom = 12;
    const ancestorX = 10;
    const ancestorY = 10;
    const overzoomedZoom = 13;
    // z13 child (20,20) is the top-left quadrant of z12 tile (10,10) - offset (0,0),
    // scale 2 - so the polygon's local (32,96) crops+scales to (64,192): centered,
    // fully visible, and this child owns the resolved global anchor. Its diagonal
    // sibling (21,21) is the bottom-right quadrant - offset (128,128) - so the same
    // polygon crops+scales to (-192,-64): entirely outside 0..256, and does not own
    // the anchor, so it must not render the label at all (no local duplicate).
    const ownerX = ancestorX * 2;
    const ownerY = ancestorY * 2;
    const siblingX = ancestorX * 2 + 1;
    const siblingY = ancestorY * 2 + 1;

    const ancestorBytes = encodeParkTile([
      {
        name: "Ueberzoompark",
        kind: "Polygon",
        ring: [
          [512, 512],
          [1536, 512],
          [1536, 1536],
          [512, 1536],
        ],
      },
    ]);

    const archive: TileSource = {
      async getTile(z, x, y) {
        return z === datasetMaxZoom && x === ancestorX && y === ancestorY ? ancestorBytes : undefined;
      },
    };

    const baseOptions = {
      labels: false,
      roadLabels: false,
      natureLabels: true,
      zoom: overzoomedZoom,
      datasetMaxZoom,
    };

    const svgOwner = await renderTileToSvg(ancestorBytes, { ...baseOptions, tileX: ownerX, tileY: ownerY }, archive);
    const svgSibling = await renderTileToSvg(
      ancestorBytes,
      { ...baseOptions, tileX: siblingX, tileY: siblingY },
      archive
    );

    expect(svgOwner).toContain("Ueberzoompark");
    expect(svgSibling).not.toContain("Ueberzoompark");
  });

  it("renders identically to a real tile at the same zoom when datasetMaxZoom is unset (no overzoom)", async () => {
    const zoom = 12;
    const tileBytes = encodeParkTile([
      {
        name: "Normalpark",
        kind: "Polygon",
        ring: [
          [1536, 1536],
          [2560, 1536],
          [2560, 2560],
          [1536, 2560],
        ],
      },
    ]);
    const renderOptions = { labels: false, roadLabels: false, natureLabels: true, zoom, tileX: 42, tileY: 42 };

    const withoutMaxZoom = await renderTileToSvg(tileBytes, renderOptions);
    const withMaxZoomEqualToZoom = await renderTileToSvg(tileBytes, { ...renderOptions, datasetMaxZoom: zoom });

    expect(withoutMaxZoom).toContain("Normalpark");
    expect(withoutMaxZoom).toBe(withMaxZoomEqualToZoom);
  });

  it("shows a lower-priority road's label once overzoom is doing the zooming instead of real map detail", async () => {
    // REQUIREMENTS.md §8.2: from zoom 13+, only high-priority road classes get labels
    // (residential doesn't). That guard is calibrated for the dataset's own real,
    // detailed zoom levels - it must not also suppress residential road names once
    // zoom is climbing past the dataset's real max only via overzoom, where a tile
    // shows a much smaller, magnified slice of the same data and there's plenty of
    // room for every road name.
    const toExtent = ([x, y]: [number, number]): [number, number] => [x * 16, y * 16];
    const roadClass = "residential";
    const name = "Musterstraße";

    const atRealMaxZoomBytes = encodeRoadTile({
      id: 1,
      name,
      roadClass,
      line: [toExtent([64, 128]), toExtent([192, 128])],
    });
    const svgAtRealMaxZoom = await renderTileToSvg(atRealMaxZoomBytes, {
      labels: false,
      roadLabels: true,
      natureLabels: false,
      zoom: 14,
      tileX: 10,
      tileY: 10,
    });
    expect(svgAtRealMaxZoom).not.toContain(name);

    // Ancestor-local line (1,8)-(15,8) - a tiny sliver near the corner of the real z14
    // tile - crops+scales (factor 16, offset 0,0) into the z18 top-left child's local
    // space as (16,128)-(240,128): a comfortably visible, non-edge-touching line.
    const datasetMaxZoom = 14;
    const ancestorX = 3;
    const ancestorY = 3;
    const overzoomedZoom = 18;
    const childX = ancestorX * 2 ** (overzoomedZoom - datasetMaxZoom);
    const childY = ancestorY * 2 ** (overzoomedZoom - datasetMaxZoom);
    const ancestorBytes = encodeRoadTile({
      id: 2,
      name,
      roadClass,
      line: [toExtent([1, 8]), toExtent([15, 8])],
    });

    const svgOverzoomed = await renderTileToSvg(ancestorBytes, {
      labels: false,
      roadLabels: true,
      natureLabels: false,
      zoom: overzoomedZoom,
      tileX: childX,
      tileY: childY,
      datasetMaxZoom,
    });
    expect(svgOverzoomed).toContain(name);
  });
});
