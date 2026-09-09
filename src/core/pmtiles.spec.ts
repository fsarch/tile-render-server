import { describe, expect, it, vi } from "vitest";
import { StorageSource } from "./pmtiles.js";
import type { IStorageProvider } from "../storage/storage-provider.interface.js";

function fakeStorage(readRange: IStorageProvider["readRange"]): IStorageProvider {
  return {
    readRange,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    deleteFile: vi.fn(),
  };
}

describe("StorageSource", () => {
  it("exposes the storage key it was constructed with", () => {
    const source = new StorageSource(fakeStorage(vi.fn()), "some/key.pmtiles");
    expect(source.getKey()).toBe("some/key.pmtiles");
  });

  it("delegates getBytes to storage.readRange with the requested offset/length", async () => {
    const readRange = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4]));
    const source = new StorageSource(fakeStorage(readRange), "some/key.pmtiles");

    await source.getBytes(100, 4);

    expect(readRange).toHaveBeenCalledWith("some/key.pmtiles", 100, 4);
  });

  it("returns the bytes as a plain ArrayBuffer, not tied to the source Buffer's backing memory", async () => {
    const backing = Buffer.from([1, 2, 3, 4]);
    const source = new StorageSource(fakeStorage(vi.fn().mockResolvedValue(backing)), "k");

    const result = await source.getBytes(0, 4);

    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([1, 2, 3, 4]));
    // Mutating the original buffer afterwards must not affect the already-returned data.
    backing[0] = 99;
    expect(new Uint8Array(result.data)[0]).toBe(1);
  });
});
