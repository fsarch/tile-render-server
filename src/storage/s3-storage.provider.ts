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

  // AWS SDK v3 errors are frequently unhelpful on their own - e.g. this project's
  // Ceph-backed S3 endpoint returns an empty <Message> on several error types, which
  // the SDK then reports as the generic name "UnknownError" (see
  // @smithy/core's decorateServiceException: `message = message || Message ||
  // "UnknownError"`). That string alone gives no hint which bucket/key/operation
  // failed or why (bad credentials, missing object, wrong prefix, ...), which is
  // exactly what you need to diagnose e.g. a misconfigured dataset_versions.path at
  // boot. Every outward-facing call below is wrapped so the thrown error always names
  // the bucket, key and operation, and carries the AWS error's name/HTTP status
  // (usually more informative than its message) - the original error is preserved via
  // `cause` for anyone who wants the raw SDK error too.
  private describeError(error: unknown): string {
    const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = err.$metadata?.httpStatusCode;
    const detail = [err.name, status ? `HTTP ${status}` : undefined, err.message]
      .filter((part) => part && part.length > 0)
      .join(", ");
    return detail;
  }

  private async send<T>(op: string, key: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const detail = this.describeError(error);
      throw new Error(`S3 ${op} failed for s3://${this.bucket}/${key}${detail ? ` (${detail})` : ""}`, {
        cause: error,
      });
    }
  }

  async readFile(path: string): Promise<Buffer> {
    const key = this.getKey(path);
    const response = await this.send("GetObject", key, () =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    );
    return this.bodyToBuffer(response.Body);
  }

  async writeFile(path: string, data: Buffer): Promise<void> {
    const key = this.getKey(path);
    await this.send("PutObject", key, () =>
      this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }))
    );
  }

  // A byte-range GetObject - see IStorageProvider.readRange for why this matters
  // for storage.data (large pmtiles archives are never read in full).
  async readRange(path: string, offset: number, length: number): Promise<Buffer> {
    const key = this.getKey(path);
    const response = await this.send("GetObject", key, () =>
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=${offset}-${offset + length - 1}`,
        })
      )
    );
    return this.bodyToBuffer(response.Body);
  }

  async exists(path: string): Promise<boolean> {
    const key = this.getKey(path);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      const detail = this.describeError(error);
      throw new Error(`S3 HeadObject failed for s3://${this.bucket}/${key}${detail ? ` (${detail})` : ""}`, {
        cause: error,
      });
    }
  }

  // S3 has no real directories - keys just happen to contain "/".
  async mkdir(): Promise<void> {
    return Promise.resolve();
  }

  async deleteFile(path: string): Promise<void> {
    const key = this.getKey(path);
    await this.send("DeleteObject", key, () =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    );
  }

  private async bodyToBuffer(body: GetObjectCommandOutput["Body"]): Promise<Buffer> {
    if (!body) {
      throw new Error("No body in S3 response");
    }
    const byteArray = await body.transformToByteArray();
    return Buffer.from(byteArray);
  }
}
