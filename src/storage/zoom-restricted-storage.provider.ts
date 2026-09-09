import { Injectable } from "@nestjs/common";
import type { IStorageProvider } from "./storage-provider.interface.js";

// Cache keys are always `${datasetVersionId}/{z}/{x}/{y}.svg` (see
// TilesService.renderOrGetCached) - the only thing storage.cache is ever used for.
// This wrapper's whole purpose is scoping a cache layer to a zoom range, so it's
// necessarily coupled to that key format; if it ever changes, update this too.
const ZOOM_FROM_CACHE_KEY = /\/(\d+)\/\d+\/\d+\.svg$/;

export function extractZoomFromCacheKey(path: string): number | null {
  const match = ZOOM_FROM_CACHE_KEY.exec(path);
  return match ? Number(match[1]) : null;
}

// Wraps any IStorageProvider, restricting it to a zoom range - e.g. so an S3 layer
// doesn't get filled with deep-zoom tiles (`{ ..., maxZoom: 14 }`). A path outside the
// configured range is treated as "not here": exists() is false, mkdir/writeFile/
// deleteFile are silent no-ops, and readFile/readRange throw (matching what the
// underlying provider itself would do for a path that's genuinely never been written -
// this only happens if a caller reads a path directly rather than checking exists()
// first, since callers like LayeredStorageProvider and TilesService already gate on
// exists()). A path whose zoom can't be determined (doesn't match the expected cache
// key format) is never restricted - fail open rather than silently dropping data whose
// shape wasn't anticipated.
@Injectable()
export class ZoomRestrictedStorageProvider implements IStorageProvider {
  constructor(
    private readonly inner: IStorageProvider,
    private readonly minZoom?: number,
    private readonly maxZoom?: number
  ) {}

  private isInRange(path: string): boolean {
    const zoom = extractZoomFromCacheKey(path);
    if (zoom === null) return true;
    if (this.minZoom !== undefined && zoom < this.minZoom) return false;
    if (this.maxZoom !== undefined && zoom > this.maxZoom) return false;
    return true;
  }

  async readFile(path: string): Promise<Buffer> {
    if (!this.isInRange(path)) {
      throw new Error(`${path} is outside this cache layer's configured zoom range`);
    }
    return this.inner.readFile(path);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    if (!this.isInRange(path)) return;
    await this.inner.writeFile(path, data);
  }

  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    if (!this.isInRange(path)) {
      throw new Error(`${path} is outside this cache layer's configured zoom range`);
    }
    return this.inner.readRange(path, offset, length);
  }

  async exists(path: string): Promise<boolean> {
    if (!this.isInRange(path)) return false;
    return this.inner.exists(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.isInRange(path)) return;
    await this.inner.mkdir(path, options);
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.isInRange(path)) return;
    await this.inner.deleteFile(path);
  }
}
