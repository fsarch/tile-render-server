import { Module } from "@nestjs/common";
import { TilesController } from "./tiles.controller.js";
import { TilesService } from "./tiles.service.js";

@Module({
  controllers: [TilesController],
  providers: [TilesService],
  exports: [TilesService],
})
export class TilesModule {}
