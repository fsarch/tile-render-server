import { NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { TilesService } from "./tiles.service.js";
import type { PostgresLabelAnchorCache } from "../../repositories/label-anchor/label-anchor-cache.postgres.js";
import type { DatasetVersionService } from "../../repositories/dataset-version/dataset-version.service.js";
import type { TemplateService } from "../../repositories/template/template.service.js";
import type { IStorageProvider } from "../../storage/storage-provider.interface.js";

// Fake stub: TilesService only calls setDatasetVersionId (to scope the cache to the
// active dataset_versions row) and threads the rest through to renderSvg - none of
// these tests exercise the label-anchor-cache mechanism itself (see renderer.spec.ts
// and label-anchor-cache.postgres.spec.ts for that).
const fakeLabelAnchorCache = {
  get: vi.fn(),
  set: vi.fn(),
  setDatasetVersionId: vi.fn(),
} as unknown as PostgresLabelAnchorCache;

function createDatasetVersionService(path: string | null = "./planet.pmtiles"): DatasetVersionService {
  return {
    getActive: vi.fn().mockResolvedValue(path === null ? null : { id: "v1", path, isActive: true }),
  } as unknown as DatasetVersionService;
}

function createTemplateService(colors: Record<string, string> | null = null): TemplateService {
  const row = colors === null ? null : { id: "t1", name: "test", colors, isActive: true };
  return {
    getActive: vi.fn().mockResolvedValue(row),
    getById: vi.fn((id: string) => Promise.resolve(id === "t1" ? row : null)),
  } as unknown as TemplateService;
}

// Defaults to an always-miss cache, so existing tests exercise the same
// render-from-scratch path they did before caching existed, unless a test overrides
// `exists`/`readFile` to simulate a hit.
function createStorageProvider(overrides: Partial<IStorageProvider> = {}): IStorageProvider {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readRange: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn(),
    ...overrides,
  };
}

class TestTilesService extends TilesService {
  constructor(
    configService: ConfigService,
    private readonly openArchiveMock: (inputPath: string) => Promise<{
      close: () => Promise<void>;
      getTile: (z: number, x: number, y: number) => Promise<ArrayBuffer | Uint8Array | undefined>;
      getHeader: () => { maxZoom: number };
    }>,
    private readonly renderSvgMock: (tileBuffer: ArrayBuffer | Uint8Array, options: Record<string, unknown>) => string | null,
    datasetVersionService: DatasetVersionService = createDatasetVersionService(),
    templateService: TemplateService = createTemplateService(),
    dataStorage: IStorageProvider = createStorageProvider(),
    cacheStorage: IStorageProvider = createStorageProvider()
  ) {
    super(configService, fakeLabelAnchorCache, datasetVersionService, templateService, dataStorage, cacheStorage);
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
  it("opens the archive at the active dataset_version's path and renders tiles with config-driven options", async () => {
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
        "tiles.labels": true,
        "tiles.roadLabels": true,
        "tiles.natureLabels": false,
      }),
      openArchive,
      renderTile,
      createDatasetVersionService("./planet.pmtiles")
    );

    await service.onModuleInit();
    const svg = await service.renderTileSvg(3, 4, 5);

    expect(svg).toBe("<svg />");
    expect(openArchive).toHaveBeenCalledTimes(1);
    expect(openArchive).toHaveBeenCalledWith("./planet.pmtiles");
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

  it("fails clearly when no dataset_version is active", async () => {
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn(),
      vi.fn(),
      createDatasetVersionService(null)
    );

    await expect(service.renderTileSvg(3, 4, 5)).rejects.toThrow(/no active dataset_version/i);
  });

  it("returns 404 when the tile is missing", async () => {
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(undefined),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />")
    );

    await expect(service.renderTileSvg(3, 4, 5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 404 above the dataset's max zoom when overzoom isn't configured", async () => {
    const getTile = vi.fn();
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile,
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />")
    );

    await expect(service.renderTileSvg(15, 4, 5)).rejects.toBeInstanceOf(NotFoundException);
    expect(getTile).not.toHaveBeenCalled();
  });

  it("overzooms beyond the dataset's max zoom when tiles.maxZoom allows it", async () => {
    const getTile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const renderTile = vi.fn().mockReturnValue("<svg />");
    const service = new TestTilesService(
      createConfigService({ "tiles.maxZoom": 16 }),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile,
        getHeader: () => ({ maxZoom: 14 }),
      }),
      renderTile
    );

    // z=16, x=20, y=21 is 4 levels... shift=2 below its ancestor at z=14: (20>>2, 21>>2) = (5, 5).
    const svg = await service.renderTileSvg(16, 20, 21);

    expect(svg).toBe("<svg />");
    expect(getTile).toHaveBeenCalledWith(14, 5, 5);
    expect(renderTile).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ zoom: 16, tileX: 20, tileY: 21, datasetMaxZoom: 14 })
    );
  });

  it("still returns 404 above the configured tiles.maxZoom ceiling", async () => {
    const getTile = vi.fn();
    const service = new TestTilesService(
      createConfigService({ "tiles.maxZoom": 16 }),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile,
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />")
    );

    await expect(service.renderTileSvg(17, 4, 5)).rejects.toBeInstanceOf(NotFoundException);
    expect(getTile).not.toHaveBeenCalled();
  });

  it("returns the rendered SVG unchanged when no template is active", async () => {
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg>rendered</svg>\n"),
      createDatasetVersionService(),
      createTemplateService(null)
    );

    expect(await service.renderTileSvg(3, 4, 5)).toBe("<svg>rendered</svg>\n");
  });

  it("injects the active template's colors as the last step, on top of the rendered SVG", async () => {
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>\n'),
      createDatasetVersionService(),
      createTemplateService({ "--map-water": "#123456" })
    );

    const svg = await service.renderTileSvg(3, 4, 5);

    expect(svg).toContain("<style>:root{--map-water:#123456;}</style>");
    expect(svg.indexOf("<style>")).toBeLessThan(svg.indexOf("<rect"));
  });

  it("looks up a template by id when one is given, ignoring which one is active", async () => {
    const templateService = createTemplateService({ "--map-water": "#123456" });
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>\n'),
      createDatasetVersionService(),
      templateService
    );

    const svg = await service.renderTileSvg(3, 4, 5, "t1");

    expect(templateService.getById).toHaveBeenCalledWith("t1");
    expect(templateService.getActive).not.toHaveBeenCalled();
    expect(svg).toContain("<style>:root{--map-water:#123456;}</style>");
  });

  it("returns 404 when the given template id doesn't exist", async () => {
    const service = new TestTilesService(
      createConfigService({}),
      vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        getTile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        getHeader: () => ({ maxZoom: 14 }),
      }),
      vi.fn().mockReturnValue("<svg />"),
      createDatasetVersionService(),
      createTemplateService(null)
    );

    await expect(service.renderTileSvg(3, 4, 5, "does-not-exist")).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("rendered-tile cache (storage.cache)", () => {
    it("renders and writes to the cache on a miss, keyed by dataset version and z/x/y", async () => {
      const getTile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
      const renderTile = vi.fn().mockReturnValue("<svg>fresh</svg>");
      const cacheStorage = createStorageProvider();
      const service = new TestTilesService(
        createConfigService({}),
        vi.fn().mockResolvedValue({
          close: vi.fn().mockResolvedValue(undefined),
          getTile,
          getHeader: () => ({ maxZoom: 14 }),
        }),
        renderTile,
        createDatasetVersionService("./planet.pmtiles"),
        createTemplateService(null),
        createStorageProvider(),
        cacheStorage
      );

      const svg = await service.renderTileSvg(3, 4, 5);

      expect(svg).toBe("<svg>fresh</svg>");
      expect(renderTile).toHaveBeenCalledTimes(1);
      expect(cacheStorage.exists).toHaveBeenCalledWith("v1/3/4/5.svg");
      expect(cacheStorage.mkdir).toHaveBeenCalledWith("v1/3/4", { recursive: true });
      expect(cacheStorage.writeFile).toHaveBeenCalledWith("v1/3/4/5.svg", Buffer.from("<svg>fresh</svg>", "utf8"));
    });

    it("returns the cached tile without rendering or fetching tile data again on a hit", async () => {
      const getTile = vi.fn();
      const renderTile = vi.fn();
      const cacheStorage = createStorageProvider({
        exists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue(Buffer.from("<svg>cached</svg>", "utf8")),
      });
      const service = new TestTilesService(
        createConfigService({}),
        vi.fn().mockResolvedValue({
          close: vi.fn().mockResolvedValue(undefined),
          getTile,
          getHeader: () => ({ maxZoom: 14 }),
        }),
        renderTile,
        createDatasetVersionService("./planet.pmtiles"),
        createTemplateService(null),
        createStorageProvider(),
        cacheStorage
      );

      const svg = await service.renderTileSvg(3, 4, 5);

      expect(svg).toBe("<svg>cached</svg>");
      expect(getTile).not.toHaveBeenCalled();
      expect(renderTile).not.toHaveBeenCalled();
      expect(cacheStorage.readFile).toHaveBeenCalledWith("v1/3/4/5.svg");
      expect(cacheStorage.writeFile).not.toHaveBeenCalled();
    });

    it("still applies the requested template on a cache hit (the cache only ever holds the un-styled render)", async () => {
      const cacheStorage = createStorageProvider({
        exists: vi.fn().mockResolvedValue(true),
        readFile: vi.fn().mockResolvedValue(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>', "utf8")),
      });
      const service = new TestTilesService(
        createConfigService({}),
        vi.fn().mockResolvedValue({
          close: vi.fn().mockResolvedValue(undefined),
          getTile: vi.fn(),
          getHeader: () => ({ maxZoom: 14 }),
        }),
        vi.fn(),
        createDatasetVersionService(),
        createTemplateService({ "--map-water": "#123456" }),
        createStorageProvider(),
        cacheStorage
      );

      const svg = await service.renderTileSvg(3, 4, 5);

      expect(svg).toContain("<style>:root{--map-water:#123456;}</style>");
    });
  });

  it("uses a default cache policy when none is configured", () => {
    const service = new TestTilesService(
      createConfigService({}),
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
