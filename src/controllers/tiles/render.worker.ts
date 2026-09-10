import { parentPort, workerData } from "node:worker_threads";
import type { GlobalAreaAnchor, LabelAnchorCache, LabelAnchorKey } from "../../core/label-anchor-cache.js";
import { openPMTilesArchiveFromStorage } from "../../core/pmtiles.js";
import { renderTileToSvg } from "../../core/renderer.js";
import { StorageProviderFactory } from "../../storage/storage-provider.factory.js";
import type { FromWorkerMessage, RenderWorkerConfig, ToWorkerMessage } from "./render-worker-protocol.js";

// worker_threads entrypoint for RenderWorkerPool (src/controllers/tiles/
// render-worker-pool.ts) - see there for the overall design. Unlike src/cli/worker.ts
// (which is handed a whole archive to walk), this worker is long-lived and renders
// whatever single tile job the pool sends it next.

if (!parentPort) {
  throw new Error("render.worker requires a parentPort");
}
const port = parentPort;

const config = workerData as RenderWorkerConfig;

// Its own storage provider/archive, independent of the main thread's - built from the
// same storageConfig/inputPath the pool was constructed with. Opened once at startup,
// matching TilesService's own archive lifecycle (a dataset_versions swap only takes
// effect on the API's next restart - see CLAUDE.md). Used exclusively for the
// cross-tile neighbor/ancestor lookups renderTileToSvg makes internally (label joins/
// anchors); the tile actually being rendered arrives with the job itself.
const storage = StorageProviderFactory.create(config.storageConfig);
const archive = await openPMTilesArchiveFromStorage(storage, config.inputPath);

let nextRequestId = 1;
const pendingAnchorRequests = new Map<number, (value: GlobalAreaAnchor | null | undefined) => void>();

// Proxies the Postgres-backed label-anchor cache back to the main thread, which owns
// the real DB connection (a worker thread has no NestJS DI container to inject
// PostgresLabelAnchorCache into). Safe to have only one outstanding request at a time -
// renderTileToSvg never overlaps its own labelAnchorCache calls.
const remoteLabelAnchorCache: LabelAnchorCache = {
  get(key: LabelAnchorKey) {
    return new Promise((resolve) => {
      const requestId = nextRequestId++;
      pendingAnchorRequests.set(requestId, resolve);
      port.postMessage({ type: "anchor-get", requestId, key } satisfies FromWorkerMessage);
    });
  },
  async set(key: LabelAnchorKey, value: GlobalAreaAnchor | null) {
    await new Promise<void>((resolve) => {
      const requestId = nextRequestId++;
      pendingAnchorRequests.set(requestId, () => resolve());
      port.postMessage({ type: "anchor-set", requestId, key, value } satisfies FromWorkerMessage);
    });
  },
};

port.on("message", async (message: ToWorkerMessage) => {
  if (message.type === "close") {
    await archive.close();
    port.postMessage({ type: "closed" } satisfies FromWorkerMessage);
    return;
  }

  if (message.type === "anchor-result") {
    const resolve = pendingAnchorRequests.get(message.requestId);
    if (resolve) {
      pendingAnchorRequests.delete(message.requestId);
      resolve(message.value);
    }
    return;
  }

  const { jobId, tileBuffer, options } = message;
  try {
    const svg = await renderTileToSvg(tileBuffer, options, archive, remoteLabelAnchorCache);
    port.postMessage({ type: "result", jobId, svg } satisfies FromWorkerMessage);
  } catch (error) {
    port.postMessage({
      type: "error",
      jobId,
      message: error instanceof Error ? error.message : String(error),
    } satisfies FromWorkerMessage);
  }
});
