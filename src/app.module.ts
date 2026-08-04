import { Module } from "@nestjs/common";
import { ControllersModule } from "./controllers/controllers.module.js";

@Module({
  imports: [ControllersModule],
})
export class AppModule {}
