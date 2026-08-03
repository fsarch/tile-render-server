import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { openPMTilesArchive } from "./pmtiles.js";
import { renderTileToSvg } from "./renderer.js";

if (!parentPort) {
  throw new Error("Worker requires a parentPort");
}

const archive = await openPMTilesArchive(workerData.inputPath);
const renderLabels = Boolean(workerData.labels);
const renderRoadLabels = Boolean(workerData.roadLabels);
const renderNatureLabels = Boolean(workerData.natureLabels);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

parentPort.on("message", async (job) => {
  if (job?.type === "close") {
    await archive.close();
    parentPort.postMessage({ type: "closed" });
    return;
  }

  const { z, x, y, outputPath, overwrite } = job;

  try {
    if (!overwrite && (await exists(outputPath))) {
      parentPort.postMessage({ type: "result", status: "skipped", z, x, y, reason: "exists" });
      return;
    }

    const tileData = await archive.getTile(z, x, y);
    if (!tileData || tileData.byteLength === 0) {
      parentPort.postMessage({ type: "result", status: "skipped", z, x, y, reason: "empty" });
      return;
    }

    const svg = renderTileToSvg(tileData, {
      labels: renderLabels,
      roadLabels: renderRoadLabels,
      natureLabels: renderNatureLabels,
      zoom: z,
      tileX: x,
      tileY: y,
    });
    if (!svg) {
      parentPort.postMessage({ type: "result", status: "skipped", z, x, y, reason: "invalid" });
      return;
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, svg, "utf8");
    parentPort.postMessage({ type: "result", status: "rendered", z, x, y });
  } catch (error) {
    parentPort.postMessage({
      type: "result",
      status: "error",
      z,
      x,
      y,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
