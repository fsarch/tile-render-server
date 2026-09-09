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
});
