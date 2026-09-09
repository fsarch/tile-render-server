import { describe, expect, it, vi } from "vitest";
import { extractZoomFromCacheKey, ZoomRestrictedStorageProvider } from "./zoom-restricted-storage.provider.js";
import { MemoryStorageProvider } from "./memory-storage.provider.js";

describe("extractZoomFromCacheKey", () => {
  it("extracts the zoom from a {datasetVersionId}/{z}/{x}/{y}.svg key", () => {
    expect(extractZoomFromCacheKey("v1/14/8495/5473.svg")).toBe(14);
  });

  it("extracts the zoom from a directory-only {datasetVersionId}/{z}/{x} key (the shape TilesService passes to mkdir())", () => {
    expect(extractZoomFromCacheKey("v1/14/8495")).toBe(14);
  });

  it("returns null for a key that doesn't match the expected shape", () => {
    expect(extractZoomFromCacheKey("not-a-tile-key.txt")).toBeNull();
  });
});

describe("ZoomRestrictedStorageProvider", () => {
  it("passes reads/writes through for a zoom within range", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, 10, 14);

    await provider.writeFile("v1/12/1/1.svg", Buffer.from("hi"));

    expect(await provider.exists("v1/12/1/1.svg")).toBe(true);
    expect(await provider.readFile("v1/12/1/1.svg")).toEqual(Buffer.from("hi"));
    expect(await inner.exists("v1/12/1/1.svg")).toBe(true);
  });

  it("silently drops writes for a zoom above maxZoom", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);

    await provider.writeFile("v1/18/1/1.svg", Buffer.from("hi"));

    expect(await inner.exists("v1/18/1/1.svg")).toBe(false);
  });

  it("reports exists() as false for a zoom outside the range, without touching the inner provider", async () => {
    const inner = new MemoryStorageProvider();
    await inner.writeFile("v1/18/1/1.svg", Buffer.from("hi")); // written directly, bypassing the wrapper
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);

    expect(await provider.exists("v1/18/1/1.svg")).toBe(false);
  });

  it("silently drops writes for a zoom below minZoom", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, 10);

    await provider.writeFile("v1/5/1/1.svg", Buffer.from("hi"));

    expect(await inner.exists("v1/5/1/1.svg")).toBe(false);
  });

  it("mkdir/deleteFile are no-ops for an out-of-range path", async () => {
    const inner = new MemoryStorageProvider();
    await inner.writeFile("v1/18/1/1.svg", Buffer.from("hi"));
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);
    const mkdirSpy = vi.spyOn(inner, "mkdir");

    await provider.deleteFile("v1/18/1/1.svg");
    await provider.mkdir("v1/18/1"); // the directory-only shape mkdir() is actually called with

    expect(await inner.exists("v1/18/1/1.svg")).toBe(true); // untouched by deleteFile above
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it("mkdir passes through for a directory-only path within range", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);
    const mkdirSpy = vi.spyOn(inner, "mkdir");

    await provider.mkdir("v1/12/1");

    expect(mkdirSpy).toHaveBeenCalledWith("v1/12/1", undefined);
  });

  it("readFile/readRange throw for an out-of-range path", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);

    await expect(provider.readFile("v1/18/1/1.svg")).rejects.toThrow(/outside this cache layer/i);
    await expect(provider.readRange("v1/18/1/1.svg", 0, 1)).rejects.toThrow(/outside this cache layer/i);
  });

  it("fails open (treats as in-range) when the zoom can't be determined from the key", async () => {
    const inner = new MemoryStorageProvider();
    const provider = new ZoomRestrictedStorageProvider(inner, undefined, 14);

    await provider.writeFile("some-other-key.txt", Buffer.from("hi"));

    expect(await inner.exists("some-other-key.txt")).toBe(true);
  });
});
