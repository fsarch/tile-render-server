import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DatasetVersion } from "../../database/entities/dataset-version.entity.js";
import { DatasetVersionService } from "./dataset-version.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([DatasetVersion])],
  providers: [DatasetVersionService],
  exports: [DatasetVersionService],
})
export class DatasetVersionModule {}
