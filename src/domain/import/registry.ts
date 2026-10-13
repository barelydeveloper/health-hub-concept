export interface ImportAdapter {
  id: string;
  detect(files: { name: string }[]): boolean;
}

function basename(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? name;
}

function isSamsungName(name: string): boolean {
  if (name.includes("com.samsung.health") || name.includes("com.samsung.shealth")) return true;
  return /\.com\.samsung\.health\.exercise\.live_data\.json$/i.test(basename(name));
}

export const samsungAdapter: ImportAdapter = {
  id: "samsung_health",
  detect(files) {
    return files.some((file) => isSamsungName(file.name ?? ""));
  },
};

/** Documentation only. Parsers for these sources are not implemented. */
export const UNSUPPORTED_ADAPTERS = ["apple_health", "vitruvian", "generic_csv"] as const;

export function selectAdapter(files: { name: string }[]): ImportAdapter | null {
  if (samsungAdapter.detect(files)) return samsungAdapter;
  return null;
}
