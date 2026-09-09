import { NotFoundException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { dirname } from "node:path";
import { computeOverzoomTransform } from "../../core/geometry.js";
import { openPMTilesArchiveFromStorage, type LocalPMTilesArchive } from "../../core/pmtiles.js";
import { renderTileToSvg, type RenderOptions } from "../../core/renderer.js";
import { injectStyleTemplate } from "../../core/svg.js";
import type { LabelAnchorCache } from "../../core/label-anchor-cache.js";
import { PostgresLabelAnchorCache } from "../../repositories/label-anchor/label-anchor-cache.postgres.js";
import { DatasetVersionService } from "../../repositories/dataset-version/dataset-version.service.js";
import { TemplateService } from "../../repositories/template/template.service.js";
import { CACHE_STORAGE_PROVIDER, DATA_STORAGE_PROVIDER } from "../../storage/storage.module.js";
import type { IStorageProvider } from "../../storage/storage-provider.interface.js";

type TileArchive = Pick<LocalPMTilesArchive, "close" | "getHeader" | "getTile">;

@Injectable()
export class TilesService implements OnModuleInit, OnModuleDestroy {
  private archive?: TileArchive;
  private archivePromise?: Promise<TileArchive>;
  // Set alongside the archive itself (see getInputPath) - scopes cache entries to the
  // dataset they were rendered from, so a dataset_versions swap (+ API restart) can
  // never serve a stale cached tile left over from a previous, different dataset.
  private datasetVersionId?: string;

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
  }

  async onModuleDestroy(): Promise<void> {
    const archive = this.archive ?? (this.archivePromise ? await this.archivePromise : undefined);
    this.archive = undefined;
    this.archivePromise = undefined;
    if (archive) {
      await archive.close();
    }
  }

  getCacheControl(): string {
    const value = this.configService.get<string>("tiles.cacheControl");
    return value && value.trim().length > 0 ? value.trim() : "public, max-age=3600";
  }

  async renderTileSvg(z: number, x: number, y: number, templateId?: string): Promise<string> {
    const archive = await this.getArchive();
    const datasetMaxZoom = archive.getHeader().maxZoom;
    if (z > this.getServingMaxZoom(datasetMaxZoom)) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} is not available`);
    }

    const svg = await this.renderOrGetCached(archive, datasetMaxZoom, z, x, y);

    // Styling is a separate, cheap step from rendering (see injectStyleTemplate):
    // looked up fresh on every request (unlike the dataset path above, which is
    // resolved once at archive-open time), so activating a different template - or
    // requesting a specific one by id (GET /v1/templates/:id/tiles/...) - takes effect
    // immediately, without restarting the API or touching the rendered tile itself. No
    // active/matching template just means every themeable color keeps its default.
    // This also applies on a cache hit - storage.cache only ever holds the un-styled
    // render (see renderOrGetCached), so it's unaffected by which template is active.
    const template = templateId
      ? await this.templateService.getById(templateId)
      : await this.templateService.getActive();
    if (templateId && !template) {
      throw new NotFoundException(`Template "${templateId}" not found`);
    }
    return injectStyleTemplate(svg, template?.colors);
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
    if (await this.cacheStorage.exists(cacheKey)) {
      return (await this.cacheStorage.readFile(cacheKey)).toString("utf8");
    }

    // Beyond datasetMaxZoom, there's no real data for (z, x, y) - fetch the deepest
    // real ancestor tile instead and let renderSvg's overzoom transform below crop and
    // scale its geometry to stand in for the requested tile.
    const { sourceZoom, sourceX, sourceY } = computeOverzoomTransform(z, x, y, datasetMaxZoom);
    const tileData = await archive.getTile(sourceZoom, sourceX, sourceY);
    if (!tileData || tileData.byteLength === 0) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} is empty or missing`);
    }

    const svg = await this.renderSvg(
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
    );

    if (!svg) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} could not be rendered`);
    }

    await this.cacheStorage.mkdir(dirname(cacheKey), { recursive: true });
    await this.cacheStorage.writeFile(cacheKey, Buffer.from(svg, "utf8"));
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
        .then((inputPath) => this.openArchive(inputPath))
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

  protected renderSvg(
    tileBuffer: ArrayBuffer | Uint8Array,
    options: RenderOptions,
    archive: TileArchive,
    labelAnchorCache: LabelAnchorCache
  ): Promise<string | null> {
    return renderTileToSvg(tileBuffer, options, archive, labelAnchorCache);
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
    return activeVersion.path.trim();
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
