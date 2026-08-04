import { NotFoundException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { resolve } from "node:path";
import { openPMTilesArchive, type LocalPMTilesArchive } from "../../pmtiles.js";
import { renderTileToSvg, type RenderOptions } from "../../renderer.js";

type TileArchive = Pick<LocalPMTilesArchive, "close" | "getHeader" | "getTile">;

@Injectable()
export class TilesService implements OnModuleInit, OnModuleDestroy {
  private archive?: TileArchive;
  private archivePromise?: Promise<TileArchive>;

  constructor(private readonly configService: ConfigService) {}

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

  async renderTileSvg(z: number, x: number, y: number): Promise<string> {
    const archive = await this.getArchive();
    if (z > archive.getHeader().maxZoom) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} is not available`);
    }

    const tileData = await archive.getTile(z, x, y);
    if (!tileData || tileData.byteLength === 0) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} is empty or missing`);
    }

    const svg = this.renderSvg(tileData, {
      labels: this.getBooleanConfig("tiles.labels", false),
      roadLabels: this.getBooleanConfig("tiles.roadLabels", false),
      natureLabels: this.getBooleanConfig("tiles.natureLabels", false),
      zoom: z,
      tileX: x,
      tileY: y,
    });

    if (!svg) {
      throw new NotFoundException(`Tile ${z}/${x}/${y} could not be rendered`);
    }

    return svg;
  }

  private async getArchive(): Promise<TileArchive> {
    if (this.archive) {
      return this.archive;
    }

    if (!this.archivePromise) {
      const inputPath = this.getInputPath();
      this.archivePromise = this.openArchive(inputPath)
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
    return openPMTilesArchive(inputPath);
  }

  protected renderSvg(tileBuffer: ArrayBuffer | Uint8Array, options: RenderOptions): string | null {
    return renderTileToSvg(tileBuffer, options);
  }

  private getInputPath(): string {
    const inputPath = this.configService.get<string>("tiles.input");
    if (!inputPath || inputPath.trim().length === 0) {
      throw new Error("Missing tiles.input in config.yaml");
    }
    return resolve(inputPath.trim());
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
