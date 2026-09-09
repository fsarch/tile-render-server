import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { PostgresLabelAnchorCache } from "./label-anchor-cache.postgres.js";

function createConfigService(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe("PostgresLabelAnchorCache", () => {
  it("returns undefined (cache miss) when no row exists", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const repository = { findOneBy, upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(repository as never, createConfigService({}));

    const result = await cache.get({ sourceLayer: "park", featureId: "123" });

    expect(result).toBeUndefined();
    expect(findOneBy).toHaveBeenCalledWith({
      sourceLayer: "park",
      featureId: "123",
      datasetVersion: "",
    });
  });

  it("maps a found row to a GlobalAreaAnchor", async () => {
    const findOneBy = vi.fn().mockResolvedValue({
      sourceLayer: "park",
      featureId: "123",
      datasetVersion: "",
      fx: 0.25,
      fy: 0.75,
    });
    const repository = { findOneBy, upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(repository as never, createConfigService({}));

    const result = await cache.get({ sourceLayer: "park", featureId: "123" });

    expect(result).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it("upserts on set with a non-null value, keyed on the natural composite key", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const repository = { findOneBy: vi.fn(), upsert };
    const cache = new PostgresLabelAnchorCache(repository as never, createConfigService({}));

    await cache.set({ sourceLayer: "park", featureId: "123" }, { fx: 0.1, fy: 0.9 });

    expect(upsert).toHaveBeenCalledWith(
      { sourceLayer: "park", featureId: "123", datasetVersion: "", fx: 0.1, fy: 0.9 },
      ["sourceLayer", "featureId", "datasetVersion"]
    );
  });

  it("does not persist a null (not-found) result", async () => {
    const upsert = vi.fn();
    const repository = { findOneBy: vi.fn(), upsert };
    const cache = new PostgresLabelAnchorCache(repository as never, createConfigService({}));

    await cache.set({ sourceLayer: "park", featureId: "123" }, null);

    expect(upsert).not.toHaveBeenCalled();
  });

  it("uses tiles.datasetVersion from config when set", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const repository = { findOneBy, upsert: vi.fn() };
    const cache = new PostgresLabelAnchorCache(
      repository as never,
      createConfigService({ "tiles.datasetVersion": "2024-01" })
    );

    await cache.get({ sourceLayer: "park", featureId: "123" });

    expect(findOneBy).toHaveBeenCalledWith({
      sourceLayer: "park",
      featureId: "123",
      datasetVersion: "2024-01",
    });
  });
});
