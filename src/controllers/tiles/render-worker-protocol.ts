import type { GlobalAreaAnchor, LabelAnchorKey } from "../../core/label-anchor-cache.js";
import type { RenderOptions } from "../../core/renderer.js";
import type { StorageConfig } from "../../storage/storage-config.types.js";

// Message shapes shared between RenderWorkerPool (main thread) and render.worker.ts
// (worker thread) - kept in one place so both sides stay in sync.

// workerData passed once at worker startup. Each worker builds its own storage
// provider/PMTiles archive from this (see render.worker.ts) rather than sharing the
// main thread's - see RenderWorkerPool for why.
export interface RenderWorkerConfig {
  storageConfig: StorageConfig;
  inputPath: string;
  labels: boolean;
  roadLabels: boolean;
  natureLabels: boolean;
}

// Pool -> worker.
export type ToWorkerMessage =
  | { type: "render"; jobId: number; tileBuffer: ArrayBuffer; options: RenderOptions }
  | { type: "anchor-result"; requestId: number; value: GlobalAreaAnchor | null | undefined }
  | { type: "close" };

// Worker -> pool.
export type FromWorkerMessage =
  | { type: "anchor-get"; requestId: number; key: LabelAnchorKey }
  | { type: "anchor-set"; requestId: number; key: LabelAnchorKey; value: GlobalAreaAnchor | null }
  // renderMs is the worker's own measured wall-clock time for the renderTileToSvg call
  // (decode + geometry + SVG string building, including any cross-tile archive/anchor-
  // cache round-trips) - reported back so the pool can attach it to its "render_worker_
  // pool.render" span as an attribute, without needing a full tracing SDK inside every
  // worker thread (see render-worker-pool.ts).
  | { type: "result"; jobId: number; svg: string | null; renderMs: number }
  | { type: "error"; jobId: number; message: string; renderMs: number }
  | { type: "closed" };
