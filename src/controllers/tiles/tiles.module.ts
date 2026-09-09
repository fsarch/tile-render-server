import { Module } from "@nestjs/common";
import { DatasetVersionModule } from "../../repositories/dataset-version/dataset-version.module.js";
import { LabelAnchorModule } from "../../repositories/label-anchor/label-anchor.module.js";
import { TemplateModule } from "../../repositories/template/template.module.js";
import { StorageModule } from "../../storage/storage.module.js";
import { TilesController } from "./tiles.controller.js";
import { TilesService } from "./tiles.service.js";

@Module({
  imports: [LabelAnchorModule, DatasetVersionModule, TemplateModule, StorageModule],
  controllers: [TilesController],
  providers: [TilesService],
  exports: [TilesService],
})
export class TilesModule {}
