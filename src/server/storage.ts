import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageEnv } from "./neon-env";

const BUCKET = "assets";

function client(): S3Client {
  const storage = storageEnv();
  return new S3Client({
    region: storage.region,
    endpoint: storage.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
}

export function importObjectKey(userId: string, batchId: string, name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return `imports/${userId}/${batchId}/${safe || "file"}`;
}

export async function putAsset(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getAsset(key: string): Promise<Uint8Array> {
  const result = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!result.Body) throw new Error("Stored object was empty.");
  return result.Body.transformToByteArray();
}

const UPLOAD_URL_SECONDS = 15 * 60;

/** Browser PUT must send this content type and the exact content length. */
export async function presignZipUpload(key: string, byteSize: number): Promise<{ url: string; expiresAt: string }> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: "application/zip",
    ContentLength: byteSize,
  });
  const url = await getSignedUrl(client(), command, {
    expiresIn: UPLOAD_URL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { url, expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString() };
}

export async function headAsset(key: string): Promise<{ byteSize: number }> {
  const result = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  if (result.ContentLength == null) throw new Error("Stored object has no size.");
  return { byteSize: result.ContentLength };
}

export async function readAssetPrefix(key: string, length: number): Promise<Buffer> {
  const result = await client().send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Range: `bytes=0-${Math.max(0, length - 1)}`,
  }));
  if (!result.Body) throw new Error("Stored object was empty.");
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  return bytes.subarray(0, length);
}

export async function downloadAssetToFile(key: string, dest: string, maxBytes: number): Promise<{ byteSize: number; sha256: string }> {
  const result = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!result.Body) throw new Error("Stored object was empty.");
  const hash = createHash("sha256");
  let size = 0;
  const source = Readable.fromWeb(result.Body.transformToWebStream() as import("node:stream/web").ReadableStream);
  await pipeline(
    source,
    async function* (chunks) {
      for await (const chunk of chunks) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.length;
        if (size > maxBytes) throw new Error("Stored object exceeds the declared size.");
        hash.update(buf);
        yield buf;
      }
    },
    createWriteStream(dest),
  );
  return { byteSize: size, sha256: hash.digest("hex") };
}
