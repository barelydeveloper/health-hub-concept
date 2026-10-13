import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1);
    }
  } catch {
    // The process environment is already populated.
  }
}
