import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TilesService } from "./tiles.service.js";
import type { PostgresLabelAnchorCache } from "./label-anchor-cache.postgres.js";

// Fake stub: TilesService only threads this through to renderSvg, never calls its
// methods directly - none of these tests exercise the label-anchor-cache mechanism
// itself (see renderer.spec.ts and label-anchor-cache.postgres.spec.ts for that).
const fakeLabelAnchorCache = {
  get: vi.fn(),
  set: vi.fn(),
} as unknown as PostgresLabelAnchorCache;

class TestTilesService extends TilesService {
  constructor(
    configService: ConfigService,
    private readonly openArchiveMock: (inputPath: string) => Promise<{
      close: () => Promise<void>;
      getTile: (z: number, x: number, y: number) => Promise<ArrayBuffer | Uint8Array | undefined>;
      getHeader: () => { maxZoom: number };
    }>,
    private readonly renderSvgMock: (tileBuffer: ArrayBuffer | Uint8Array, options: Record<string, unknown>) => string | null
  ) {
    super(configService, fakeLabelAnchorCache);
  }

  protected override openArchive(inputPath: string) {
    return this.openArchiveMock(inputPath);
  }

  protected override async renderSvg(tileBuffer: ArrayBuffer | Uint8Array, options: Record<string, unknown>) {
    return this.renderSvgMock(tileBuffer, options);
  }
}

function createConfigService(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("TilesService", () => {
  it("opens the configured archive once and renders tiles with config-driven options", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const getTile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const openArchive = vi.fn().mockResolvedValue({
      close,
      getTile,
      getHeader: () => ({ maxZoom: 14 }),
    });
    const renderTile = vi.fn().mockReturnValue("<svg />");

    const service = new TestTilesService(
      createConfigService({
        "tiles.input": "./planet.pmtiles",
        "tiles.labels": true,
        "tiles.roadLabels": true,
        "tiles.natureLabels": false,
      }),
      openArchive,
      renderTile
    );

    await service.onModuleInit();
    const svg = await service.renderTileSvg(3, 4, 5);

    expect(svg).toBe("<svg />");
    expect(openArchive).toHaveBeenCalledTimes(1);
    expect(openArchive).toHaveBeenCalledWith(resolve("./planet.pmtiles"));
    expect(renderTile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        labels: true,
        roadLabels: true,
        natureLabels: false,
        zoom: 3,
        tileX: 4,
        tileY: 5,
      })
    );

    await service.onModuleDestroy();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the tile is missing", async () => {
    const service = new TestTilesService(
      createConfigService({ "tiles.input": "./planet.pmtiles" }),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(undefined),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />")
    );

    await expect(service.renderTileSvg(3, 4, 5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("uses a default cache policy when none is configured", () => {
    const service = new TestTilesService(
      createConfigService({ "tiles.input": "./planet.pmtiles" }),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(undefined),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />")
    );

    expect(service.getCacheControl()).toBe("public, max-age=3600");
  });
});
