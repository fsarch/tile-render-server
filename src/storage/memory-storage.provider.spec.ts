import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "./memory-storage.provider.js";

describe("MemoryStorageProvider", () => {
  it("writes and reads back a file", async () => {
    const provider = new MemoryStorageProvider();

    await provider.writeFile("foo.svg", Buffer.from("hello"));

    expect(await provider.exists("foo.svg")).toBe(true);
    expect(await provider.readFile("foo.svg")).toEqual(Buffer.from("hello"));
  });

  it("readFile throws when the path isn't present", async () => {
    const provider = new MemoryStorageProvider();
    await expect(provider.readFile("missing.svg")).rejects.toThrow(/not found/i);
  });

  it("exists reflects presence without throwing", async () => {
    const provider = new MemoryStorageProvider();
    expect(await provider.exists("missing.svg")).toBe(false);
  });

  it("readRange slices the stored buffer", async () => {
    const provider = new MemoryStorageProvider();
    await provider.writeFile("data.bin", Buffer.from("0123456789"));

    expect(await provider.readRange("data.bin", 2, 4)).toEqual(Buffer.from("2345"));
  });

  it("deleteFile removes the entry", async () => {
    const provider = new MemoryStorageProvider();
    await provider.writeFile("foo.svg", Buffer.from("hello"));

    await provider.deleteFile("foo.svg");

    expect(await provider.exists("foo.svg")).toBe(false);
  });

  it("mkdir is a no-op", async () => {
    await expect(new MemoryStorageProvider().mkdir("some/dir")).resolves.toBeUndefined();
  });

  it("evicts the least-recently-used entry once maxItems is exceeded", async () => {
    const provider = new MemoryStorageProvider({ maxItems: 2 });

    await provider.writeFile("a", Buffer.from("1"));
    await provider.writeFile("b", Buffer.from("2"));
    await provider.readFile("a"); // touches "a", making "b" the least-recently-used
    await provider.writeFile("c", Buffer.from("3")); // should evict "b", not "a"

    expect(await provider.exists("a")).toBe(true);
    expect(await provider.exists("b")).toBe(false);
    expect(await provider.exists("c")).toBe(true);
  });

  it("evicts entries once maxBytes is exceeded", async () => {
    const provider = new MemoryStorageProvider({ maxBytes: 10 });

    await provider.writeFile("a", Buffer.alloc(6, "a"));
    await provider.writeFile("b", Buffer.alloc(6, "b")); // 12 bytes total - over the limit, evicts "a"

    expect(await provider.exists("a")).toBe(false);
    expect(await provider.exists("b")).toBe(true);
  });

  it("overwriting an existing key updates its recency and size accounting", async () => {
    const provider = new MemoryStorageProvider({ maxItems: 2 });

    await provider.writeFile("a", Buffer.from("1"));
    await provider.writeFile("b", Buffer.from("2"));
    await provider.writeFile("a", Buffer.from("11")); // re-write "a" - now most-recently-used
    await provider.writeFile("c", Buffer.from("3")); // should evict "b", not "a"

    expect(await provider.exists("a")).toBe(true);
    expect(await provider.exists("b")).toBe(false);
    expect(await provider.readFile("a")).toEqual(Buffer.from("11"));
  });
});
