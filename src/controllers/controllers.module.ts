import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { TemplatesModule } from "./templates/templates.module.js";
import { TilesModule } from "./tiles/tiles.module.js";

@Module({
  imports: [HealthModule, TilesModule, TemplatesModule],
})
export class ControllersModule {}
