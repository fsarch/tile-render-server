// Config shape for `storage.data`/`storage.cache` in config.yaml - mirrors the
// storage config format used by michael-braun/image-server for consistency across
// projects (same shape, same field names).

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
export type StorageConfig = string | StorageConfigFilesystem | StorageConfigS3;
