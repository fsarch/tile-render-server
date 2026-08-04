import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "@fsarch/server/auth";

@ApiTags("Health")
@Public()
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Report service health" })
  @ApiOkResponse({ description: "Service is healthy" })
  healthCheck(): { status: "healthy" } {
    return { status: "healthy" };
  }
}
