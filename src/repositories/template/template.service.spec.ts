import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { TemplateService } from "./template.service.js";

describe("TemplateService", () => {
  it("getActive looks up the single active row", async () => {
    const findOneBy = vi.fn().mockResolvedValue({ id: "abc", name: "dark", colors: {}, isActive: true });
    const service = new TemplateService({ findOneBy } as never);

    const result = await service.getActive();

    expect(findOneBy).toHaveBeenCalledWith({ isActive: true });
    expect(result).toEqual({ id: "abc", name: "dark", colors: {}, isActive: true });
  });

  it("getActive resolves to null when nothing is active", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const service = new TemplateService({ findOneBy } as never);

    expect(await service.getActive()).toBeNull();
  });

  it("getById looks up a row by id, independent of isActive", async () => {
    const findOneBy = vi.fn().mockResolvedValue({ id: "abc", name: "dark", colors: {}, isActive: false });
    const service = new TemplateService({ findOneBy } as never);

    const result = await service.getById("abc");

    expect(findOneBy).toHaveBeenCalledWith({ id: "abc" });
    expect(result).toEqual({ id: "abc", name: "dark", colors: {}, isActive: false });
  });

  it("getById resolves to null when no row has that id", async () => {
    const findOneBy = vi.fn().mockResolvedValue(null);
    const service = new TemplateService({ findOneBy } as never);

    expect(await service.getById("missing")).toBeNull();
  });

  it("create generates an id and persists an inactive row with the given colors", async () => {
    const create = vi.fn((entity) => entity);
    const save = vi.fn(async (entity) => entity);
    const service = new TemplateService({ create, save } as never);

    const colors = { "--map-water": "#123456" };
    const result = await service.create("dark", colors);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "dark", colors, isActive: false })
    );
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("activate deactivates every row, activates the target, and returns it", async () => {
    const update = vi.fn().mockResolvedValue({ affected: 1 });
    const findOneByOrFail = vi.fn().mockResolvedValue({ id: "target", name: "dark", colors: {}, isActive: true });
    const manager = { update, findOneByOrFail };
    const transaction = vi.fn((fn) => fn(manager));
    const service = new TemplateService({ manager: { transaction } } as never);

    const result = await service.activate("target");

    expect(update).toHaveBeenNthCalledWith(1, expect.anything(), { isActive: true }, { isActive: false });
    expect(update).toHaveBeenNthCalledWith(2, expect.anything(), { id: "target" }, { isActive: true });
    expect(result).toEqual({ id: "target", name: "dark", colors: {}, isActive: true });
  });

  it("activate throws NotFoundException when the id doesn't exist", async () => {
    const update = vi.fn().mockResolvedValue({ affected: 0 });
    const manager = { update, findOneByOrFail: vi.fn() };
    const transaction = vi.fn((fn) => fn(manager));
    const service = new TemplateService({ manager: { transaction } } as never);

    await expect(service.activate("missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
