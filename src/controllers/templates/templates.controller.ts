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
import { TilesService } from "../tiles/tiles.service.js";
import { assertTileBounds, parseTileCoordinate, writeSvgResponse } from "../tiles/tile-request.util.js";
import { TemplateService } from "../../repositories/template/template.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TemplateSummary {
  id: string;
  name: string;
  isActive: boolean;
}

@ApiTags("Templates")
@Public()
@Controller({
  path: "templates",
  version: "1",
})
export class TemplatesController {
  constructor(
    private readonly tilesService: TilesService,
    private readonly templateService: TemplateService
  ) {}

  @Get()
  @ApiOperation({
    summary: "List available templates",
    description: "Lets clients (e.g. the example viewer's light/dark toggle) look up a template's id by name.",
  })
  @ApiOkResponse({ description: "Available templates" })
  async list(): Promise<TemplateSummary[]> {
    const templates = await this.templateService.list();
    return templates.map(({ id, name, isActive }) => ({ id, name, isActive }));
  }

  @Get(":id/tiles/:z/:x/:y.svg")
  @ApiOperation({ summary: "Render an SVG tile on demand, styled with a specific template" })
  @ApiProduces("image/svg+xml")
  @ApiParam({ name: "id", type: String, description: "A Template's id (uuid)" })
  @ApiParam({ name: "z", type: Number, example: 0 })
  @ApiParam({ name: "x", type: Number, example: 0 })
  @ApiParam({ name: "y", type: Number, example: 0 })
  @ApiOkResponse({ description: "SVG tile response" })
  @ApiBadRequestResponse({ description: "Tile coordinates or template id are invalid" })
  @ApiNotFoundResponse({ description: "Tile is empty/missing/outside the dataset, or no template has that id" })
  @ApiInternalServerErrorResponse({ description: "Tile rendering failed unexpectedly" })
  async getTile(
    @Param("id") idParam: string,
    @Param("z") zParam: string,
    @Param("x") xParam: string,
    @Param("y") yParam: string,
    @Res() response: ServerResponse
  ): Promise<void> {
    if (!UUID_PATTERN.test(idParam)) {
      throw new BadRequestException('Path parameter "id" must be a valid template id (uuid)');
    }
    const z = parseTileCoordinate("z", zParam, 30);
    const x = parseTileCoordinate("x", xParam);
    const y = parseTileCoordinate("y", yParam);
    assertTileBounds(z, x, y);

    const svg = await this.tilesService.renderTileSvg(z, x, y, idParam);
    writeSvgResponse(response, svg, this.tilesService.getCacheControl());
  }
}
