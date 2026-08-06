import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LabelAnchor } from "../../database/entities/label-anchor.entity.js";
import { PostgresLabelAnchorCache } from "./label-anchor-cache.postgres.js";
import { TilesController } from "./tiles.controller.js";
import { TilesService } from "./tiles.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([LabelAnchor])],
  controllers: [TilesController],
  providers: [TilesService, PostgresLabelAnchorCache],
  exports: [TilesService],
})
export class TilesModule {}
