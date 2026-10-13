import type { ExistingRecord, IncomingRecord, MergePlan } from "./types";

function recordKey(sourceSystem: string, sourceId: string): string {
  return `${sourceSystem}\0${sourceId}`;
}

/**
 * Plan inserts, skips, revisions, and preserved user corrections.
 * An active row is one that is not superseded. Estimated rows revise like imports.
 */
export function planImportMerge(existing: ExistingRecord[], incoming: IncomingRecord[]): MergePlan {
  const active = new Map<string, ExistingRecord>();
  for (const row of existing) {
    if (row.superseded) continue;
    active.set(recordKey(row.sourceSystem, row.sourceId), row);
  }

  const plan: MergePlan = {
    insert: [],
    skipUnchanged: [],
    revise: [],
    keepUserCorrection: [],
  };

  for (const row of incoming) {
    const current = active.get(recordKey(row.sourceSystem, row.sourceId));
    if (!current) {
      plan.insert.push(row);
      continue;
    }
    if (current.contentHash === row.contentHash) {
      plan.skipUnchanged.push(row);
      continue;
    }
    if (current.valueOrigin === "user_entered" || current.valueOrigin === "measured") {
      plan.keepUserCorrection.push(row);
      continue;
    }
    plan.revise.push(row);
  }

  return plan;
}
