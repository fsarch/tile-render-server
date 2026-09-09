import type { StorageConfig } from "./storage-config.types.js";
import { FileSystemStorageProvider } from "./filesystem-storage.provider.js";
import { S3StorageProvider } from "./s3-storage.provider.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

export class StorageProviderFactory {
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
}
