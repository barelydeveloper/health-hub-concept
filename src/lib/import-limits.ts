/** Buffered Netlify functions reject binary bodies above about 4.5 MB. */
export const BUFFERED_ZIP_MAX_BYTES = 4 * 1024 * 1024;

/** Direct upload ceiling. A 53 MB Samsung export is inside this limit. */
export const DIRECT_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;

export const ZIP_ENTRY_LIMIT = 2_000;
export const ZIP_UNCOMPRESSED_LIMIT = 1_000_000_000;

export function zipNeedsDirectUpload(byteSize: number): boolean {
  return !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > BUFFERED_ZIP_MAX_BYTES;
}
