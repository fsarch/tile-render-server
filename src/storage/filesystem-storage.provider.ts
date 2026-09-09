import { Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { IStorageProvider } from "./storage-provider.interface.js";

@Injectable()
export class FileSystemStorageProvider implements IStorageProvider {
  constructor(private readonly basePath: string) {}

  private resolve(path: string): string {
    return join(this.basePath, path);
  }

  async readFile(path: string): Promise<Buffer> {
    return fs.readFile(this.resolve(path));
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    await fs.writeFile(this.resolve(path), data);
  }

  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    const handle = await fs.open(this.resolve(path), "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolve(path), options);
  }

  async deleteFile(path: string): Promise<void> {
    await fs.unlink(this.resolve(path));
  }
}
