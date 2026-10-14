import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZIP_TOO_MANY_ENTRIES, ZIP_UNCOMPRESSED_TOO_LARGE } from "@/domain/import/samsung/parse";
import { hashPassword } from "@/server/auth";
import { postImport } from "@/server/api/v1";
import { prisma } from "@/server/db";
import { getImport, postImportUpload, postImportUploadComplete } from "@/server/imports/uploads";
import { processStoredImport, sweepImports } from "@/server/imports/worker";
import { setRateLimitForTests } from "@/server/rate-limit";

const calls = vi.hoisted(() => ({
  signed: [] as Array<{ key: string; byteSize: number }>,
  heads: [] as string[],
  prefixes: [] as Array<{ key: string; length: number }>,
  downloads: [] as string[],
  files: new Map<string, Buffer>(),
  magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  failDownloads: 0,
}));

vi.mock("@/server/storage", async () => {
  const actual = await vi.importActual<typeof import("@/server/storage")>("@/server/storage");
  return {
    importObjectKey: actual.importObjectKey,
    putAsset: vi.fn(),
    getAsset: vi.fn(),
    presignZipUpload: vi.fn(async (key: string, byteSize: number) => {
      calls.signed.push({ key, byteSize });
      return {
        url: `https://uploads.test/put?key=${encodeURIComponent(key)}&content-length=${byteSize}&content-type=application%2Fzip`,
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      };
    }),
    headAsset: vi.fn(async (key: string) => {
      calls.heads.push(key);
      const signed = [...calls.signed].reverse().find((item) => item.key === key);
      if (signed) return { byteSize: signed.byteSize };
      const file = calls.files.get(key);
      if (!file) throw new Error("missing object");
      return { byteSize: file.byteLength };
    }),
    readAssetPrefix: vi.fn(async (key: string, length: number) => {
      calls.prefixes.push({ key, length });
      return calls.magic.subarray(0, length);
    }),
    downloadAssetToFile: vi.fn(async (key: string, dest: string, maxBytes: number) => {
      calls.downloads.push(key);
      if (calls.failDownloads > 0) {
        calls.failDownloads -= 1;
        throw new Error("storage unavailable");
      }
      const bytes = calls.files.get(key);
      if (!bytes) throw new Error("missing object");
      if (bytes.byteLength > maxBytes) throw new Error("Stored object exceeds the declared size.");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(dest, bytes);
      return { byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
    }),
  };
});

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0);
  return buf;
}

function zipStored(entries: { name: string; data: Buffer; uncompressedSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const uncompressed = entry.uncompressedSize ?? entry.data.length;
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc32(entry.data)),
      u32(entry.data.length), u32(uncompressed), u16(name.length), u16(0), name, entry.data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc32(entry.data)),
      u32(entry.data.length), u32(uncompressed), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

function weightZip(lines: string[]): Buffer {
  const text = ["com.samsung.health.weight", "start_time,weight,datauuid", ...lines].join("\n");
  return zipStored([{ name: "com.samsung.health.weight.csv", data: Buffer.from(text) }]);
}

function request(method: string, path: string, options: { token?: string; body?: unknown; key?: string; zip?: Buffer } = {}) {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.key) headers.set("idempotency-key", options.key);
  if (options.zip) headers.set("content-type", "application/zip");
  else if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.zip ? new Uint8Array(options.zip) : options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function userWithToken(email: string, scopes: string[]) {
  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword("integration-secret") } });
  const raw = `fihub_${createHash("sha256").update(email).digest("hex")}`;
  await prisma.apiToken.create({
    data: { userId: user.id, name: "test", tokenHash: createHash("sha256").update(raw).digest("hex"), scopes },
  });
  return { user, raw };
}

async function stage(batchId: string, bytes: Buffer) {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (!batch.objectKey) throw new Error("missing object key");
  calls.files.set(batch.objectKey, bytes);
  return batch;
}

describe("direct zip uploads", () => {
  let owner: { user: { id: string }; raw: string };
  let other: { user: { id: string }; raw: string };
  const emails = ["upload-owner@test.local", "upload-other@test.local", "upload-read@test.local"];

  beforeAll(async () => {
    setRateLimitForTests(10_000);
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    owner = await userWithToken(emails[0], ["read", "write", "import"]);
    other = await userWithToken(emails[1], ["read", "write", "import"]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.$disconnect();
  });

  it("accepts a 53 MB declaration, signs that size, and reads only the ZIP magic on complete", async () => {
    const byteSize = 53 * 1024 * 1024;
    const downloadsBefore = calls.downloads.length;
    const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-53",
      body: { filename: "samsung.zip", byteSize },
    }));
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(calls.signed.at(-1)).toMatchObject({ byteSize });
    expect(body.data.uploadUrl).toContain(`content-length=${byteSize}`);
    expect(body.data.uploadUrl).toContain("content-type=application%2Fzip");
    const done = await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-53-done",
    }), body.data.batchId);
    expect(done.status).toBe(202);
    expect(calls.heads.at(-1)).toBe(body.data.objectKey);
    expect(calls.prefixes.at(-1)).toEqual({ key: body.data.objectKey, length: 4 });
    expect(calls.downloads.length).toBe(downloadsBefore);
    const stored = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    expect(stored.status).toBe("queued");
    expect(stored.byteSize).toBe(byteSize);
    expect(stored.objectKey).toBe(`imports/${owner.user.id}/${stored.id}/archive.zip`);
    await prisma.importBatch.update({ where: { id: stored.id }, data: { status: "completed", attemptCount: 3 } });
  });

  it("rejects an empty or oversized upload and a buffered zip over 4 MB", async () => {
    const empty = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-empty",
      body: { filename: "samsung.zip", byteSize: 0 },
    }));
    expect(empty.status).toBe(400);
    const huge = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-huge",
      body: { filename: "samsung.zip", byteSize: 256 * 1024 * 1024 + 1 },
    }));
    expect(huge.status).toBe(400);
    const buffered = await postImport(request("POST", "/api/v1/imports", {
      token: owner.raw,
      key: "zip-buffered",
      zip: Buffer.alloc(4 * 1024 * 1024 + 1),
    }));
    expect(buffered.status).toBe(413);
  });

  it("requires import scope and hides another user's batch", async () => {
    const missing = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      key: "zip-auth",
      body: { filename: "samsung.zip", byteSize: 10 },
    }));
    expect(missing.status).toBe(401);
    const readOnly = await userWithToken(emails[2], ["read"]);
    const forbidden = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: readOnly.raw,
      key: "zip-scope",
      body: { filename: "samsung.zip", byteSize: 10 },
    }));
    expect(forbidden.status).toBe(403);
    const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-owned",
      body: { filename: "samsung.zip", byteSize: 32 },
    }));
    const body = await created.json();
    const hidden = await getImport(request("GET", `/api/v1/imports/${body.data.batchId}`, { token: other.raw }), body.data.batchId);
    expect(hidden.status).toBe(404);
    const complete = await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
      token: other.raw,
      key: "zip-owned-other",
    }), body.data.batchId);
    expect(complete.status).toBe(404);
  });

  it("replays the same upload key with a new signature and rejects a different body", async () => {
    const first = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-replay",
      body: { filename: "samsung.zip", byteSize: 128 },
    }));
    const signedBefore = calls.signed.length;
    const replay = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-replay",
      body: { filename: "samsung.zip", byteSize: 128 },
    }));
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(calls.signed.length).toBe(signedBefore + 1);
    const firstBody = await first.json();
    const replayBody = await replay.json();
    expect(replayBody.data.batchId).toBe(firstBody.data.batchId);
    const conflict = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-replay",
      body: { filename: "samsung.zip", byteSize: 256 },
    }));
    expect(conflict.status).toBe(409);
  });

  it("fails a batch whose object is not a zip", async () => {
    calls.magic = Buffer.from("XXXX");
    const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-magic",
      body: { filename: "samsung.zip", byteSize: 64 },
    }));
    const body = await created.json();
    const done = await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-magic-done",
    }), body.data.batchId);
    calls.magic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(done.status).toBe(400);
    const stored = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    expect(stored.status).toBe("failed");
    expect(stored.attemptCount).toBe(3);
  });

  it("fails bombs and oversized entry counts without keeping rows", async () => {
    const bomb = zipStored([{
      name: "com.samsung.health.weight.csv",
      data: Buffer.from("x"),
      uncompressedSize: 1_000_000_001,
    }]);
    const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-bomb",
      body: { filename: "samsung.zip", byteSize: bomb.length },
    }));
    const body = await created.json();
    await stage(body.data.batchId, bomb);
    const done = await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-bomb-done",
    }), body.data.batchId);
    expect(done.status).toBe(202);
    await processStoredImport(body.data.batchId);
    const stored = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    expect(stored.status).toBe("failed");
    expect(stored.lastError).toBe(ZIP_UNCOMPRESSED_TOO_LARGE);
    expect(stored.attemptCount).toBe(3);

    const crowded = zipStored(Array.from({ length: 2001 }, (_, index) => ({
      name: `notes/file-${index}.txt`,
      data: Buffer.from("x"),
    })));
    const second = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-entries",
      body: { filename: "samsung.zip", byteSize: crowded.length },
    }));
    const secondBody = await second.json();
    await stage(secondBody.data.batchId, crowded);
    await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${secondBody.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-entries-done",
    }), secondBody.data.batchId);
    await processStoredImport(secondBody.data.batchId);
    const failed = await prisma.importBatch.findUniqueOrThrow({ where: { id: secondBody.data.batchId } });
    expect(failed.lastError).toBe(ZIP_TOO_MANY_ENTRIES);
    const weights = await prisma.bodyMetric.count({ where: { userId: owner.user.id, sourceSystem: "samsung_health" } });
    expect(weights).toBe(0);
  });

  it("imports the same rows twice without duplicating them", async () => {
    const archive = weightZip(["2026-08-11 07:00:00.000,70,uuid-upload-once"]);
    const importOnce = async (key: string) => {
      const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
        token: owner.raw,
        key,
        body: { filename: "samsung.zip", byteSize: archive.length },
      }));
      const body = await created.json();
      await stage(body.data.batchId, archive);
      await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
        token: owner.raw,
        key: `${key}-done`,
      }), body.data.batchId);
      await processStoredImport(body.data.batchId);
      return prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    };
    const first = await importOnce("zip-dup-1");
    const second = await importOnce("zip-dup-2");
    expect((first.summary as { added: number }).added).toBeGreaterThan(0);
    expect((second.summary as { added: number }).added).toBe(0);
    const weights = await prisma.bodyMetric.count({
      where: { userId: owner.user.id, sourceId: "uuid-upload-once:weight", supersededAt: null, deletedAt: null },
    });
    expect(weights).toBe(1);
  });

  it("retries a failed attempt from the sweep and does not duplicate a row-level error", async () => {
    const archive = weightZip(["2026-08-12 07:00:00.000,70,uuid-upload-retry"]);
    const created = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-retry",
      body: { filename: "samsung.zip", byteSize: archive.length },
    }));
    const body = await created.json();
    await stage(body.data.batchId, archive);
    await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${body.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-retry-done",
    }), body.data.batchId);
    calls.failDownloads = 1;
    await processStoredImport(body.data.batchId);
    const failed = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    expect(failed.status).toBe("failed");
    expect(failed.attemptCount).toBe(1);
    await sweepImports();
    const recovered = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.data.batchId } });
    expect(recovered.status).toBe("completed");
    expect(recovered.attemptCount).toBe(2);

    const partial = weightZip([
      "2026-08-13 07:00:00.000,70,uuid-upload-good",
      "2026-08-13 08:00:00.000,150,uuid-upload-bad",
    ]);
    const createdPartial = await postImportUpload(request("POST", "/api/v1/imports/uploads", {
      token: owner.raw,
      key: "zip-partial",
      body: { filename: "samsung.zip", byteSize: partial.length },
    }));
    const partialBody = await createdPartial.json();
    await stage(partialBody.data.batchId, partial);
    await postImportUploadComplete(request("POST", `/api/v1/imports/uploads/${partialBody.data.batchId}/complete`, {
      token: owner.raw,
      key: "zip-partial-done",
    }), partialBody.data.batchId);
    await processStoredImport(partialBody.data.batchId);
    const withErrors = await prisma.importBatch.findUniqueOrThrow({ where: { id: partialBody.data.batchId } });
    expect(withErrors.status).toBe("completed_with_errors");
    await prisma.importBatch.update({
      where: { id: withErrors.id },
      data: { status: "queued", attemptCount: 1, finishedAt: null },
    });
    await processStoredImport(withErrors.id);
    const retried = await prisma.importBatch.findUniqueOrThrow({ where: { id: withErrors.id } });
    expect((retried.summary as { added: number }).added).toBe(0);
    const weights = await prisma.bodyMetric.count({
      where: { userId: owner.user.id, sourceId: "uuid-upload-good:weight", supersededAt: null, deletedAt: null },
    });
    expect(weights).toBe(1);
  });

  it("reclaims a processing lock older than 15 minutes", async () => {
    const archive = weightZip(["2026-08-14 07:00:00.000,70,uuid-upload-stale"]);
    const batch = await prisma.importBatch.create({
      data: {
        userId: owner.user.id,
        sourceSystem: "samsung_health",
        status: "running",
        byteSize: archive.length,
        attemptCount: 1,
        lockedAt: new Date(Date.now() - 16 * 60 * 1000),
        progress: { stage: "processing" },
      },
    });
    const objectKey = `imports/${owner.user.id}/${batch.id}/archive.zip`;
    await prisma.importBatch.update({ where: { id: batch.id }, data: { objectKey } });
    calls.files.set(objectKey, archive);
    await sweepImports();
    const stored = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.status).toBe("completed");
    expect(stored.attemptCount).toBe(2);
  });
});
