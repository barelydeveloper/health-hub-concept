import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { ZIP_TOO_MANY_ENTRIES, ZIP_UNCOMPRESSED_TOO_LARGE, parseSamsungZip } from "@/domain/import/samsung/parse";
import { prisma } from "../db";
import { persistSamsungImport } from "../services/imports";
import { downloadAssetToFile } from "../storage";

const MAX_ATTEMPTS = 3;
const LOCK_MS = 15 * 60 * 1000;

function staleBefore(now = new Date()): Date {
  return new Date(now.getTime() - LOCK_MS);
}

export async function claimImportBatch(batchId: string, now = new Date()): Promise<boolean> {
  const claimed = await prisma.importBatch.updateMany({
    where: {
      id: batchId,
      objectKey: { not: null },
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "queued" },
        { status: "failed" },
        { status: "running", lockedAt: { lt: staleBefore(now) } },
      ],
    },
    data: {
      status: "running",
      lockedAt: now,
      attemptCount: { increment: 1 },
      lastError: null,
      finishedAt: null,
      progress: { stage: "processing" },
    },
  });
  return claimed.count === 1;
}

async function failBatch(batchId: string, message: string, terminal: boolean): Promise<void> {
  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      status: "failed",
      lastError: message.slice(0, 500),
      finishedAt: new Date(),
      lockedAt: null,
      progress: { stage: "failed" },
      ...(terminal ? { attemptCount: MAX_ATTEMPTS } : {}),
    },
  });
}

function fatalArchiveMessage(messages: string[]): string | null {
  return messages.find((message) => (
    message === ZIP_TOO_MANY_ENTRIES
    || message === ZIP_UNCOMPRESSED_TOO_LARGE
    || message === "invalid zip"
    || message.toLowerCase().includes("invalid zip")
  )) ?? null;
}

export async function processStoredImport(batchId: string): Promise<void> {
  const claimed = await claimImportBatch(batchId);
  if (!claimed) return;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch?.objectKey || batch.byteSize == null) {
    await failBatch(batchId, "Import object is missing.", true);
    return;
  }
  const dest = path.join(tmpdir(), `samsung-import-${batchId}.zip`);
  try {
    const file = await downloadAssetToFile(batch.objectKey, dest, batch.byteSize);
    if (file.byteSize !== batch.byteSize) {
      await failBatch(batchId, "Stored object size does not match the upload.", true);
      return;
    }
    await prisma.importBatch.update({ where: { id: batchId }, data: { contentHash: file.sha256 } });
    const draft = await parseSamsungZip(await readFile(dest));
    const fatal = fatalArchiveMessage(draft.errors.map((error) => error.message));
    if (fatal) {
      await failBatch(batchId, fatal, true);
      return;
    }
    await persistSamsungImport(
      { userId: batch.userId, tokenId: null, scopes: ["import"], via: "session" },
      draft,
      batch.label ?? undefined,
      { batchId: batch.id, archiveKey: batch.objectKey },
    );
    await prisma.importBatch.update({ where: { id: batchId }, data: { progress: { stage: "done" } } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The archive could not be imported.";
    await failBatch(batchId, message, false);
  } finally {
    await rm(dest, { force: true });
  }
}

export async function sweepImports(): Promise<number> {
  const due = await prisma.importBatch.findMany({
    where: {
      objectKey: { not: null },
      attemptCount: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "queued" },
        { status: "failed" },
        { status: "running", lockedAt: { lt: staleBefore() } },
      ],
    },
    select: { id: true },
    orderBy: { startedAt: "asc" },
    take: 5,
  });
  for (const batch of due) await processStoredImport(batch.id);
  return due.length;
}

export function enqueueImportWorker(batchId: string): void {
  if (process.env.VITEST) return;
  if (process.env.NETLIFY) {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
    void fetch(`${base}/.netlify/functions/import-worker-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId }),
    }).catch((error) => {
      console.error(error);
    });
    return;
  }
  void processStoredImport(batchId).catch((error) => {
    console.error(error);
  });
}
