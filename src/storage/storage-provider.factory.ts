import type { CacheStorageConfig, StorageConfig } from "./storage-config.types.js";
import { FileSystemStorageProvider } from "./filesystem-storage.provider.js";
import { LayeredStorageProvider } from "./layered-storage.provider.js";
import { MemoryStorageProvider } from "./memory-storage.provider.js";
import { S3StorageProvider } from "./s3-storage.provider.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

export class StorageProviderFactory {
  // For storage.data: a single filesystem or S3 backend - no memory layer, no
  // layering. Reading a multi-GB pmtiles archive doesn't benefit from an in-memory
  // cache the way small rendered tiles do (see createCache).
  static create(config: StorageConfig): IStorageProvider {
    // A bare string is shorthand filesystem config (e.g. `storage.data: ./data`).
    if (typeof config === "string") {
      return new FileSystemStorageProvider(config);
    }

    if (config.type === "filesystem") {
      return new FileSystemStorageProvider(config.config.path);
    }

    if (config.type === "s3") {
      return new S3StorageProvider(config.config);
    }

    throw new Error(`Unknown storage type: ${(config as { type?: unknown }).type}`);
  }

  // For storage.cache only: everything `create` supports, plus a `memory` backend and
  // layering (an array of configs, checked in order - see CacheStorageConfig).
  static createCache(config: CacheStorageConfig): IStorageProvider {
    if (Array.isArray(config)) {
      if (config.length === 0) {
        throw new Error("storage.cache array must not be empty");
      }
      return new LayeredStorageProvider(config.map((layer) => StorageProviderFactory.createCache(layer)));
    }

    if (typeof config !== "string" && config.type === "memory") {
      return new MemoryStorageProvider(config.config);
    }

    return StorageProviderFactory.create(config);
  }
}
