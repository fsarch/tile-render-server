import "reflect-metadata";
import { FsArchAppBuilder } from "@fsarch/server";
import { AppModule } from "./app.module.js";
import { DATABASE_OPTIONS } from "./database/index.js";

async function bootstrap(): Promise<void> {
  const app = await new FsArchAppBuilder(AppModule, {
    name: "tile-render-server",
    version: "1.0.0",
  })
    .addSwagger({
      title: "tile-render-server API",
      description: "On-demand rendering of PMTiles vector tiles to SVG.",
      version: "1.0.0",
      path: "docs",
    })
    // Everything is protected by default except routes explicitly marked @Public()
    // (tile rendering, template listing/tile-rendering) - see auth.* in config.yaml.
    // Creating/activating templates and dataset_versions requires a valid token.
    .enableAuth()
    .setDatabase(DATABASE_OPTIONS)
    .build();

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
