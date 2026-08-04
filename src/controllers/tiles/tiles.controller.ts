import { BadRequestException, Controller, Get, Param, Res } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "@fsarch/server/auth";
import type { ServerResponse } from "node:http";
import { TilesService } from "./tiles.service.js";

@ApiTags("Tiles")
@Public()
@Controller({
  path: "tiles",
  version: "1",
})
export class TilesController {
  constructor(private readonly tilesService: TilesService) {}

  @Get(":z/:x/:y.svg")
  @ApiOperation({ summary: "Render an SVG tile on demand" })
  @ApiProduces("image/svg+xml")
  @ApiParam({ name: "z", type: Number, example: 0 })
  @ApiParam({ name: "x", type: Number, example: 0 })
  @ApiParam({ name: "y", type: Number, example: 0 })
  @ApiOkResponse({ description: "SVG tile response" })
  @ApiBadRequestResponse({ description: "Tile coordinates are invalid" })
  @ApiNotFoundResponse({ description: "Tile is empty, missing, or outside the dataset" })
  @ApiInternalServerErrorResponse({ description: "Tile rendering failed unexpectedly" })
  async getTile(
    @Param("z") zParam: string,
    @Param("x") xParam: string,
    @Param("y") yParam: string,
    @Res() response: ServerResponse
  ): Promise<void> {
    const z = this.parseCoordinate("z", zParam, 30);
    const x = this.parseCoordinate("x", xParam);
    const y = this.parseCoordinate("y", yParam);

    this.assertTileBounds(z, x, y);

    const svg = await this.tilesService.renderTileSvg(z, x, y);

    response.statusCode = 200;
    response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    response.setHeader("Cache-Control", this.tilesService.getCacheControl());
    response.end(svg);
  }

  private parseCoordinate(name: string, rawValue: string, maxValue?: number): number {
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

  private assertTileBounds(z: number, x: number, y: number): void {
    const maxIndex = 2 ** z - 1;
    if (x > maxIndex || y > maxIndex) {
      throw new BadRequestException(`Tile coordinates ${z}/${x}/${y} are outside the valid range`);
    }
  }
}
