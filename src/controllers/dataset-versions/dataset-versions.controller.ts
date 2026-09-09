import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { parseUuidParam } from "../common/parse-uuid-param.util.js";
import { DatasetVersionService } from "../../repositories/dataset-version/dataset-version.service.js";

export interface DatasetVersionSummary {
  id: string;
  path: string;
  isActive: boolean;
}

function toSummary({ id, path, isActive }: { id: string; path: string; isActive: boolean }): DatasetVersionSummary {
  return { id, path, isActive };
}

function parseCreateDatasetVersionBody(body: unknown): { path: string } {
  if (typeof body !== "object" || body === null) {
    throw new BadRequestException("Request body must be a JSON object");
  }
  const { path } = body as Record<string, unknown>;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new BadRequestException('"path" must be a non-empty string');
  }
  return { path: path.trim() };
}

// None of these routes are @Public() - dataset_versions.path controls which file
// TilesService opens as the pmtiles archive (resolved through storage.data, so it
// could point anywhere that storage backend can reach - a local path or an S3 key),
// and listing rows exposes those paths too. Unlike tile rendering and template
// listing/reading, there's no reason for any of this to be reachable anonymously - see
// main.ts's .enableAuth().
@ApiTags("Dataset Versions")
@Controller({
  path: "dataset-versions",
  version: "1",
})
export class DatasetVersionsController {
  constructor(private readonly datasetVersionService: DatasetVersionService) {}

  @Get()
  @ApiOperation({ summary: "List registered dataset versions" })
  @ApiOkResponse({ description: "Registered dataset versions" })
  async list(): Promise<DatasetVersionSummary[]> {
    const versions = await this.datasetVersionService.list();
    return versions.map(toSummary);
  }

  @Post()
  @ApiOperation({
    summary: "Register a new dataset version (inactive by default - see POST /:id/activate)",
    description:
      "`path` is resolved through storage.data at archive-open time (see config.yaml), not necessarily a " +
      "literal filesystem path - a key relative to a local base directory or an S3 bucket/prefix.",
  })
  @ApiBody({ schema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } })
  @ApiCreatedResponse({ description: "The created dataset version" })
  @ApiBadRequestResponse({ description: "The request body is missing/malformed" })
  async create(@Body() body: unknown): Promise<DatasetVersionSummary> {
    const { path } = parseCreateDatasetVersionBody(body);
    const version = await this.datasetVersionService.create(path);
    return toSummary(version);
  }

  @Post(":id/activate")
  @ApiOperation({
    summary: "Activate a dataset version by id, deactivating whichever was active before",
    description:
      "Takes effect on the API's next restart only - the already-opened PMTiles archive isn't hot-swapped " +
      "mid-process (see TilesService.getInputPath).",
  })
  @ApiParam({ name: "id", type: String, description: "A DatasetVersion's id (uuid)" })
  @ApiOkResponse({ description: "The now-active dataset version" })
  @ApiBadRequestResponse({ description: "The id is not a valid uuid" })
  @ApiNotFoundResponse({ description: "No dataset version has that id" })
  async activate(@Param("id") idParam: string): Promise<DatasetVersionSummary> {
    const id = parseUuidParam("id", idParam);
    const version = await this.datasetVersionService.activate(id);
    return toSummary(version);
  }
}
