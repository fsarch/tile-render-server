import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { StorageConfig } from "./storage-config.types.js";
import { StorageProviderFactory } from "./storage-provider.factory.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

export const DATA_STORAGE_PROVIDER = "DATA_STORAGE_PROVIDER";
export const CACHE_STORAGE_PROVIDER = "CACHE_STORAGE_PROVIDER";

function createProvider(configService: ConfigService, key: "storage.data" | "storage.cache"): IStorageProvider {
  const config = configService.get<StorageConfig>(key);
  if (config === undefined) {
    throw new Error(`Missing "${key}" in config.yaml`);
  }
  return StorageProviderFactory.create(config);
}

// Builds the two storage backends from `storage.data`/`storage.cache` in config.yaml
// (see StorageConfig - a bare string, or `{ type: "filesystem" | "s3", config: {...} }`).
// Not @Global() (unlike the image-server module this mirrors) - only TilesModule needs
// these, so it imports this module directly rather than every module getting them.
@Module({
  providers: [
    {
      provide: DATA_STORAGE_PROVIDER,
      useFactory: (configService: ConfigService): IStorageProvider => createProvider(configService, "storage.data"),
      inject: [ConfigService],
    },
    {
      provide: CACHE_STORAGE_PROVIDER,
      useFactory: (configService: ConfigService): IStorageProvider => createProvider(configService, "storage.cache"),
      inject: [ConfigService],
    },
  ],
  exports: [DATA_STORAGE_PROVIDER, CACHE_STORAGE_PROVIDER],
})
export class StorageModule {}
