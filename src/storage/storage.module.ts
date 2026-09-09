import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CacheStorageConfig, StorageConfig } from "./storage-config.types.js";
import { StorageProviderFactory } from "./storage-provider.factory.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

export const DATA_STORAGE_PROVIDER = "DATA_STORAGE_PROVIDER";
export const CACHE_STORAGE_PROVIDER = "CACHE_STORAGE_PROVIDER";

function createDataProvider(configService: ConfigService): IStorageProvider {
  const config = configService.get<StorageConfig>("storage.data");
  if (config === undefined) {
    throw new Error('Missing "storage.data" in config.yaml');
  }
  return StorageProviderFactory.create(config);
}

function createCacheProvider(configService: ConfigService): IStorageProvider {
  const config = configService.get<CacheStorageConfig>("storage.cache");
  if (config === undefined) {
    throw new Error('Missing "storage.cache" in config.yaml');
  }
  return StorageProviderFactory.createCache(config);
}

// Builds the two storage backends from `storage.data`/`storage.cache` in config.yaml
// (see storage-config.types.ts). storage.data is always a single filesystem or S3
// backend (StorageProviderFactory.create); storage.cache additionally accepts a
// `memory` backend and layering - "look in the memory cache first, and if it's not
// there, check the next cache layer" (StorageProviderFactory.createCache).
// Not @Global() (unlike the image-server module this mirrors) - only TilesModule needs
// these, so it imports this module directly rather than every module getting them.
@Module({
  providers: [
    {
      provide: DATA_STORAGE_PROVIDER,
      useFactory: createDataProvider,
      inject: [ConfigService],
    },
    {
      provide: CACHE_STORAGE_PROVIDER,
      useFactory: createCacheProvider,
      inject: [ConfigService],
    },
  ],
  exports: [DATA_STORAGE_PROVIDER, CACHE_STORAGE_PROVIDER],
})
export class StorageModule {}
