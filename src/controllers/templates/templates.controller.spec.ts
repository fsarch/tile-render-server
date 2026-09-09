import { BadRequestException } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { TemplatesController } from "./templates.controller.js";
import type { TilesService } from "../tiles/tiles.service.js";
import type { TemplateService } from "../../repositories/template/template.service.js";

const VALID_ID = "9e193fb2-45d0-4665-8849-7549bf37785e";

function createResponse(): ServerResponse & { body?: string } {
  return {
    statusCode: 0,
    setHeader: vi.fn(),
    end: vi.fn(function (this: ServerResponse & { body?: string }, body?: string) {
      this.body = body;
      return this;
    }),
  } as unknown as ServerResponse & { body?: string };
}

describe("TemplatesController", () => {
  it("renders a tile with the given template id and writes an SVG response", async () => {
    const tilesService = {
      getCacheControl: vi.fn().mockReturnValue("public, max-age=60"),
      renderTileSvg: vi.fn().mockResolvedValue("<svg />"),
    } as unknown as TilesService;
    const controller = new TemplatesController(tilesService, {} as TemplateService);
    const response = createResponse();

    await controller.getTile(VALID_ID, "2", "1", "3", response);

    expect(tilesService.renderTileSvg).toHaveBeenCalledWith(2, 1, 3, VALID_ID);
    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/svg+xml; charset=utf-8");
    expect(response.end).toHaveBeenCalledWith("<svg />");
  });

  it("rejects a template id that isn't a valid uuid", async () => {
    const controller = new TemplatesController({} as TilesService, {} as TemplateService);

    await expect(
      controller.getTile("not-a-uuid", "2", "1", "3", createResponse())
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects invalid numeric tile coordinates", async () => {
    const controller = new TemplatesController({} as TilesService, {} as TemplateService);

    await expect(
      controller.getTile(VALID_ID, "z", "0", "0", createResponse())
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects coordinates outside the z/x/y range", async () => {
    const controller = new TemplatesController({} as TilesService, {} as TemplateService);

    await expect(
      controller.getTile(VALID_ID, "2", "4", "0", createResponse())
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("list returns id/name/isActive for every template", async () => {
    const templateService = {
      list: vi.fn().mockResolvedValue([
        { id: "a", name: "default", colors: {}, isActive: true, creationTime: new Date(), updateTime: new Date() },
        { id: "b", name: "dark", colors: {}, isActive: false, creationTime: new Date(), updateTime: new Date() },
      ]),
    } as unknown as TemplateService;
    const controller = new TemplatesController({} as TilesService, templateService);

    const result = await controller.list();

    expect(result).toEqual([
      { id: "a", name: "default", isActive: true },
      { id: "b", name: "dark", isActive: false },
    ]);
  });

  describe("create", () => {
    it("creates a template from name + colors and returns its summary", async () => {
      const templateService = {
        create: vi.fn().mockResolvedValue({ id: "a", name: "dark", colors: { "--map-water": "#123456" }, isActive: false }),
      } as unknown as TemplateService;
      const controller = new TemplatesController({} as TilesService, templateService);

      const result = await controller.create({ name: "dark", colors: { "--map-water": "#123456" } });

      expect(templateService.create).toHaveBeenCalledWith("dark", { "--map-water": "#123456" });
      expect(result).toEqual({ id: "a", name: "dark", isActive: false });
    });

    it("defaults colors to an empty object when omitted", async () => {
      const templateService = {
        create: vi.fn().mockResolvedValue({ id: "a", name: "dark", colors: {}, isActive: false }),
      } as unknown as TemplateService;
      const controller = new TemplatesController({} as TilesService, templateService);

      await controller.create({ name: "dark" });

      expect(templateService.create).toHaveBeenCalledWith("dark", {});
    });

    it("rejects a body without a name", async () => {
      const controller = new TemplatesController({} as TilesService, {} as TemplateService);
      await expect(controller.create({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects a non-object body", async () => {
      const controller = new TemplatesController({} as TilesService, {} as TemplateService);
      await expect(controller.create("dark")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects colors that isn't an object", async () => {
      const controller = new TemplatesController({} as TilesService, {} as TemplateService);
      await expect(controller.create({ name: "dark", colors: "not-an-object" })).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it("rejects a color value that isn't a string", async () => {
      const controller = new TemplatesController({} as TilesService, {} as TemplateService);
      await expect(
        controller.create({ name: "dark", colors: { "--map-water": 123 } })
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("activate", () => {
    it("activates a template by id and returns its summary", async () => {
      const templateService = {
        activate: vi.fn().mockResolvedValue({ id: VALID_ID, name: "dark", colors: {}, isActive: true }),
      } as unknown as TemplateService;
      const controller = new TemplatesController({} as TilesService, templateService);

      const result = await controller.activate(VALID_ID);

      expect(templateService.activate).toHaveBeenCalledWith(VALID_ID);
      expect(result).toEqual({ id: VALID_ID, name: "dark", isActive: true });
    });

    it("rejects an id that isn't a valid uuid", async () => {
      const controller = new TemplatesController({} as TilesService, {} as TemplateService);
      await expect(controller.activate("not-a-uuid")).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
