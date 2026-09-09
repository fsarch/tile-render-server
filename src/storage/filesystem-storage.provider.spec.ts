import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemStorageProvider } from "./filesystem-storage.provider.js";

describe("FileSystemStorageProvider", () => {
  let baseDir: string;
  let provider: FileSystemStorageProvider;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "maps-converter-storage-test-"));
    provider = new FileSystemStorageProvider(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("writes and reads back a whole file, relative to the configured base path", async () => {
    await provider.writeFile("foo.txt", Buffer.from("hello"));

    expect(await provider.readFile("foo.txt")).toEqual(Buffer.from("hello"));
    expect(await readFile(join(baseDir, "foo.txt"), "utf8")).toBe("hello");
  });

  it("reads a byte range without loading the whole file", async () => {
    await writeFile(join(baseDir, "data.bin"), Buffer.from("0123456789"));

    expect(await provider.readRange("data.bin", 2, 4)).toEqual(Buffer.from("2345"));
  });

  it("exists reflects whether the path is there", async () => {
    expect(await provider.exists("missing.txt")).toBe(false);
    await provider.writeFile("present.txt", Buffer.from("x"));
    expect(await provider.exists("present.txt")).toBe(true);
  });

  it("mkdir creates nested directories recursively", async () => {
    await provider.mkdir("a/b/c", { recursive: true });
    expect(await provider.exists("a/b/c")).toBe(true);
  });

  it("deleteFile removes the file", async () => {
    await provider.writeFile("gone.txt", Buffer.from("x"));
    await provider.deleteFile("gone.txt");
    expect(await provider.exists("gone.txt")).toBe(false);
  });
});
