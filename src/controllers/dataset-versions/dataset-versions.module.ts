import { Module } from "@nestjs/common";
import { DatasetVersionModule } from "../../repositories/dataset-version/dataset-version.module.js";
import { DatasetVersionsController } from "./dataset-versions.controller.js";

@Module({
  imports: [DatasetVersionModule],
  controllers: [DatasetVersionsController],
})
export class DatasetVersionsModule {}
