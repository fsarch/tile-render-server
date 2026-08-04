import { BadRequestException } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { TilesController } from "./tiles.controller.js";
import type { TilesService } from "./tiles.service.js";

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

describe("TilesController", () => {
  it("writes an SVG tile response with cache headers", async () => {
    const tilesService = {
      getCacheControl: vi.fn().mockReturnValue("public, max-age=60"),
      renderTileSvg: vi.fn().mockResolvedValue("<svg />"),
    } as unknown as TilesService;
    const controller = new TilesController(tilesService);
    const response = createResponse();

    await controller.getTile("2", "1", "3", response);

    expect(tilesService.renderTileSvg).toHaveBeenCalledWith(2, 1, 3);
    expect(response.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/svg+xml; charset=utf-8");
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=60");
    expect(response.end).toHaveBeenCalledWith("<svg />");
  });

  it("rejects invalid numeric input", async () => {
    const controller = new TilesController({} as TilesService);

    await expect(controller.getTile("z", "0", "0", createResponse())).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it("rejects coordinates outside the z/x/y range", async () => {
    const controller = new TilesController({} as TilesService);

    await expect(controller.getTile("2", "4", "0", createResponse())).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
