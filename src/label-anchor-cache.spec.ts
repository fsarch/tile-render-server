import { describe, expect, it } from "vitest";
import { InMemoryLabelAnchorCache } from "./label-anchor-cache.js";

describe("InMemoryLabelAnchorCache", () => {
  it("returns undefined for a key that was never set (cache miss)", async () => {
    const cache = new InMemoryLabelAnchorCache();
    expect(await cache.get({ sourceLayer: "park", featureId: "1" })).toBeUndefined();
  });

  it("round-trips a resolved anchor", async () => {
    const cache = new InMemoryLabelAnchorCache();
    const key = { sourceLayer: "park", featureId: "123" };
    await cache.set(key, { fx: 0.25, fy: 0.75 });
    expect(await cache.get(key)).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it("stores and returns an explicit null (resolution attempted, found nothing)", async () => {
    const cache = new InMemoryLabelAnchorCache();
    const key = { sourceLayer: "water_name", featureId: "42" };
    await cache.set(key, null);
    expect(await cache.get(key)).toBeNull();
  });

  it("isolates keys by sourceLayer even when featureId is identical", async () => {
    const cache = new InMemoryLabelAnchorCache();
    await cache.set({ sourceLayer: "park", featureId: "1" }, { fx: 0.1, fy: 0.1 });
    await cache.set({ sourceLayer: "water_name", featureId: "1" }, { fx: 0.9, fy: 0.9 });

    expect(await cache.get({ sourceLayer: "park", featureId: "1" })).toEqual({ fx: 0.1, fy: 0.1 });
    expect(await cache.get({ sourceLayer: "water_name", featureId: "1" })).toEqual({ fx: 0.9, fy: 0.9 });
  });

  it("isolates keys by featureId even when sourceLayer is identical", async () => {
    const cache = new InMemoryLabelAnchorCache();
    await cache.set({ sourceLayer: "park", featureId: "1" }, { fx: 0.1, fy: 0.1 });
    await cache.set({ sourceLayer: "park", featureId: "2" }, { fx: 0.9, fy: 0.9 });

    expect(await cache.get({ sourceLayer: "park", featureId: "1" })).toEqual({ fx: 0.1, fy: 0.1 });
    expect(await cache.get({ sourceLayer: "park", featureId: "2" })).toEqual({ fx: 0.9, fy: 0.9 });
  });

  it("overwrites a previously stored value for the same key", async () => {
    const cache = new InMemoryLabelAnchorCache();
    const key = { sourceLayer: "park", featureId: "1" };
    await cache.set(key, { fx: 0.1, fy: 0.1 });
    await cache.set(key, { fx: 0.2, fy: 0.2 });
    expect(await cache.get(key)).toEqual({ fx: 0.2, fy: 0.2 });
  });
});
