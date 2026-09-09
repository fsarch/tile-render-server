import { Module } from "@nestjs/common";
import { ControllersModule } from "./controllers/controllers.module.js";
import { RepositoriesModule } from "./repositories/repositories.module.js";

@Module({
  imports: [ControllersModule, RepositoriesModule],
})
export class AppModule {}
