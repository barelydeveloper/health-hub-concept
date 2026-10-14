import { describe, expect, it } from "vitest";
import { presignZipUpload } from "./storage";

describe("presigned zip upload", () => {
  it("binds content-length and content-type for a 53 MB object", async () => {
    process.env.NEON_STORAGE_ACCESS_KEY_ID = "AKIATESTKEY000000";
    process.env.NEON_STORAGE_SECRET_ACCESS_KEY = "secretsecretsecretsecretsecret12";
    process.env.NEON_STORAGE_ENDPOINT = "https://example.test";
    process.env.NEON_STORAGE_REGION = "us-east-2";
    const byteSize = 53 * 1024 * 1024;
    const signed = await presignZipUpload("imports/user/batch/archive.zip", byteSize);
    const headers = new URL(signed.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(headers).toEqual(expect.arrayContaining(["content-length", "content-type"]));
    const other = await presignZipUpload("imports/user/batch/archive.zip", byteSize + 1);
    expect(other.url).not.toBe(signed.url);
  });
});