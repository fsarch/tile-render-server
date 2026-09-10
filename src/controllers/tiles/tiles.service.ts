import { NotFoundException, ServiceUnavailableException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { withSpan } from "@fsarch/server/tracing";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import { TRACER_NAME } from "../../tracing.js";
import { computeOverzoomTransform } from "../../core/geometry.js";
import { openPMTilesArchiveFromStorage, type LocalPMTilesArchive } from "../../core/pmtiles.js";
import type { RenderOptions } from "../../core/renderer.js";
import { injectStyleTemplate } from "../../core/svg.js";
import type { LabelAnchorCache } from "../../core/label-anchor-cache.js";
import { PostgresLabelAnchorCache } from "../../repositories/label-anchor/label-anchor-cache.postgres.js";
import { DatasetVersionService } from "../../repositories/dataset-version/dataset-version.service.js";
import { TemplateService } from "../../repositories/template/template.service.js";
import { CACHE_STORAGE_PROVIDER, DATA_STORAGE_PROVIDER } from "../../storage/storage.module.js";
import type { IStorageProvider } from "../../storage/storage-provider.interface.js";
import type { StorageConfig } from "../../storage/storage-config.types.js";
import { RenderQueueFullError, RenderWorkerPool } from "./render-worker-pool.js";

type TileArchive = Pick<LocalPMTilesArchive, "close" | "getHeader" | "getTile">;

@Injectable()
export class TilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TilesService.name);
  private archive?: TileArchive;
  private archivePromise?: Promise<TileArchive>;
  // Set alongside the archive itself (see getInputPath) - scopes cache entries to the
  // dataset they were rendered from, so a dataset_versions swap (+ API restart) can
  // never serve a stale cached tile left over from a previous, different dataset.
  private datasetVersionId?: string;
  // The resolved dataset_versions path (see getInputPath) - stashed so createRenderPool
  // can hand it to worker threads once the archive itself has finished opening.
  private inputPath?: string;
  private renderPool?: RenderWorkerPool;
  private renderPoolPromise?: Promise<RenderWorkerPool>;

  constructor(
    private readonly configService: ConfigService,
    private readonly labelAnchorCache: PostgresLabelAnchorCache,
    private readonly datasetVersionService: DatasetVersionService,
    private readonly templateService: TemplateService,
    @Inject(DATA_STORAGE_PROVIDER) private readonly dataStorage: IStorageProvider,
    @Inject(CACHE_STORAGE_PROVIDER) private readonly cacheStorage: IStorageProvider
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getArchive();
    await this.getRenderPool();
  }

  async onModuleDestroy(): Promise<void> {
    const archive = this.archive ?? (this.archivePromise ? await this.archivePromise : undefined);
    this.archive = undefined;
    this.archivePromise = undefined;
    if (archive) {
      await archive.close();
    }

    const pool = this.renderPool ?? (this.renderPoolPromise ? await this.renderPoolPromise.catch(() => undefined) : undefined);
    this.renderPool = undefined;
    this.renderPoolPromise = undefined;
    if (pool) {
      await pool.close();
    }
  }

  getCacheControl(): string {
    const value = this.configService.get<string>("tiles.cacheControl");
    return value && value.trim().length > 0 ? value.trim() : "public, max-age=3600";
  }

  // Wrapped in one root span per request ("tiles.render") so a trace shows the full
  // request breakdown - cache lookup, source tile fetch, actual render, cache write,
  // template lookup - as its nested children (see renderOrGetCached and
  // RenderWorkerPool for the more granular spans underneath). Safe to leave in place
  // unconditionally: with tracing disabled/uninitialized this runs against
  // OpenTelemetry's no-op tracer (see src/tracing.ts).
  async renderTileSvg(z: number, x: number, y: number, templateId?: string): Promise<string> {
    return withSpan(
      "tiles.render",
      async () => {
        const archive = await this.getArchive();
        const datasetMaxZoom = archive.getHeader().maxZoom;
        if (z > this.getServingMaxZoom(datasetMaxZoom)) {
          throw new NotFoundException(`Tile ${z}/${x}/${y} is not available`);
        }

        const svg = await this.renderOrGetCached(archive, datasetMaxZoom, z, x, y);

        // Styling is a separate, cheap step from rendering (see injectStyleTemplate):
        // looked up fresh on every request (unlike the dataset path above, which is
        // resolved once at archive-open time), so activating a different template - or
        // requesting a specific one by id (GET /v1/templates/:id/tiles/...) - takes
        // effect immediately, without restarting the API or touching the rendered tile
        // itself. No active/matching template just means every themeable color keeps
        // its default. This also applies on a cache hit - storage.cache only ever
        // holds the un-styled render (see renderOrGetCached), so it's unaffected by
        // which template is active.
        return withSpan(
          "tiles.render.apply_template",
          async () => {
            const template = templateId
              ? await this.templateService.getById(templateId)
              : await this.templateService.getActive();
            if (templateId && !template) {
              throw new NotFoundException(`Template "${templateId}" not found`);
            }
            return injectStyleTemplate(svg, template?.colors);
          },
          { tracerName: TRACER_NAME }
        );
      },
      {
        tracerName: TRACER_NAME,
        attributes: {
          "tile.z": z,
          "tile.x": x,
          "tile.y": y,
          ...(templateId ? { "tile.template_id": templateId } : {}),
        },
      }
    );
  }

  // Rendering (this) and styling (injectStyleTemplate, above) are kept separate
  // specifically so the *rendered* tile can be cached and reused regardless of which
  // template ends up being applied to it - see storage.cache in config.yaml.
  private async renderOrGetCached(
    archive: TileArchive,
    datasetMaxZoom: number,
    z: number,
    x: number,
    y: number
  ): Promise<string> {
    const cacheKey = `${this.datasetVersionId}/${z}/${x}/${y}.svg`;

    const cached = await withSpan(
      "tiles.render.cache_lookup",
      async (span) => {
        const hit = await this.cacheStorage.exists(cacheKey);
        span.setAttribute("cache.hit", hit);
        return hit ? (await this.cacheStorage.readFile(cacheKey)).toString("utf8") : undefined;
      },
      { tracerName: TRACER_NAME, attributes: { "cache.key": cacheKey } }
    );
    if (cached !== undefined) {
      return cached;
    }

    // Beyond datasetMaxZoom, there's no real data for (z, x, y) - fetch the deepest
    // real ancestor tile instead and let renderSvg's overzoom transform below crop and
    // scale its geometry to stand in for the requested tile.
    const { sourceZoom, sourceX, sourceY } = computeOverzoomTransform(z, x, y, datasetMaxZoom);
    const tileData = await withSpan(
      "tiles.render.fetch_source_tile",
      () => archive.getTile(sourceZoom, sourceX, sourceY),
      {
        tracerName: TRACER_NAME,
        attributes: { "tile.source_z": sourceZoom, "tile.source_x": sourceX, "tile.source_y": sourceY },
      }
    );
    if (!tileData || tileData.byteLength === 0) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} is empty or missing`);
    }

    const svg = await withSpan(
      "tiles.render.render_svg",
      () =>
        this.renderSvg(
          tileData,
          {
            labels: this.getBooleanConfig("tiles.labels", false),
            roadLabels: this.getBooleanConfig("tiles.roadLabels", false),
            natureLabels: this.getBooleanConfig("tiles.natureLabels", false),
            zoom: z,
            tileX: x,
            tileY: y,
            datasetMaxZoom,
          },
          archive,
          this.labelAnchorCache
        ),
      { tracerName: TRACER_NAME }
    );

    if (!svg) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} could not be rendered`);
    }

    await withSpan(
      "tiles.render.cache_write",
      async () => {
        await this.cacheStorage.mkdir(dirname(cacheKey), { recursive: true });
        await this.cacheStorage.writeFile(cacheKey, Buffer.from(svg, "utf8"));
      },
      { tracerName: TRACER_NAME, attributes: { "cache.key": cacheKey } }
    );
    return svg;
  }

  // How far past the dataset's own max zoom the API will overzoom. Configurable via
  // `tiles.maxZoom` (config.yaml); a configured value can only extend serving beyond
  // the dataset's real max zoom, never shrink it below what's actually available.
  private getServingMaxZoom(datasetMaxZoom: number): number {
    const configured = Number(this.configService.get<unknown>("tiles.maxZoom"));
    return Number.isInteger(configured) ? Math.max(configured, datasetMaxZoom) : datasetMaxZoom;
  }

  private async getArchive(): Promise<TileArchive> {
    if (this.archive) {
      return this.archive;
    }

    if (!this.archivePromise) {
      this.archivePromise = this.getInputPath()
        .then((inputPath) => this.openArchiveWithContext(inputPath))
        .then((archive) => {
          this.archive = archive;
          return archive;
        })
        .catch((error) => {
          this.archivePromise = undefined;
          throw error;
        });
    }

    return this.archivePromise;
  }

  protected openArchive(inputPath: string): Promise<TileArchive> {
    return openPMTilesArchiveFromStorage(this.dataStorage, inputPath);
  }

  // The underlying storage provider (see S3StorageProvider) already names the
  // bucket/key/operation a read failed on - what's still missing at that point is
  // *which* dataset_versions row/path we were even trying to open, without which e.g.
  // "S3 GetObject failed for s3://bucket/key (AccessDenied)" is hard to connect back
  // to config. Re-thrown with `cause` so the original error (name, $metadata, stack)
  // is never lost, just annotated - see main.ts's bootstrap error logging, which walks
  // the full `cause` chain.
  private async openArchiveWithContext(inputPath: string): Promise<TileArchive> {
    try {
      return await this.openArchive(inputPath);
    } catch (error) {
      throw new Error(
        `Failed to open PMTiles archive for dataset_version ${this.datasetVersionId} at path "${inputPath}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  // The default (production) path hands rendering off to a pool of worker threads (see
  // RenderWorkerPool) instead of calling renderTileToSvg directly on the main thread -
  // that's real CPU work (MVT decode, geometry, SVG string building) that would
  // otherwise serialize concurrent requests on Node's single JS thread. `archive` isn't
  // forwarded: each worker opens its own for the cross-tile neighbor/ancestor lookups
  // renderTileToSvg needs internally (see render.worker.ts) - it stays a parameter here
  // only so tests can keep overriding this method with the same shape they always have.
  protected async renderSvg(
    tileBuffer: ArrayBuffer | Uint8Array,
    options: RenderOptions,
    _archive: TileArchive,
    labelAnchorCache: LabelAnchorCache
  ): Promise<string | null> {
    const pool = await this.getRenderPool();
    try {
      return await pool.render(tileBuffer, options, labelAnchorCache);
    } catch (error) {
      if (error instanceof RenderQueueFullError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }

  private async getRenderPool(): Promise<RenderWorkerPool> {
    if (this.renderPool) {
      return this.renderPool;
    }

    if (!this.renderPoolPromise) {
      // Needs inputPath (and, transitively, datasetVersionId) resolved first - both are
      // set as a side effect of getArchive() -> getInputPath().
      this.renderPoolPromise = this.getArchive()
        .then(() => this.createRenderPool())
        .then((pool) => {
          this.renderPool = pool;
          return pool;
        })
        .catch((error) => {
          this.renderPoolPromise = undefined;
          throw error;
        });
    }

    return this.renderPoolPromise;
  }

  protected createRenderPool(): RenderWorkerPool {
    const storageConfig = this.configService.get<StorageConfig>("storage.data");
    if (storageConfig === undefined) {
      throw new Error('Missing "storage.data" in config.yaml');
    }
    if (!this.inputPath) {
      throw new Error("createRenderPool called before the input path was resolved");
    }

    const { concurrency, source } = this.resolveRenderConcurrency();
    this.logger.log(`Starting render worker pool with concurrency=${concurrency} (${source})`);

    return new RenderWorkerPool({
      storageConfig,
      inputPath: this.inputPath,
      labels: this.getBooleanConfig("tiles.labels", false),
      roadLabels: this.getBooleanConfig("tiles.roadLabels", false),
      natureLabels: this.getBooleanConfig("tiles.natureLabels", false),
      concurrency,
    });
  }

  // How many worker threads render concurrently within this one process (see
  // RenderWorkerPool) - configurable via tiles.renderConcurrency (config.yaml). This is
  // the lever for using more of a single pod/instance's CPU allocation without scaling
  // out more instances (which mainly buys memory overhead, not more rendering
  // throughput, once a single instance is already CPU-bound). Defaults to the CPU
  // count, capped at 8 - the same default the batch CLI uses for its own worker pool.
  // `source` is only for the startup log (see createRenderPool) - explains *why* this
  // number was picked, since availableParallelism() reflects the container's own cgroup
  // CPU quota under k8s, not necessarily the host's full core count.
  private resolveRenderConcurrency(): { concurrency: number; source: string } {
    const configured = Number(this.configService.get<unknown>("tiles.renderConcurrency"));
    if (Number.isInteger(configured) && configured > 0) {
      return { concurrency: configured, source: "tiles.renderConcurrency" };
    }
    const cpuCount = availableParallelism();
    return { concurrency: Math.max(1, Math.min(8, cpuCount)), source: `default, availableParallelism()=${cpuCount}` };
  }

  // The pmtiles path comes exclusively from the dataset_versions table now (see
  // DatasetVersion entity) - there is no config.yaml fallback. It's a *key* resolved
  // through storage.data (see src/storage/), not necessarily a literal filesystem
  // path - a local base directory, or an S3 bucket/prefix, depending on config.yaml.
  // Like the old tiles.input setting, this is only read once (here, at archive-open
  // time): the active row can be changed at any time, but the running API only picks
  // up a new path on its next restart (the opened archive isn't hot-swapped
  // mid-process).
  private async getInputPath(): Promise<string> {
    const activeVersion = await this.datasetVersionService.getActive();
    if (!activeVersion || activeVersion.path.trim().length === 0) {
      throw new Error(
        "No active dataset_version configured - insert a row into the dataset_versions table and set is_active = true"
      );
    }
    this.datasetVersionId = activeVersion.id;
    this.labelAnchorCache.setDatasetVersionId(activeVersion.id);
    this.inputPath = activeVersion.path.trim();
    return this.inputPath;
  }

  private getBooleanConfig(key: string, fallback: boolean): boolean {
    const value = this.configService.get<unknown>(key);
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    return fallback;
  }
}
