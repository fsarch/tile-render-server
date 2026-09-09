import { describe, expect, it } from "vitest";
import { StorageProviderFactory } from "./storage-provider.factory.js";
import { FileSystemStorageProvider } from "./filesystem-storage.provider.js";
import { LayeredStorageProvider } from "./layered-storage.provider.js";
import { MemoryStorageProvider } from "./memory-storage.provider.js";
import { S3StorageProvider } from "./s3-storage.provider.js";

describe("StorageProviderFactory.create (storage.data)", () => {
  it("creates a FileSystemStorageProvider from a bare string (legacy shorthand)", () => {
    expect(StorageProviderFactory.create("./data")).toBeInstanceOf(FileSystemStorageProvider);
  });

  it("creates a FileSystemStorageProvider from an explicit filesystem config", () => {
    const provider = StorageProviderFactory.create({ type: "filesystem", config: { path: "./data" } });
    expect(provider).toBeInstanceOf(FileSystemStorageProvider);
  });

  it("creates an S3StorageProvider from an s3 config", () => {
    const provider = StorageProviderFactory.create({
      type: "s3",
      config: { bucket: "my-bucket", region: "eu-central-1" },
    });
    expect(provider).toBeInstanceOf(S3StorageProvider);
  });

  it("throws on an unknown storage type", () => {
    expect(() => StorageProviderFactory.create({ type: "unknown" } as never)).toThrow(/unknown storage type/i);
  });
});

describe("StorageProviderFactory.createCache (storage.cache)", () => {
  it("still supports every storage.data shape", () => {
    expect(StorageProviderFactory.createCache("./cache")).toBeInstanceOf(FileSystemStorageProvider);
    expect(
      StorageProviderFactory.createCache({ type: "s3", config: { bucket: "b", region: "eu-central-1" } })
    ).toBeInstanceOf(S3StorageProvider);
  });

  it("creates a MemoryStorageProvider from a memory config", () => {
    expect(StorageProviderFactory.createCache({ type: "memory" })).toBeInstanceOf(MemoryStorageProvider);
    expect(
      StorageProviderFactory.createCache({ type: "memory", config: { maxItems: 10 } })
    ).toBeInstanceOf(MemoryStorageProvider);
  });

  it("creates a LayeredStorageProvider from an array, in order", () => {
    const provider = StorageProviderFactory.createCache([{ type: "memory" }, "./cache"]);
    expect(provider).toBeInstanceOf(LayeredStorageProvider);
  });

  it("supports nested arrays", () => {
    const provider = StorageProviderFactory.createCache([[{ type: "memory" }], "./cache"]);
    expect(provider).toBeInstanceOf(LayeredStorageProvider);
  });

  it("throws on an empty array", () => {
    expect(() => StorageProviderFactory.createCache([])).toThrow(/must not be empty/i);
  });
});
