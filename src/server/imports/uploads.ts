import { prisma } from "../db";
import { parseBody, withAuth, withWrite } from "../guard";
import { apiError, json } from "../http";
import { beginIdempotency, finishIdempotency, releaseIdempotency } from "../idempotency";
import { importUploadSchema } from "../schemas";
import { presentImport } from "../services/imports";
import { headAsset, importObjectKey, presignZipUpload, readAssetPrefix } from "../storage";
import { enqueueImportWorker } from "./worker";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function pathOf(req: Request): string {
  return new URL(req.url).pathname;
}

export async function postImportUpload(req: Request): Promise<Response> {
  return withAuth(req, "import", async (ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError(400, "invalid_json", "Request body must be JSON.");
    }
    const parsed = parseBody(importUploadSchema, body);
    if (!parsed.ok) return parsed.response;
    const claim = await beginIdempotency({
      userId: ctx.userId,
      key: req.headers.get("idempotency-key"),
      method: "POST",
      path: pathOf(req),
      body: parsed.data,
    });
    if (claim instanceof Response) return claim;
    if ("replay" in claim && claim.replay) {
      const stored = await claim.replay.json() as { data?: { batchId?: string } };
      const batch = stored.data?.batchId
        ? await prisma.importBatch.findFirst({ where: { id: stored.data.batchId, userId: ctx.userId } })
        : null;
      if (!batch?.objectKey || batch.byteSize == null) return claim.replay;
      const signed = await presignZipUpload(batch.objectKey, batch.byteSize);
      return json({
        data: {
          batchId: batch.id,
          objectKey: batch.objectKey,
          byteSize: batch.byteSize,
          uploadUrl: signed.url,
          expiresAt: signed.expiresAt,
        },
      }, 201, { "Idempotent-Replayed": "true" });
    }
    try {
      const created = await prisma.importBatch.create({
        data: {
          userId: ctx.userId,
          sourceSystem: "samsung_health",
          status: "pending",
          label: parsed.data.filename,
          byteSize: parsed.data.byteSize,
          progress: { stage: "pending" },
        },
      });
      const objectKey = importObjectKey(ctx.userId, created.id, "archive.zip");
      const batch = await prisma.importBatch.update({ where: { id: created.id }, data: { objectKey } });
      const signed = await presignZipUpload(objectKey, parsed.data.byteSize);
      return finishIdempotency(ctx.userId, claim.key, json({
        data: {
          batchId: batch.id,
          objectKey,
          byteSize: batch.byteSize,
          uploadUrl: signed.url,
          expiresAt: signed.expiresAt,
        },
      }, 201));
    } catch (error) {
      console.error(error);
      await releaseIdempotency(ctx.userId, claim.key);
      return apiError(500, "internal_error", "The upload could not be started.");
    }
  });
}

export async function postImportUploadComplete(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "import", async (ctx) => {
    const batch = await prisma.importBatch.findFirst({ where: { id, userId: ctx.userId } });
    if (!batch?.objectKey || batch.byteSize == null) return apiError(404, "not_found", "Import batch was not found.");
    if (batch.status === "queued" || batch.status === "running" || batch.status === "completed" || batch.status === "completed_with_errors") {
      return json({ data: { batchId: batch.id, status: batch.status } }, 202);
    }
    if (batch.status === "failed") {
      return apiError(400, "import_failed", batch.lastError ?? "The archive could not be imported.");
    }
    const head = await headAsset(batch.objectKey);
    if (head.byteSize !== batch.byteSize) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "failed",
          lastError: "Uploaded size does not match the declared size.",
          attemptCount: 3,
          finishedAt: new Date(),
          progress: { stage: "failed" },
        },
      });
      return apiError(400, "import_failed", "Uploaded size does not match the declared size.");
    }
    const prefix = await readAssetPrefix(batch.objectKey, 4);
    if (prefix.length < 4 || !prefix.subarray(0, 4).equals(ZIP_MAGIC)) {
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: "failed",
          lastError: "The object is not a ZIP archive.",
          attemptCount: 3,
          finishedAt: new Date(),
          progress: { stage: "failed" },
        },
      });
      return apiError(400, "invalid_archive", "The object is not a ZIP archive.");
    }
    await prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "queued", progress: { stage: "queued" }, lastError: null, finishedAt: null },
    });
    enqueueImportWorker(batch.id);
    return json({ data: { batchId: batch.id, status: "queued" } }, 202);
  });
}

export async function getImport(req: Request, id: string): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const batch = await prisma.importBatch.findFirst({
      where: { id, userId: ctx.userId },
      include: { files: true, errors: true },
    });
    if (!batch) return apiError(404, "not_found", "Import batch was not found.");
    return json({ data: presentImport(batch) });
  });
}
