import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { FsArchAppBuilder } from "@fsarch/server";
import { AppModule } from "./app.module.js";

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

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
    .build();

  const configService = app.get(ConfigService);
  const port = parsePort(process.env.PORT ?? configService.get("app.port"), 3000);
  const host = String(process.env.HOST ?? configService.get("app.host") ?? "0.0.0.0");

  await app.listen(port, host);

  console.log(`maps-converter listening on http://${host}:${port}`);
  console.log(`swagger available at http://${host}:${port}/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
