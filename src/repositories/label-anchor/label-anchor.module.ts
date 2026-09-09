import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LabelAnchor } from "../../database/entities/label-anchor.entity.js";
import { PostgresLabelAnchorCache } from "./label-anchor-cache.postgres.js";

@Module({
  imports: [TypeOrmModule.forFeature([LabelAnchor])],
  providers: [PostgresLabelAnchorCache],
  exports: [PostgresLabelAnchorCache],
})
export class LabelAnchorModule {}
