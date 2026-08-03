import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { openPMTilesArchive } from "./pmtiles.js";
import { renderTileToSvg } from "./renderer.js";

interface WorkerConfig {
  inputPath: string;
  labels: boolean;
  roadLabels: boolean;
  natureLabels: boolean;
}

interface CloseMessage {
  type: "close";
}

interface TileJobMessage {
  type: "render";
  z: number;
  x: number;
  y: number;
  outputPath: string;
  overwrite: boolean;
}

type JobMessage = CloseMessage | TileJobMessage;

if (!parentPort) {
  throw new Error("Worker requires a parentPort");
}
const port = parentPort;

const config = workerData as WorkerConfig;
const archive = await openPMTilesArchive(config.inputPath);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

port.on("message", async (job: JobMessage) => {
  if ("type" in job && job.type === "close") {
    await archive.close();
    port.postMessage({ type: "closed" });
    return;
  }

  const { z, x, y, outputPath, overwrite } = job;
  try {
    if (!overwrite && (await exists(outputPath))) {
      port.postMessage({ type: "result", status: "skipped", z, x, y, reason: "exists" });
      return;
    }

    const tileData = await archive.getTile(z, x, y);
    if (!tileData || tileData.byteLength === 0) {
      port.postMessage({ type: "result", status: "skipped", z, x, y, reason: "empty" });
      return;
    }

    const svg = renderTileToSvg(tileData, {
      labels: config.labels,
      roadLabels: config.roadLabels,
      natureLabels: config.natureLabels,
      zoom: z,
      tileX: x,
      tileY: y,
    });
    if (!svg) {
      port.postMessage({ type: "result", status: "skipped", z, x, y, reason: "invalid" });
      return;
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, svg, "utf8");
    port.postMessage({ type: "result", status: "rendered", z, x, y });
  } catch (error) {
    port.postMessage({
      type: "result",
      status: "error",
      z,
      x,
      y,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
