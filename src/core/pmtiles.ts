import { open, type FileHandle } from "node:fs/promises";
import { PMTiles, tileIdToZxy, type Entry, type Header, type RangeResponse, type Source } from "pmtiles";
import type { IStorageProvider } from "../storage/storage-provider.interface.js";

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

class NodeFileSource implements Source {
  constructor(
    private readonly filePath: string,
    private readonly handle: FileHandle
  ) {}

  getKey(): string {
    return this.filePath;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset);
    if (bytesRead !== length) {
      throw new Error(
        `Short read while reading PMTiles (${bytesRead}/${length} bytes at offset ${offset})`
      );
    }
    const output = new Uint8Array(buffer.subarray(0, bytesRead));
    return {
      data: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
    };
  }
}

// Backs openPMTilesArchiveFromStorage (REST API only - see TilesService) with an
// IStorageProvider (local filesystem or S3, per storage.data in config.yaml) instead of
// a Node file handle. Every PMTiles read is a random-access byte range - its own
// directory/tile lookups are built entirely around that - never a whole-file read,
// which is exactly what IStorageProvider.readRange is for.
export class StorageSource implements Source {
  constructor(
    private readonly storage: IStorageProvider,
    private readonly key: string
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buffer = await this.storage.readRange(this.key, offset, length);
    const data = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(data).set(buffer);
    return { data };
  }
}

async function* iterateRunEntries(
  archive: PMTiles,
  header: Header,
  directoryOffset: number,
  directoryLength: number
): AsyncGenerator<Entry> {
  const stack = [{ offset: directoryOffset, length: directoryLength }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const entries = await archive.cache.getDirectory(
      archive.source,
      current.offset,
      current.length,
      header
    );

    for (const entry of entries) {
      if (entry.runLength > 0) {
        yield entry;
        continue;
      }

      stack.push({
        offset: header.leafDirectoryOffset + entry.offset,
        length: entry.length,
      });
    }
  }
}

export class LocalPMTilesArchive {
  // `close` abstracts over what actually needs releasing: a Node FileHandle for the
  // batch CLI/openPMTilesArchive path, or a no-op for openPMTilesArchiveFromStorage
  // (IStorageProvider reads are stateless per call - there's no persistent handle).
  constructor(
    private readonly close_: () => Promise<void>,
    private readonly archive: PMTiles,
    private readonly header: Header
  ) {}

  getHeader(): Header {
    return this.header;
  }

  async getMetadata(): Promise<unknown> {
    return this.archive.getMetadata();
  }

  async getTile(z: number, x: number, y: number): Promise<ArrayBuffer | undefined> {
    const response = await this.archive.getZxy(z, x, y);
    return response?.data;
  }

  async countTiles(maxZoom: number): Promise<number> {
    const cappedZoom = Math.min(maxZoom, this.header.maxZoom);
    let total = 0;
    for await (const entry of iterateRunEntries(
      this.archive,
      this.header,
      this.header.rootDirectoryOffset,
      this.header.rootDirectoryLength
    )) {
      for (let i = 0; i < entry.runLength; i += 1) {
        const [z] = tileIdToZxy(entry.tileId + i);
        if (z <= cappedZoom) total += 1;
      }
    }
    return total;
  }

  async *iterateTileCoords(maxZoom: number): AsyncGenerator<TileCoord> {
    const cappedZoom = Math.min(maxZoom, this.header.maxZoom);
    for await (const entry of iterateRunEntries(
      this.archive,
      this.header,
      this.header.rootDirectoryOffset,
      this.header.rootDirectoryLength
    )) {
      for (let i = 0; i < entry.runLength; i += 1) {
        const [z, x, y] = tileIdToZxy(entry.tileId + i);
        if (z <= cappedZoom) {
          yield { z, x, y };
        }
      }
    }
  }

  async close(): Promise<void> {
    await this.close_();
  }
}

async function openPMTilesArchiveFromSource(
  source: Source,
  close: () => Promise<void>
): Promise<LocalPMTilesArchive> {
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  return new LocalPMTilesArchive(close, archive, header);
}

// Batch CLI only (src/cli/index.ts, src/cli/worker.ts) - always a local filesystem
// path, independent of storage.data/config.yaml (the CLI never touches Postgres or the
// REST API's config, see CLAUDE.md).
export async function openPMTilesArchive(filePath: string): Promise<LocalPMTilesArchive> {
  const fileHandle = await open(filePath, "r");
  const source = new NodeFileSource(filePath, fileHandle);
  return openPMTilesArchiveFromSource(source, () => fileHandle.close());
}

// REST API only (TilesService) - `key` is resolved by `storage` (see
// src/storage/storage-provider.interface.ts), which may be a local directory or an S3
// bucket/prefix depending on storage.data in config.yaml.
export async function openPMTilesArchiveFromStorage(
  storage: IStorageProvider,
  key: string
): Promise<LocalPMTilesArchive> {
  const source = new StorageSource(storage, key);
  return openPMTilesArchiveFromSource(source, () => Promise.resolve());
}
