// Config shape for `storage.data`/`storage.cache` in config.yaml - mirrors the storage
// config format used by michael-braun/image-server for consistency across projects
// (same shape, same field names).

export type StorageConfigFilesystem = {
  type: "filesystem";
  config: {
    path: string;
  };
};

export type StorageConfigS3 = {
  type: "s3";
  config: {
    bucket: string;
    region: string;
    // Optional if using IAM roles / the default AWS credential chain. Required
    // together - accessKeyId without secretAccessKey (or vice versa) is invalid.
    accessKeyId?: string;
    secretAccessKey?: string;
    // Optional, for S3-compatible services (MinIO, DigitalOcean Spaces, ...).
    endpoint?: string;
    // Optional, prefixes every key this provider reads/writes - lets data and cache
    // share one bucket without colliding.
    prefix?: string;
  };
};

// A bare string is shorthand for `{ type: "filesystem", config: { path: <string> } }`.
// Used as-is for `storage.data` (see StorageProviderFactory.create); `storage.cache`
// additionally accepts everything in CacheStorageConfig below.
export type StorageConfig = string | StorageConfigFilesystem | StorageConfigS3;

// An in-process, per-instance cache - gone on restart, never shared across API
// instances. Meant as the fast first layer in front of a persistent one (filesystem or
// S3), not a replacement for it - only valid for `storage.cache`, not `storage.data`.
// Bounded by count and/or total byte size, evicting least-recently-used entries once
// either limit is exceeded.
export type StorageConfigMemory = {
  type: "memory";
  config?: {
    maxItems?: number; // default 1000
    maxBytes?: number; // default 128 MiB
  };
};

// Restricts a storage.cache layer to a zoom range (inclusive on both ends) - e.g. to
// keep an S3 layer from being filled with deep-zoom tiles: `{ ..., maxZoom: 14 }`.
// Requests for a zoom outside the range are simply not written to that layer (and
// never read from it either), *not* an error - a zoom no layer covers just never gets
// cached (always re-rendered). Only meaningful on an object-form storage.cache entry
// (see CacheLayerConfig) - there's no notion of zoom layering for storage.data.
type ZoomRange = {
  minZoom?: number;
  maxZoom?: number;
};

// One storage.cache layer: any filesystem/S3/memory config, optionally scoped to a
// zoom range.
export type CacheLayerConfig = (StorageConfigFilesystem | StorageConfigS3 | StorageConfigMemory) & ZoomRange;

// storage.cache only (see StorageProviderFactory.createCache): a bare string (always
// unscoped - use the object form for zoom scoping), a single scoped/unscoped layer, or
// an array of either (layering). Reads check array entries in order and return the
// first hit (promoting it into every faster/earlier layer along the way, provided that
// layer's own zoom range covers it too); writes go to every layer whose zoom range
// covers the request. Typically `[memory, filesystem-or-s3]` - "look in the memory
// cache first, and if it's not there, check the next cache layer".
export type CacheStorageConfig = string | CacheLayerConfig | CacheStorageConfig[];
