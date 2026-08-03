import { open } from "node:fs/promises";
import { PMTiles, tileIdToZxy } from "pmtiles";

class NodeFileSource {
  constructor(filePath, handle) {
    this.filePath = filePath;
    this.handle = handle;
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
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

async function* iterateRunEntries(archive, header, directoryOffset, directoryLength) {
  const stack = [{ offset: directoryOffset, length: directoryLength }];
  while (stack.length > 0) {
    const current = stack.pop();
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
  constructor(filePath, fileHandle, archive, header) {
    this.filePath = filePath;
    this.fileHandle = fileHandle;
    this.archive = archive;
    this.header = header;
  }

  getHeader() {
    return this.header;
  }

  async getTile(z, x, y) {
    const response = await this.archive.getZxy(z, x, y);
    return response?.data;
  }

  async countTiles(maxZoom) {
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

  async *iterateTileCoords(maxZoom) {
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

  async close() {
    await this.fileHandle.close();
  }
}

export async function openPMTilesArchive(filePath) {
  const fileHandle = await open(filePath, "r");
  const source = new NodeFileSource(filePath, fileHandle);
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  return new LocalPMTilesArchive(filePath, fileHandle, archive, header);
}
