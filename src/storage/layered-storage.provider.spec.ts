import { describe, expect, it, vi } from "vitest";
import { LayeredStorageProvider } from "./layered-storage.provider.js";
import { MemoryStorageProvider } from "./memory-storage.provider.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

function createSpyProvider(): IStorageProvider {
  const store = new Map<string, Buffer>();
  return {
    readFile: vi.fn(async (path: string) => {
      const data = store.get(path);
      if (!data) throw new Error(`not found: ${path}`);
      return data;
    }),
    writeFile: vi.fn(async (path: string, data: Buffer) => {
      store.set(path, data);
    }),
    readRange: vi.fn(async (path: string, offset: number, length: number) => {
      const data = store.get(path);
      if (!data) throw new Error(`not found: ${path}`);
      return data.subarray(offset, offset + length);
    }),
    exists: vi.fn(async (path: string) => store.has(path)),
    mkdir: vi.fn(async () => {}),
    deleteFile: vi.fn(async (path: string) => {
      store.delete(path);
    }),
  };
}

describe("LayeredStorageProvider", () => {
  it("throws when constructed with zero layers", () => {
    expect(() => new LayeredStorageProvider([])).toThrow(/at least one layer/i);
  });

  it("checks layers in order and returns the first hit", async () => {
    const fast = createSpyProvider();
    const slow = createSpyProvider();
    await slow.writeFile("foo.svg", Buffer.from("from-slow"));
    const provider = new LayeredStorageProvider([fast, slow]);

    const result = await provider.readFile("foo.svg");

    expect(result).toEqual(Buffer.from("from-slow"));
    expect(fast.exists).toHaveBeenCalledWith("foo.svg");
    expect(slow.readFile).toHaveBeenCalledWith("foo.svg");
  });

  it("promotes a hit found in a slower layer into every faster layer", async () => {
    const fast = createSpyProvider();
    const slow = createSpyProvider();
    await slow.writeFile("foo.svg", Buffer.from("from-slow"));
    const provider = new LayeredStorageProvider([fast, slow]);

    await provider.readFile("foo.svg");

    expect(await fast.exists("foo.svg")).toBe(true);
    expect(await fast.readFile("foo.svg")).toEqual(Buffer.from("from-slow"));
  });

  it("does not promote into layers slower than (or equal to) the one the hit came from", async () => {
    const layer0 = createSpyProvider();
    const layer1 = createSpyProvider();
    const layer2 = createSpyProvider();
    await layer1.writeFile("foo.svg", Buffer.from("from-layer1"));
    const provider = new LayeredStorageProvider([layer0, layer1, layer2]);

    await provider.readFile("foo.svg");

    expect(await layer0.exists("foo.svg")).toBe(true); // faster than the hit - promoted
    expect(await layer2.exists("foo.svg")).toBe(false); // slower than the hit - untouched
  });

  it("readFile throws when no layer has the file", async () => {
    const provider = new LayeredStorageProvider([createSpyProvider(), createSpyProvider()]);
    await expect(provider.readFile("missing.svg")).rejects.toThrow(/not found in any storage layer/i);
  });

  it("writeFile writes to every layer", async () => {
    const a = createSpyProvider();
    const b = createSpyProvider();
    const provider = new LayeredStorageProvider([a, b]);

    await provider.writeFile("foo.svg", Buffer.from("hi"));

    expect(await a.exists("foo.svg")).toBe(true);
    expect(await b.exists("foo.svg")).toBe(true);
  });

  it("exists returns true if any layer has it", async () => {
    const a = createSpyProvider();
    const b = createSpyProvider();
    await b.writeFile("foo.svg", Buffer.from("hi"));
    const provider = new LayeredStorageProvider([a, b]);

    expect(await provider.exists("foo.svg")).toBe(true);
  });

  it("deleteFile removes from every layer", async () => {
    const a = createSpyProvider();
    const b = createSpyProvider();
    await a.writeFile("foo.svg", Buffer.from("hi"));
    await b.writeFile("foo.svg", Buffer.from("hi"));
    const provider = new LayeredStorageProvider([a, b]);

    await provider.deleteFile("foo.svg");

    expect(await a.exists("foo.svg")).toBe(false);
    expect(await b.exists("foo.svg")).toBe(false);
  });

  it("works end-to-end with real memory + memory layers (a realistic memory-first setup)", async () => {
    const memory = new MemoryStorageProvider();
    const persistent = new MemoryStorageProvider();
    const provider = new LayeredStorageProvider([memory, persistent]);

    expect(await provider.exists("foo.svg")).toBe(false);

    await provider.writeFile("foo.svg", Buffer.from("<svg />"));
    expect(await memory.exists("foo.svg")).toBe(true);
    expect(await persistent.exists("foo.svg")).toBe(true);

    // Simulate a restart: the memory layer loses its entry, the persistent one doesn't.
    await memory.deleteFile("foo.svg");
    expect(await provider.readFile("foo.svg")).toEqual(Buffer.from("<svg />"));
    // Reading through the layered provider re-populated the memory layer.
    expect(await memory.exists("foo.svg")).toBe(true);
  });
});
