import { Worker } from "node:worker_threads";
import type { LabelAnchorCache } from "../../core/label-anchor-cache.js";
import type { RenderOptions } from "../../core/renderer.js";
import type { FromWorkerMessage, RenderWorkerConfig, ToWorkerMessage } from "./render-worker-protocol.js";

export interface RenderWorkerPoolConfig extends RenderWorkerConfig {
  // Number of worker threads to keep alive. TilesService picks this from
  // tiles.renderConcurrency (config.yaml), defaulting to the CPU count (capped).
  concurrency: number;
  // Caps how many render() calls may be queued once every worker is busy - guards
  // against unbounded memory growth under a sustained burst. render() rejects with
  // RenderQueueFullError once this is exceeded rather than queueing forever.
  // Default: concurrency * 20.
  maxQueueLength?: number;
}

// Thrown by render() when the queue is already at maxQueueLength - callers (see
// TilesService) should treat this as "temporarily overloaded", e.g. a 503.
export class RenderQueueFullError extends Error {
  constructor() {
    super("RenderWorkerPool queue is full - the server is temporarily overloaded");
    this.name = "RenderQueueFullError";
  }
}

interface PendingJob {
  resolve: (svg: string | null) => void;
  reject: (error: Error) => void;
}

interface QueuedJob {
  tileBuffer: ArrayBuffer;
  options: RenderOptions;
  labelAnchorCache: LabelAnchorCache;
  job: PendingJob;
}

interface WorkerState {
  worker: Worker;
  // Set only while a job is in flight on this worker - also what a stray anchor-get/
  // anchor-set from that worker gets routed against (see handleAnchorRequest). A
  // worker only ever has one job in flight at a time (renderer.ts never overlaps its
  // own labelAnchorCache calls), so there's no ambiguity in looking this up by worker
  // identity alone.
  current?: { jobId: number; job: PendingJob; labelAnchorCache: LabelAnchorCache };
}

export type WorkerFactory = (config: RenderWorkerConfig) => Worker;

function defaultWorkerFactory(config: RenderWorkerConfig): Worker {
  return new Worker(new URL("./render.worker.js", import.meta.url), {
    workerData: config,
  });
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// Spreads on-demand tile rendering (MVT decode + geometry + SVG string building - all
// synchronous CPU work, see renderer.ts) across a pool of worker_threads, so a burst of
// concurrent HTTP requests actually uses multiple CPU cores within a single process
// instead of serializing on Node's one JS main thread. Mirrors the batch CLI's
// worker-pool pattern (src/cli/index.ts + worker.ts), but long-lived and dispatched
// per-request (render()) rather than driving one big archive walk itself.
//
// Each worker opens its own PMTiles archive (see render.worker.ts, built from the same
// storageConfig/inputPath) purely to look up neighboring/ancestor tiles for cross-tile
// label joins/anchors (renderer.ts's TileSource) - the requested tile's own bytes are
// always fetched once by the caller (TilesService already needs them for the
// cache-existence check) and handed to the worker directly, never re-fetched.
//
// The one piece of shared, stateful infrastructure a worker can't sensibly own for
// itself is the Postgres-backed label-anchor cache - its connection pool lives in this
// process's Nest DI container, and a worker thread has no DI container of its own. See
// handleAnchorRequest: a worker proxies get/set back to the `LabelAnchorCache` the
// caller passed into render(), rather than each worker opening its own DB connection.
export class RenderWorkerPool {
  private readonly workers = new Map<Worker, WorkerState>();
  private readonly freeWorkers: Worker[] = [];
  private readonly queue: QueuedJob[] = [];
  private readonly maxQueueLength: number;
  private nextJobId = 1;
  private closed = false;

  constructor(
    private readonly config: RenderWorkerPoolConfig,
    private readonly createWorker: WorkerFactory = defaultWorkerFactory
  ) {
    this.maxQueueLength = config.maxQueueLength ?? config.concurrency * 20;
    const count = Math.max(1, config.concurrency);
    for (let i = 0; i < count; i += 1) {
      this.spawnWorker();
    }
  }

  render(
    tileBuffer: ArrayBuffer | Uint8Array,
    options: RenderOptions,
    labelAnchorCache: LabelAnchorCache
  ): Promise<string | null> {
    if (this.closed) {
      return Promise.reject(new Error("RenderWorkerPool is closed"));
    }
    if (this.freeWorkers.length === 0 && this.queue.length >= this.maxQueueLength) {
      return Promise.reject(new RenderQueueFullError());
    }

    const buffer = toArrayBuffer(tileBuffer);
    return new Promise<string | null>((resolve, reject) => {
      const job: PendingJob = { resolve, reject };
      const worker = this.freeWorkers.pop();
      if (worker) {
        this.dispatch(worker, buffer, options, labelAnchorCache, job);
      } else {
        this.queue.push({ tileBuffer: buffer, options, labelAnchorCache, job });
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const queued of this.queue.splice(0)) {
      queued.job.reject(new Error("RenderWorkerPool closed before this job was dispatched"));
    }
    await Promise.all(
      [...this.workers.keys()].map(
        (worker) =>
          new Promise<void>((resolvePromise) => {
            worker.once("exit", () => resolvePromise());
            worker.postMessage({ type: "close" } satisfies ToWorkerMessage);
            setTimeout(() => void worker.terminate(), 200);
          })
      )
    );
  }

  private spawnWorker(): void {
    const worker = this.createWorker(this.config);
    const state: WorkerState = { worker };
    this.workers.set(worker, state);
    worker.on("message", (message: FromWorkerMessage) => this.handleMessage(state, message));
    worker.on("error", (error: Error) => this.handleWorkerError(state, error));
    this.freeWorkers.push(worker);
  }

  private dispatch(
    worker: Worker,
    tileBuffer: ArrayBuffer,
    options: RenderOptions,
    labelAnchorCache: LabelAnchorCache,
    job: PendingJob
  ): void {
    const state = this.workers.get(worker);
    if (!state) return; // worker was removed (crashed) between being freed and dispatch - shouldn't happen
    const jobId = this.nextJobId++;
    state.current = { jobId, job, labelAnchorCache };
    worker.postMessage({ type: "render", jobId, tileBuffer, options } satisfies ToWorkerMessage, [tileBuffer]);
  }

  private handleMessage(state: WorkerState, message: FromWorkerMessage): void {
    if (message.type === "closed") return;

    if (message.type === "anchor-get" || message.type === "anchor-set") {
      void this.handleAnchorRequest(state, message);
      return;
    }

    const current = state.current;
    if (!current || current.jobId !== message.jobId) return; // stale message from a superseded job
    state.current = undefined;

    if (message.type === "result") {
      current.job.resolve(message.svg);
    } else {
      current.job.reject(new Error(message.message));
    }

    this.releaseWorker(state.worker);
  }

  private async handleAnchorRequest(
    state: WorkerState,
    message: Extract<FromWorkerMessage, { type: "anchor-get" | "anchor-set" }>
  ): Promise<void> {
    const cache = state.current?.labelAnchorCache;
    if (!cache) return; // worker crashed/was reassigned mid-flight - nothing sane to reply with
    if (message.type === "anchor-get") {
      const value = await cache.get(message.key);
      state.worker.postMessage({ type: "anchor-result", requestId: message.requestId, value } satisfies ToWorkerMessage);
    } else {
      await cache.set(message.key, message.value);
      state.worker.postMessage({
        type: "anchor-result",
        requestId: message.requestId,
        value: undefined,
      } satisfies ToWorkerMessage);
    }
  }

  private handleWorkerError(state: WorkerState, error: Error): void {
    this.workers.delete(state.worker);
    const freeIndex = this.freeWorkers.indexOf(state.worker);
    if (freeIndex !== -1) this.freeWorkers.splice(freeIndex, 1);

    state.current?.job.reject(error);
    state.current = undefined;

    if (!this.closed) {
      this.spawnWorker(); // keep pool capacity stable across a worker crash
    }
  }

  private releaseWorker(worker: Worker): void {
    const next = this.queue.shift();
    if (next) {
      this.dispatch(worker, next.tileBuffer, next.options, next.labelAnchorCache, next.job);
      return;
    }
    this.freeWorkers.push(worker);
  }
}
