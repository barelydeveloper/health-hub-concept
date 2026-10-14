import { describe, expect, it } from "vitest";
import { BUFFERED_ZIP_MAX_BYTES, DIRECT_UPLOAD_MAX_BYTES, zipNeedsDirectUpload } from "@/lib/import-limits";
import { importUploadSchema } from "../schemas";

describe("direct upload policy", () => {
  const samsungZipBytes = 53 * 1024 * 1024;

  it("accepts a 53 MB archive and rejects empty or oversized declarations", () => {
    expect(samsungZipBytes).toBeLessThanOrEqual(DIRECT_UPLOAD_MAX_BYTES);
    expect(importUploadSchema.safeParse({ filename: "samsung.zip", byteSize: samsungZipBytes }).success).toBe(true);
    expect(importUploadSchema.safeParse({ filename: "samsung.zip", byteSize: DIRECT_UPLOAD_MAX_BYTES }).success).toBe(true);
    expect(importUploadSchema.safeParse({ filename: "samsung.zip", byteSize: 0 }).success).toBe(false);
    expect(importUploadSchema.safeParse({ filename: "samsung.zip", byteSize: DIRECT_UPLOAD_MAX_BYTES + 1 }).success).toBe(false);
    expect(importUploadSchema.safeParse({ filename: "notes.csv", byteSize: 100 }).success).toBe(false);
  });

  it("keeps ZIP bodies over 4 MB off the buffered import route", () => {
    expect(zipNeedsDirectUpload(BUFFERED_ZIP_MAX_BYTES)).toBe(false);
    expect(zipNeedsDirectUpload(BUFFERED_ZIP_MAX_BYTES + 1)).toBe(true);
    expect(zipNeedsDirectUpload(samsungZipBytes)).toBe(true);
  });
});
