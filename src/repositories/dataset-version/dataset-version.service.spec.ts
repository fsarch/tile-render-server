import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DatasetVersionService } from "./dataset-version.service.js";

describe("DatasetVersionService", () => {
  it("getActive looks up the single active row", async () => {
    const findOneBy = vi.fn().mockResolvedValue({ id: "abc", path: "./planet.pmtiles", isActive: true });
    const service = new DatasetVersionService({ findOneBy } as never);

    const result = await service.getActive();

    expect(findOneBy).toHaveBeenCalledWith({ isActive: true });
    expect(result).toEqual({ id: "abc", path: "./planet.pmtiles", isActive: true });
  });

  it("getActive resolves to null when nothing is active", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const service = new DatasetVersionService({ findOneBy } as never);

    expect(await service.getActive()).toBeNull();
  });

  it("create generates an id and persists an inactive row", async () => {
    const create = vi.fn((entity) => entity);
    const save = vi.fn(async (entity) => entity);
    const service = new DatasetVersionService({ create, save } as never);

    const result = await service.create("./planet.pmtiles");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ path: "./planet.pmtiles", isActive: false })
    );
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("activate deactivates every row, activates the target, and returns it", async () => {
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const findOneByOrFail = vi.fn().mockResolvedValue({ id: "target", path: "./planet.pmtiles", isActive: true });
    const manager = { update, findOneByOrFail };
    const transaction = vi.fn((fn) => fn(manager));
    const service = new DatasetVersionService({ manager: { transaction } } as never);

    const result = await service.activate("target");

    expect(update).toHaveBeenNthCalledWith(1, expect.anything(), { isActive: true }, { isActive: false });
    expect(update).toHaveBeenNthCalledWith(2, expect.anything(), { id: "target" }, { isActive: true });
    expect(result).toEqual({ id: "target", path: "./planet.pmtiles", isActive: true });
  });

  it("activate throws NotFoundException when the id doesn't exist", async () => {
    const update = vi.fn().mockResolvedValue({ affected: 0 });
    const manager = { update, findOneByOrFail: vi.fn() };
    const transaction = vi.fn((fn) => fn(manager));
    const service = new DatasetVersionService({ manager: { transaction } } as never);

    await expect(service.activate("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
