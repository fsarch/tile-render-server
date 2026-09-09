import { BadRequestException } from "@nestjs/common";
import type { ServerResponse } from "node:http";

// Shared between TilesController (GET /v1/tiles/:z/:x/:y.svg, using the active
// template) and TemplatesController (GET /v1/templates/:id/tiles/:z/:x/:y.svg, using
// one named explicitly) - both ultimately render the same tile the same way, just
// sourcing the template differently, so the HTTP-layer bits (parsing/validating the
// z/x/y path params, writing the SVG response) live here once instead of twice.

export function parseTileCoordinate(name: string, rawValue: string, maxValue?: number): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new BadRequestException(`Tile parameter "${name}" must be a non-negative integer`);
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    throw new BadRequestException(`Tile parameter "${name}" is out of range`);
  }
  if (maxValue !== undefined && value > maxValue) {
    throw new BadRequestException(`Tile parameter "${name}" must be <= ${maxValue}`);
  }
  return value;
}

export function assertTileBounds(z: number, x: number, y: number): void {
  const maxIndex = 2 ** z - 1;
  if (x > maxIndex || y > maxIndex) {
    throw new BadRequestException(`Tile coordinates ${z}/${x}/${y} are outside the valid range`);
  }
}

export function writeSvgResponse(response: ServerResponse, svg: string, cacheControl: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  response.setHeader("Cache-Control", cacheControl);
  response.end(svg);
}
