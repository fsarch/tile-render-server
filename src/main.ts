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

  await app.listen(process.env.PORT ?? 8080);
}

// A bootstrap failure (bad config, unreachable DB/storage, ...) is the one place
// nothing has been logged yet - the app never reaches its normal logger/tracing
// setup. Print the full chain (name, message, stack, and any `cause`, which is where
// e.g. S3StorageProvider/TilesService attach the original SDK error) rather than just
// `.message` - a bare `.message` is exactly what silently drops useful detail, e.g.
// the AWS SDK's generic "UnknownError" fallback name with no indication which
// operation/bucket/key actually failed or why.
function describeBootstrapError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const lines = [error.stack ?? `${error.name}: ${error.message}`];
  let cause = error.cause;
  while (cause) {
    if (cause instanceof Error) {
      lines.push(`Caused by: ${cause.stack ?? `${cause.name}: ${cause.message}`}`);
      cause = cause.cause;
    } else {
      lines.push(`Caused by: ${String(cause)}`);
      break;
    }
  }
  return lines.join("\n");
}

bootstrap().catch((error: unknown) => {
  console.error(describeBootstrapError(error));
  process.exit(1);
});
