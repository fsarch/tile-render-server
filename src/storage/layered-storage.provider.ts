import { Injectable } from "@nestjs/common";
import type { IStorageProvider } from "./storage-provider.interface.js";

// Checks each layer in order for reads ("look in the memory cache first, and if it's
// not there, check the next cache layer") and writes to every layer, so a caller never
// needs to know or care how many layers there are - see StorageConfig's array form and
// StorageProviderFactory. Layers are normally ordered fastest-first (e.g.
// [memory, filesystem-or-s3]).
@Injectable()
export class LayeredStorageProvider implements IStorageProvider {
  constructor(private readonly layers: IStorageProvider[]) {
    if (layers.length === 0) {
      throw new Error("LayeredStorageProvider requires at least one layer");
    }
  }

  async readFile(path: string): Promise<Buffer> {
    for (let i = 0; i < this.layers.length; i += 1) {
      if (!(await this.layers[i].exists(path))) continue;
      const data = await this.layers[i].readFile(path);
      await this.promote(path, data, i);
      return data;
    }
    throw new Error(`File not found in any storage layer: ${path}`);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.writeFile(path, data)));
  }

  // Delegates to the first layer that has the file, without promoting it - unlike
  // readFile's whole-file promotion, copying just the requested byte range into a
  // faster layer wouldn't leave that layer holding a usable copy of the whole file.
  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    for (const layer of this.layers) {
      if (await layer.exists(path)) {
        return layer.readRange(path, offset, length);
      }
    }
    throw new Error(`File not found in any storage layer: ${path}`);
  }

  async exists(path: string): Promise<boolean> {
    for (const layer of this.layers) {
      if (await layer.exists(path)) return true;
    }
    return false;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.mkdir(path, options)));
  }

  async deleteFile(path: string): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.deleteFile(path)));
  }

  // Backfills every layer faster than (i.e. checked before) the one the hit actually
  // came from, so the next read of the same path hits sooner. Best-effort: a faster
  // layer being briefly unavailable shouldn't fail a request that already succeeded
  // against a slower one.
  private async promote(path: string, data: Buffer, hitLayerIndex: number): Promise<void> {
    await Promise.all(
      this.layers.slice(0, hitLayerIndex).map((layer) => layer.writeFile(path, data).catch(() => {}))
    );
  }
}
