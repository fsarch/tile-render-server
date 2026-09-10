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
  | { type: "result"; jobId: number; svg: string | null }
  | { type: "error"; jobId: number; message: string }
  | { type: "closed" };
