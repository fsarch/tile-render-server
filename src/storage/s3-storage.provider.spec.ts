import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3StorageProvider } from "./s3-storage.provider.js";

function fakeBody(bytes: number[]): { transformToByteArray: () => Promise<Uint8Array> } {
  return { transformToByteArray: async () => new Uint8Array(bytes) };
}

describe("S3StorageProvider", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendSpy = vi.spyOn(S3Client.prototype, "send");
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  function createProvider(prefix?: string): S3StorageProvider {
    return new S3StorageProvider({ bucket: "test-bucket", region: "eu-central-1", prefix });
  }

  it("reads a whole file via GetObjectCommand", async () => {
    sendSpy.mockResolvedValue({ Body: fakeBody([1, 2, 3]) });
    const provider = createProvider();

    const result = await provider.readFile("foo.txt");

    expect(result).toEqual(Buffer.from([1, 2, 3]));
    expect(sendSpy.mock.calls[0][0].input).toEqual({ Bucket: "test-bucket", Key: "foo.txt" });
  });

  it("prefixes keys when a prefix is configured", async () => {
    sendSpy.mockResolvedValue({ Body: fakeBody([]) });
    const provider = createProvider("pmtiles/");

    await provider.readFile("foo.txt");

    expect(sendSpy.mock.calls[0][0].input.Key).toBe("pmtiles/foo.txt");
  });

  it("reads a byte range with a Range header", async () => {
    sendSpy.mockResolvedValue({ Body: fakeBody([9, 9]) });
    const provider = createProvider();

    await provider.readRange("archive.pmtiles", 100, 50);

    expect(sendSpy.mock.calls[0][0].input.Range).toBe("bytes=100-149");
  });

  it("writes a file via PutObjectCommand", async () => {
    sendSpy.mockResolvedValue({});
    const provider = createProvider();

    await provider.writeFile("foo.txt", Buffer.from("hi"));

    expect(sendSpy.mock.calls[0][0].input).toEqual({
      Bucket: "test-bucket",
      Key: "foo.txt",
      Body: Buffer.from("hi"),
    });
  });

  it("exists returns true when HeadObject succeeds", async () => {
    sendSpy.mockResolvedValue({});
    expect(await createProvider().exists("foo.txt")).toBe(true);
  });

  it("exists returns false on a NotFound/404 error", async () => {
    sendSpy.mockRejectedValue({ name: "NotFound" });
    expect(await createProvider().exists("foo.txt")).toBe(false);
  });

  it("exists rethrows other errors", async () => {
    sendSpy.mockRejectedValue(new Error("boom"));
    await expect(createProvider().exists("foo.txt")).rejects.toThrow("boom");
  });

  it("deleteFile sends a DeleteObjectCommand", async () => {
    sendSpy.mockResolvedValue({});
    const provider = createProvider();

    await provider.deleteFile("foo.txt");

    expect(sendSpy.mock.calls[0][0].input).toEqual({ Bucket: "test-bucket", Key: "foo.txt" });
  });

  it("mkdir is a no-op (S3 has no real directories)", async () => {
    await expect(createProvider().mkdir("some/dir")).resolves.toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
