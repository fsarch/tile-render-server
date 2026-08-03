import { cpus } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import minimist from "minimist";
import { openPMTilesArchive } from "./pmtiles.js";

function parseCli() {
  const args = minimist(process.argv.slice(2), {
    boolean: ["overwrite", "labels", "road-labels", "nature-labels", "help"],
    default: {
      input: "planet.pmtiles",
      output: "output",
      "max-zoom": 19,
      concurrency: Math.max(1, Math.min(8, cpus().length)),
      overwrite: false,
      labels: false,
      "road-labels": false,
      "nature-labels": false,
    },
  });

  if (args.help) {
    console.log(`Usage: node src/index.js [options]

--input <path>        PMTiles input file (default: planet.pmtiles)
--output <dir>        Output directory root (default: output)
--max-zoom <number>   Maximum zoom to render (default: 14)
--concurrency <n>     Number of workers (default: CPU/8 bounded)
--overwrite           Overwrite existing SVG files
--labels              Render labels for point features with "name"
--road-labels         Render street names for road features with "name"
--nature-labels       Render nature/water labels with zoom-based rules
--help                Show this help
`);
    process.exit(0);
  }

  const maxZoom = Number(args["max-zoom"]);
  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(maxZoom) || maxZoom < 0) {
    throw new Error(`Invalid --max-zoom value: ${args["max-zoom"]}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid --concurrency value: ${args.concurrency}`);
  }

  return {
    input: resolve(String(args.input)),
    output: resolve(String(args.output)),
    maxZoom,
    concurrency,
    overwrite: Boolean(args.overwrite),
    labels: Boolean(args.labels),
    roadLabels: Boolean(args["road-labels"]),
    natureLabels: Boolean(args["nature-labels"]),
  };
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--:--";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function createWorker(inputPath, labels, roadLabels, natureLabels) {
  return new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
    workerData: { inputPath, labels, roadLabels, natureLabels },
  });
}

async function main() {
  const cli = parseCli();
  const archive = await openPMTilesArchive(cli.input);
  const header = archive.getHeader();
  const effectiveMaxZoom = Math.min(cli.maxZoom, header.maxZoom);
  const totalTiles = await archive.countTiles(effectiveMaxZoom);

  console.log(
    [
      `input=${cli.input}`,
      `output=${cli.output}`,
      `maxZoom=${effectiveMaxZoom}`,
      `concurrency=${cli.concurrency}`,
      `overwrite=${cli.overwrite}`,
      `labels=${cli.labels}`,
      `roadLabels=${cli.roadLabels}`,
      `natureLabels=${cli.natureLabels}`,
      `totalTiles=${totalTiles}`,
    ].join(" | ")
  );

  if (totalTiles === 0) {
    await archive.close();
    console.log("Keine Tiles im angegebenen Zoom-Bereich gefunden.");
    return;
  }

  const workerCount = Math.min(cli.concurrency, totalTiles);
  const workers = [];
  const freeWorkers = [];
  const stats = {
    rendered: 0,
    skipped: 0,
    errors: 0,
    done: 0,
    currentZoom: 0,
  };
  const start = Date.now();

  let inflight = 0;
  let resolveFreeWaiter = null;
  let resolveDrained = null;
  let fatalError = null;
  const activeJobs = new Map();

  const wakeFree = () => {
    if (resolveFreeWaiter) {
      const done = resolveFreeWaiter;
      resolveFreeWaiter = null;
      done();
    }
  };

  const markDone = (z) => {
    stats.done += 1;
    stats.currentZoom = z;
    if (inflight > 0) inflight -= 1;
    if (stats.done >= totalTiles && resolveDrained) {
      const done = resolveDrained;
      resolveDrained = null;
      done();
    }
  };

  for (let i = 0; i < workerCount; i += 1) {
    const worker = createWorker(
      cli.input,
      cli.labels,
      cli.roadLabels,
      cli.natureLabels
    );
    worker.on("message", (message) => {
      if (message?.type === "closed") {
        return;
      }
      if (message?.type === "result") {
        if (message.status === "rendered") stats.rendered += 1;
        else if (message.status === "error") {
          stats.errors += 1;
          console.error(
            `Fehler z${message.z}/${message.x}/${message.y}: ${message.error ?? "unbekannt"}`
          );
        } else {
          stats.skipped += 1;
        }
        activeJobs.delete(worker);
        markDone(message.z ?? stats.currentZoom);
      }
      freeWorkers.push(worker);
      wakeFree();
    });

    worker.on("error", (error) => {
      stats.errors += 1;
      console.error(`Worker-Fehler: ${error.message}`);
      const active = activeJobs.get(worker);
      activeJobs.delete(worker);
      if (active) {
        markDone(active.z);
      }
      fatalError = error;
      wakeFree();
    });

    workers.push(worker);
    freeWorkers.push(worker);
  }

  const progressTimer = setInterval(() => {
    const elapsedSeconds = (Date.now() - start) / 1000;
    const tps = elapsedSeconds > 0 ? stats.done / elapsedSeconds : 0;
    const remaining = totalTiles - stats.done;
    const etaSeconds = tps > 0 ? remaining / tps : Number.POSITIVE_INFINITY;
    console.log(
      `zoom=${stats.currentZoom} done=${stats.done}/${totalTiles} rendered=${stats.rendered} skipped=${stats.skipped} errors=${stats.errors} tps=${tps.toFixed(2)} eta=${formatEta(etaSeconds)}`
    );
  }, 1000);

  const waitForFreeWorker = async () => {
    if (freeWorkers.length > 0) return;
    await new Promise((resolvePromise) => {
      resolveFreeWaiter = resolvePromise;
    });
  };

  for await (const coord of archive.iterateTileCoords(effectiveMaxZoom)) {
    if (fatalError) {
      throw fatalError;
    }
    await waitForFreeWorker();
    if (fatalError) {
      throw fatalError;
    }
    const worker = freeWorkers.pop();
    activeJobs.set(worker, coord);
    inflight += 1;
    worker.postMessage({
      ...coord,
      outputPath: resolve(cli.output, String(coord.z), String(coord.x), `${coord.y}.svg`),
      overwrite: cli.overwrite,
    });
  }

  if (stats.done < totalTiles) {
    await new Promise((resolvePromise) => {
      resolveDrained = resolvePromise;
    });
  }

  clearInterval(progressTimer);
  await archive.close();

  await Promise.all(
    workers.map(
      (worker) =>
        new Promise((resolvePromise) => {
          worker.once("exit", () => resolvePromise());
          worker.postMessage({ type: "close" });
          setTimeout(() => {
            void worker.terminate();
          }, 200);
        })
    )
  );

  const elapsedSeconds = Math.max(1, (Date.now() - start) / 1000);
  const tps = stats.done / elapsedSeconds;
  console.log(
    `fertig: rendered=${stats.rendered} skipped=${stats.skipped} errors=${stats.errors} total=${stats.done} tps=${tps.toFixed(2)}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
