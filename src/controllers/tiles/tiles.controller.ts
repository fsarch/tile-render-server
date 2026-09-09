import { Controller, Get, Param, Res } from "@nestjs/common";
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
import { assertTileBounds, parseTileCoordinate, writeSvgResponse } from "./tile-request.util.js";

@ApiTags("Tiles")
@Public()
@Controller({
  path: "tiles",
  version: "1",
})
export class TilesController {
  constructor(private readonly tilesService: TilesService) {}

  @Get(":z/:x/:y.svg")
  @ApiOperation({ summary: "Render an SVG tile on demand, styled with the currently active template" })
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
    const z = parseTileCoordinate("z", zParam, 30);
    const x = parseTileCoordinate("x", xParam);
    const y = parseTileCoordinate("y", yParam);
    assertTileBounds(z, x, y);

    const svg = await this.tilesService.renderTileSvg(z, x, y);
    writeSvgResponse(response, svg, this.tilesService.getCacheControl());
  }
}
