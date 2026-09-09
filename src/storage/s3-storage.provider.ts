import { Injectable } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageConfigS3 } from "./storage-config.types.js";
import type { IStorageProvider } from "./storage-provider.interface.js";

@Injectable()
export class S3StorageProvider implements IStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: StorageConfigS3["config"]) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "";
    this.client = new S3Client({
      region: config.region,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
      endpoint: config.endpoint,
    });
  }

  private getKey(path: string): string {
    const cleanPath = path.startsWith("/") ? path.slice(1) : path;
    return this.prefix ? `${this.prefix}${this.prefix.endsWith("/") ? "" : "/"}${cleanPath}` : cleanPath;
  }

  async readFile(path: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.getKey(path) })
    );
    return this.bodyToBuffer(response.Body);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.getKey(path), Body: data }));
  }

  // A byte-range GetObject - see IStorageProvider.readRange for why this matters
  // for storage.data (large pmtiles archives are never read in full).
  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.getKey(path),
        Range: `bytes=${offset}-${offset + length - 1}`,
      })
    );
    return this.bodyToBuffer(response.Body);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.getKey(path) }));
      return true;
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  // S3 has no real directories - keys just happen to contain "/".
  async mkdir(): Promise<void> {
    return Promise.resolve();
  }

  async deleteFile(path: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.getKey(path) }));
  }

  private async bodyToBuffer(body: GetObjectCommandOutput["Body"]): Promise<Buffer> {
    if (!body) {
      throw new Error("No body in S3 response");
    }
    const byteArray = await body.transformToByteArray();
    return Buffer.from(byteArray);
  }
}
