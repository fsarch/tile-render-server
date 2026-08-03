import { open, type FileHandle } from "node:fs/promises";
import { PMTiles, tileIdToZxy, type Entry, type Header, type RangeResponse, type Source } from "pmtiles";

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
  constructor(
    private readonly fileHandle: FileHandle,
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
    await this.fileHandle.close();
  }
}

export async function openPMTilesArchive(filePath: string): Promise<LocalPMTilesArchive> {
  const fileHandle = await open(filePath, "r");
  const source = new NodeFileSource(filePath, fileHandle);
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  return new LocalPMTilesArchive(fileHandle, archive, header);
}
