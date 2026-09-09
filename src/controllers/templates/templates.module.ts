import { Module } from "@nestjs/common";
import { TemplateModule } from "../../repositories/template/template.module.js";
import { TilesModule } from "../tiles/tiles.module.js";
import { TemplatesController } from "./templates.controller.js";

@Module({
  imports: [TilesModule, TemplateModule],
  controllers: [TemplatesController],
})
export class TemplatesModule {}
