import { BadRequestException, Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
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
import { parseUuidParam } from "../common/parse-uuid-param.util.js";
import { TemplateService } from "../../repositories/template/template.service.js";

export interface TemplateSummary {
  id: string;
  name: string;
  isActive: boolean;
}

function toSummary({ id, name, isActive }: { id: string; name: string; isActive: boolean }): TemplateSummary {
  return { id, name, isActive };
}

function parseCreateTemplateBody(body: unknown): { name: string; colors: Record<string, string> } {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Request body must be a JSON object");
  }
  const { name, colors } = body as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new BadRequestException('"name" must be a non-empty string');
  }
  if (colors === undefined) {
    return { name: name.trim(), colors: {} };
  }
  if (typeof colors !== "object" || colors === null || Array.isArray(colors)) {
    throw new BadRequestException('"colors" must be an object mapping CSS variable names to color values');
  }
  for (const [key, value] of Object.entries(colors as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new BadRequestException(`"colors.${key}" must be a string`);
    }
  }
  // Unrecognized variable names or implausible-looking color values are not rejected
  // here - injectStyleTemplate (svg.ts) already ignores those individually at
  // injection time (see THEMEABLE_COLOR_VARIABLES in styles.ts), so a template with a
  // typo in one color still saves and works for every other color it defines.
  return { name: name.trim(), colors: colors as Record<string, string> };
}

@ApiTags("Templates")
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
  @Public()
  @ApiOperation({
    summary: "List available templates",
    description: "Lets clients (e.g. the example viewer's light/dark toggle) look up a template's id by name.",
  })
  @ApiOkResponse({ description: "Available templates" })
  async list(): Promise<TemplateSummary[]> {
    const templates = await this.templateService.list();
    return templates.map(toSummary);
  }

  @Get(":id/tiles/:z/:x/:y.svg")
  @Public()
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
    const id = parseUuidParam("id", idParam);
    const z = parseTileCoordinate("z", zParam, 30);
    const x = parseTileCoordinate("x", xParam);
    const y = parseTileCoordinate("y", yParam);
    assertTileBounds(z, x, y);

    const svg = await this.tilesService.renderTileSvg(z, x, y, id);
    writeSvgResponse(response, svg, this.tilesService.getCacheControl());
  }

  // Not @Public() - creating/activating templates requires authentication (see
  // main.ts's .enableAuth()). Unlike the two routes above, there's no existing public
  // consumer that needs this open, and templates.colors ends up injected verbatim
  // (post-filtering) into every tile response, so anonymous write access isn't
  // acceptable the way anonymous reads are.
  @Post()
  @ApiOperation({ summary: "Create a new template (inactive by default - see POST /:id/activate)" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        colors: { type: "object", additionalProperties: { type: "string" } },
      },
    },
  })
  @ApiCreatedResponse({ description: "The created template" })
  @ApiBadRequestResponse({ description: "The request body is missing/malformed" })
  async create(@Body() body: unknown): Promise<TemplateSummary> {
    const { name, colors } = parseCreateTemplateBody(body);
    const template = await this.templateService.create(name, colors);
    return toSummary(template);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activate a template by id, deactivating whichever was active before" })
  @ApiParam({ name: "id", type: String, description: "A Template's id (uuid)" })
  @ApiOkResponse({ description: "The now-active template" })
  @ApiBadRequestResponse({ description: "The id is not a valid uuid" })
  @ApiNotFoundResponse({ description: "No template has that id" })
  async activate(@Param("id") idParam: string): Promise<TemplateSummary> {
    const id = parseUuidParam("id", idParam);
    const template = await this.templateService.activate(id);
    return toSummary(template);
  }
}
