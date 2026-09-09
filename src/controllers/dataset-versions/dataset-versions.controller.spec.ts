import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DatasetVersionsController } from "./dataset-versions.controller.js";
import type { DatasetVersionService } from "../../repositories/dataset-version/dataset-version.service.js";

const VALID_ID = "9e193fb2-45d0-4665-8849-7549bf37785e";

describe("DatasetVersionsController", () => {
  describe("list", () => {
    it("returns id/path/isActive for every dataset version", async () => {
      const datasetVersionService = {
        list: vi.fn().mockResolvedValue([
          { id: "a", path: "./planet.pmtiles", isActive: true, creationTime: new Date(), updateTime: new Date() },
          { id: "b", path: "./other.pmtiles", isActive: false, creationTime: new Date(), updateTime: new Date() },
        ]),
      } as unknown as DatasetVersionService;
      const controller = new DatasetVersionsController(datasetVersionService);

      const result = await controller.list();

      expect(result).toEqual([
        { id: "a", path: "./planet.pmtiles", isActive: true },
        { id: "b", path: "./other.pmtiles", isActive: false },
      ]);
    });
  });

  describe("create", () => {
    it("creates a dataset version from a path and returns its summary", async () => {
      const datasetVersionService = {
        create: vi.fn().mockResolvedValue({ id: "a", path: "./planet.pmtiles", isActive: false }),
      } as unknown as DatasetVersionService;
      const controller = new DatasetVersionsController(datasetVersionService);

      const result = await controller.create({ path: "./planet.pmtiles" });

      expect(datasetVersionService.create).toHaveBeenCalledWith("./planet.pmtiles");
      expect(result).toEqual({ id: "a", path: "./planet.pmtiles", isActive: false });
    });

    it("rejects a body without a path", async () => {
      const controller = new DatasetVersionsController({} as DatasetVersionService);
      await expect(controller.create({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a non-object body", async () => {
      const controller = new DatasetVersionsController({} as DatasetVersionService);
      await expect(controller.create("./planet.pmtiles")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects an empty path", async () => {
      const controller = new DatasetVersionsController({} as DatasetVersionService);
      await expect(controller.create({ path: "   " })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("activate", () => {
    it("activates a dataset version by id and returns its summary", async () => {
      const datasetVersionService = {
        activate: vi.fn().mockResolvedValue({ id: VALID_ID, path: "./planet.pmtiles", isActive: true }),
      } as unknown as DatasetVersionService;
      const controller = new DatasetVersionsController(datasetVersionService);

      const result = await controller.activate(VALID_ID);

      expect(datasetVersionService.activate).toHaveBeenCalledWith(VALID_ID);
      expect(result).toEqual({ id: VALID_ID, path: "./planet.pmtiles", isActive: true });
    });

    it("rejects an id that isn't a valid uuid", async () => {
      const controller = new DatasetVersionsController({} as DatasetVersionService);
      await expect(controller.activate("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
