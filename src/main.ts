import "reflect-metadata";
import { FsArchAppBuilder } from "@fsarch/server";
import { AppModule } from "./app.module.js";
import { DATABASE_OPTIONS } from "./database/index.js";

async function bootstrap(): Promise<void> {
  const app = await new FsArchAppBuilder(AppModule, {
    name: "maps-converter",
    version: "1.0.0",
  })
    .addSwagger({
      title: "maps-converter API",
      description: "On-demand rendering of PMTiles vector tiles to SVG.",
      version: "1.0.0",
      path: "docs",
    })
    .setDatabase(DATABASE_OPTIONS)
    .build();

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
