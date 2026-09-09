import { Injectable } from "@nestjs/common";
import type { StorageConfigMemory } from "./storage-config.types.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

const DEFAULT_MAX_ITEMS = 1000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024; // 128 MiB

// An in-process LRU cache - see StorageConfigMemory. `Map` iteration order is
// insertion order, so re-inserting an entry on every read/write is enough to track
// recency: the least-recently-used entry is always the first one Map.keys() yields.
@Injectable()
export class MemoryStorageProvider implements IStorageProvider {
  private readonly store = new Map<string, Buffer>();
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(config: StorageConfigMemory["config"] = {}) {
    this.maxItems = config?.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async readFile(path: string): Promise<Buffer> {
    const data = this.store.get(path);
    if (!data) {
      throw new Error(`File not found in memory storage: ${path}`);
    }
    this.touch(path, data);
    return data;
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    this.removeInternal(path);
    this.store.set(path, data);
    this.totalBytes += data.byteLength;
    this.evictIfNeeded();
  }

  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    const data = await this.readFile(path);
    return data.subarray(offset, offset + length);
  }

  async exists(path: string): Promise<boolean> {
    return this.store.has(path);
  }

  // No real directory concept in an in-memory key/value store.
  async mkdir(): Promise<void> {
    return Promise.resolve();
  }

  async deleteFile(path: string): Promise<void> {
    this.removeInternal(path);
  }

  private touch(path: string, data: Buffer): void {
    this.store.delete(path);
    this.store.set(path, data);
  }

  private removeInternal(path: string): void {
    const existing = this.store.get(path);
    if (existing) {
      this.totalBytes -= existing.byteLength;
      this.store.delete(path);
    }
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxItems || this.totalBytes > this.maxBytes) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.removeInternal(oldestKey);
    }
  }
}
