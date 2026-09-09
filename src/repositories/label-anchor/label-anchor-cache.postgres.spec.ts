import { describe, expect, it, vi } from "vitest";
import { PostgresLabelAnchorCache } from "./label-anchor-cache.postgres.js";

const DATASET_VERSION_ID = "9d0f6c1a-1b2b-4a3a-8b8b-1234567890ab";

describe("PostgresLabelAnchorCache", () => {
  it("returns undefined (cache miss) when no row exists", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const repository = { findOneBy, upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(repository as never);
    cache.setDatasetVersionId(DATASET_VERSION_ID);

    const result = await cache.get({ sourceLayer: "park", featureId: "123" });

    expect(result).toBeUndefined();
    expect(findOneBy).toHaveBeenCalledWith({
      sourceLayer: "park",
      featureId: "123",
      datasetVersion: DATASET_VERSION_ID,
    });
  });

  it("maps a found row to a GlobalAreaAnchor", async () => {
    const findOneBy = vi.fn().mockResolvedValue({
      sourceLayer: "park",
      featureId: "123",
      datasetVersion: DATASET_VERSION_ID,
      fx: 0.25,
      fy: 0.75,
    });
    const repository = { findOneBy, upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(repository as never);
    cache.setDatasetVersionId(DATASET_VERSION_ID);

    const result = await cache.get({ sourceLayer: "park", featureId: "123" });

    expect(result).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it("upserts on set with a non-null value, keyed on the natural composite key", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = { findOneBy: vi.fn(), upsert };
    const cache = new PostgresLabelAnchorCache(repository as never);
    cache.setDatasetVersionId(DATASET_VERSION_ID);

    await cache.set({ sourceLayer: "park", featureId: "123" }, { fx: 0.1, fy: 0.9 });

    expect(upsert).toHaveBeenCalledWith(
      { sourceLayer: "park", featureId: "123", datasetVersion: DATASET_VERSION_ID, fx: 0.1, fy: 0.9 },
      ["sourceLayer", "featureId", "datasetVersion"]
    );
  });

  it("does not persist a null (not-found) result", async () => {
    const upsert = vi.fn();
    const repository = { findOneBy: vi.fn(), upsert };
    const cache = new PostgresLabelAnchorCache(repository as never);
    cache.setDatasetVersionId(DATASET_VERSION_ID);

    await cache.set({ sourceLayer: "park", featureId: "123" }, null);

    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws if used before setDatasetVersionId() is called", async () => {
    const repository = { findOneBy: vi.fn(), upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(repository as never);

    await expect(cache.get({ sourceLayer: "park", featureId: "123" })).rejects.toThrow(
      "setDatasetVersionId"
    );
  });
});
