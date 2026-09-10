import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import type { LabelAnchorCache } from "../../core/label-anchor-cache.js";
import { RenderQueueFullError, RenderWorkerPool } from "./render-worker-pool.js";
import type { FromWorkerMessage, ToWorkerMessage } from "./render-worker-protocol.js";

// A fake worker_threads.Worker: just enough surface (on/once/postMessage/terminate)
// for RenderWorkerPool to drive, with postMessage recorded and emit() used to simulate
// messages coming back from the "worker thread".
class FakeWorker extends EventEmitter {
  readonly sent: ToWorkerMessage[] = [];
  postMessage = vi.fn((message: ToWorkerMessage) => {
    this.sent.push(message);
  });
  terminate = vi.fn().mockResolvedValue(undefined);

  send(message: FromWorkerMessage): void {
    this.emit("message", message);
  }
}

function createPool(
  overrides: Partial<{ concurrency: number; maxQueueLength: number }> = {}
): { pool: RenderWorkerPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const pool = new RenderWorkerPool(
    {
      storageConfig: ".",
      inputPath: "planet.pmtiles",
      labels: false,
      roadLabels: false,
      natureLabels: false,
      concurrency: overrides.concurrency ?? 2,
      maxQueueLength: overrides.maxQueueLength,
    },
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }
  );
  return { pool, workers };
}

function fakeLabelAnchorCache(): LabelAnchorCache {
  return { get: vi.fn(), set: vi.fn() };
}

describe("RenderWorkerPool", () => {
  it("spawns `concurrency` workers up front", () => {
    const { workers } = createPool({ concurrency: 3 });
    expect(workers).toHaveLength(3);
  });

  it("dispatches a render() call to a free worker and resolves once it replies", async () => {
    const { pool, workers } = createPool({ concurrency: 1 });
    const tileBuffer = new Uint8Array([1, 2, 3]).buffer;

    const result = pool.render(tileBuffer, { zoom: 3 }, fakeLabelAnchorCache());

    expect(workers[0].sent).toEqual([{ type: "render", jobId: 1, tileBuffer, options: { zoom: 3 } }]);
    workers[0].send({ type: "result", jobId: 1, svg: "<svg />", renderMs: 5 });

    expect(await result).toBe("<svg />");
  });

  it("rejects when the worker reports an error", async () => {
    const { pool, workers } = createPool({ concurrency: 1 });
    const result = pool.render(new ArrayBuffer(1), {}, fakeLabelAnchorCache());
    workers[0].send({ type: "error", jobId: 1, message: "bad tile", renderMs: 5 });

    await expect(result).rejects.toThrow("bad tile");
  });

  it("proxies anchor-get/anchor-set from a worker to the labelAnchorCache passed into render()", async () => {
    const { pool, workers } = createPool({ concurrency: 1 });
    const cache: LabelAnchorCache = {
      get: vi.fn().mockResolvedValue({ fx: 0.5, fy: 0.5 }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const key = { sourceLayer: "park", featureId: "42" };

    const result = pool.render(new ArrayBuffer(1), {}, cache);
    workers[0].send({ type: "anchor-get", requestId: 1, key });
    await Promise.resolve();
    await Promise.resolve();

    expect(cache.get).toHaveBeenCalledWith(key);
    expect(workers[0].sent).toContainEqual({ type: "anchor-result", requestId: 1, value: { fx: 0.5, fy: 0.5 } });

    workers[0].send({ type: "anchor-set", requestId: 2, key, value: { fx: 0.1, fy: 0.1 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.set).toHaveBeenCalledWith(key, { fx: 0.1, fy: 0.1 });

    workers[0].send({ type: "result", jobId: 1, svg: "<svg />", renderMs: 5 });
    await expect(result).resolves.toBe("<svg />");
  });

  it("queues render() calls once every worker is busy, dispatching the next as one frees up", async () => {
    const { pool, workers } = createPool({ concurrency: 1 });
    const cache = fakeLabelAnchorCache();

    const first = pool.render(new ArrayBuffer(1), { zoom: 1 }, cache);
    const second = pool.render(new ArrayBuffer(1), { zoom: 2 }, cache);

    expect(workers[0].sent).toHaveLength(1); // second job is queued, not yet sent

    workers[0].send({ type: "result", jobId: 1, svg: "<svg>first</svg>", renderMs: 5 });
    expect(await first).toBe("<svg>first</svg>");

    expect(workers[0].sent).toHaveLength(2);
    expect(workers[0].sent[1]).toMatchObject({ jobId: 2, options: { zoom: 2 } });

    workers[0].send({ type: "result", jobId: 2, svg: "<svg>second</svg>", renderMs: 5 });
    expect(await second).toBe("<svg>second</svg>");
  });

  it("rejects new render() calls once the queue is full", async () => {
    const { pool } = createPool({ concurrency: 1, maxQueueLength: 1 });
    const cache = fakeLabelAnchorCache();

    void pool.render(new ArrayBuffer(1), {}, cache).catch(() => {}); // occupies the one worker
    void pool.render(new ArrayBuffer(1), {}, cache).catch(() => {}); // fills the queue (maxQueueLength=1)

    await expect(pool.render(new ArrayBuffer(1), {}, cache)).rejects.toBeInstanceOf(RenderQueueFullError);
  });

  it("replaces a worker that errors out, rejecting its in-flight job but keeping pool capacity", async () => {
    const { pool, workers } = createPool({ concurrency: 1 });
    const cache = fakeLabelAnchorCache();

    const result = pool.render(new ArrayBuffer(1), {}, cache);
    workers[0].emit("error", new Error("worker crashed"));

    await expect(result).rejects.toThrow("worker crashed");
    expect(workers).toHaveLength(2); // the crashed one, plus its replacement

    // The replacement is usable: a subsequent render() dispatches to it.
    const next = pool.render(new ArrayBuffer(1), {}, cache);
    expect(workers[1].sent).toHaveLength(1);
    const dispatched = workers[1].sent[0];
    if (dispatched?.type !== "render") throw new Error("expected a render message");
    workers[1].send({ type: "result", jobId: dispatched.jobId, svg: "<svg />", renderMs: 5 });
    await expect(next).resolves.toBe("<svg />");
  });

  it("close() tells every worker to close and waits for them to exit", async () => {
    const { pool, workers } = createPool({ concurrency: 2 });

    const closePromise = pool.close();
    for (const worker of workers) {
      expect(worker.sent).toContainEqual({ type: "close" });
      worker.emit("exit");
    }
    await closePromise;
  });

  it("rejects anything still queued when closed", async () => {
    const { pool } = createPool({ concurrency: 1 });
    const cache = fakeLabelAnchorCache();

    void pool.render(new ArrayBuffer(1), {}, cache).catch(() => {}); // occupies the worker
    const queued = pool.render(new ArrayBuffer(1), {}, cache);

    const closePromise = pool.close();
    await expect(queued).rejects.toThrow(/closed/i);

    // Let close() finish without hanging the test - simulate the worker exiting.
    const anyPool = pool as unknown as { workers: Map<Worker, unknown> };
    for (const worker of anyPool.workers.keys()) {
      (worker as unknown as FakeWorker).emit("exit");
    }
    await closePromise;
  });
});
