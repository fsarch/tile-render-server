import { Module } from "@nestjs/common";
import { DatasetVersionModule } from "./dataset-version/dataset-version.module.js";
import { LabelAnchorModule } from "./label-anchor/label-anchor.module.js";
import { TemplateModule } from "./template/template.module.js";

@Module({
  imports: [LabelAnchorModule, DatasetVersionModule, TemplateModule],
  exports: [LabelAnchorModule, DatasetVersionModule, TemplateModule],
})
export class RepositoriesModule {}
