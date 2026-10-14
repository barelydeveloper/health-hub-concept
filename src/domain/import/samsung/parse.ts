import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parse as parseCsvSync } from "csv-parse/sync";
import yauzl from "yauzl";
import type { Entry } from "yauzl";
import type {
  ImportError,
  SamsungDataset,
  SamsungDay,
  SamsungImportDraft,
  SamsungWorkout,
} from "../types";

export const KG_TO_LB = 2.20462262;
export const MS_TO_MPH = 2.23693629;
export const M_TO_MI = 1 / 1609.344;

const MAX_FIELD_CHARS = 100_000;
const RESISTANCE_EXERCISE_TYPE = 15004;

const DATASET_PREFIXES: { dataset: SamsungDataset; id: string }[] = [
  { dataset: "caloriesBurned", id: "com.samsung.shealth.calories_burned.details" },
  { dataset: "daySummary", id: "com.samsung.shealth.activity.day_summary" },
  { dataset: "sleepCombined", id: "com.samsung.shealth.sleep_combined" },
  { dataset: "sleep", id: "com.samsung.shealth.sleep" },
  { dataset: "weight", id: "com.samsung.health.weight" },
  { dataset: "steps", id: "com.samsung.shealth.step_daily_trend" },
  { dataset: "nutrition", id: "com.samsung.health.nutrition" },
  { dataset: "userProfile", id: "com.samsung.health.user_profile" },
];

interface RawRow {
  file: string;
  line: number;
  cells: Record<string, string>;
}

interface LoadedFile {
  name: string;
  dataset: SamsungDataset | null;
  rows: RawRow[];
  errors: ImportError[];
  text?: string;
}

interface WeightWin {
  date: string;
  startTime: string;
  recordedAt: string;
  sourceId: string;
  weightLb: number;
  bodyFatPercent?: number;
  fatMassLb?: number;
  skeletalMuscleLb?: number;
  bodyWaterLb?: number;
  original: Record<string, unknown>;
}

interface InternalWorkout extends SamsungWorkout {
  date: string;
}

interface CsvSkipError extends Error {
  lines?: number;
}

function basename(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? name;
}

function emptyDraft(): SamsungImportDraft {
  return {
    sourceSystem: "samsung_health",
    discovered: [],
    unsupported: [],
    errors: [],
    duplicatesSkipped: 0,
    profile: { birthDate: null },
    days: [],
    workouts: [],
  };
}

export function datasetFromFilename(filename: string): SamsungDataset | null {
  const base = basename(filename);
  if (/\.com\.samsung\.health\.exercise\.live_data\.json$/i.test(base)) return "liveData";

  let stem = base.replace(/\.csv$/i, "");
  stem = stem.replace(/\.\d{14}$/, "");

  if (stem === "com.samsung.shealth.exercise") return "exercise";
  if (stem.startsWith("com.samsung.shealth.exercise.")) return null;

  for (const entry of DATASET_PREFIXES) {
    if (stem === entry.id || stem.startsWith(`${entry.id}.`)) return entry.dataset;
  }
  return null;
}

function isUnsafeZipPath(name: string): boolean {
  return name.startsWith("/") || name.startsWith("\\") || name.includes("..");
}

function decodeEntryName(entry: Entry): string {
  // yauzl types fileName as string. With decodeStrings: false it is the raw name buffer.
  const rawName = (entry as unknown as { fileName: string | Buffer }).fileName;
  if (typeof rawName === "string") return rawName;
  return rawName.toString("utf8");
}

const MAX_RECORD_CHARS = 5_000_000;

function stripTextMarker(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("'")) text = text.slice(1).trim();
  return text;
}

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const text = stripTextMarker(raw);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isRealDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function calendarDate(ts: string | undefined): string | null {
  if (ts == null) return null;
  const text = stripTextMarker(ts);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match && isRealDate(match[1])) return match[1];
  const epoch = parseFiniteNumber(text);
  if (epoch != null && Math.abs(epoch) > 1e11) {
    const date = new Date(epoch);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

function recordedAtFromTimestamp(ts: string): string | null {
  const text = stripTextMarker(ts);
  if (!text) return null;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const zoned = new Date(text.includes("T") ? text : text.replace(" ", "T"));
    return Number.isNaN(zoned.getTime()) ? null : zoned.toISOString();
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?)?$/.exec(text);
  if (match && isRealDate(match[1])) {
    if (match[2] == null) return `${match[1]}T00:00:00.000Z`;
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    const second = Number(match[4]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const fraction = match[5] ?? "";
    const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${fraction}Z`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const epoch = parseFiniteNumber(text);
  if (epoch != null && Math.abs(epoch) > 1e11) {
    const date = new Date(epoch);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/** Later instant wins. Equal instants keep the row already chosen. */
function isLaterTimestamp(candidate: string, current: string): boolean {
  const next = recordedAtFromTimestamp(candidate);
  const prev = recordedAtFromTimestamp(current);
  if (next && prev) return next > prev;
  if (next) return true;
  if (prev) return false;
  return stripTextMarker(candidate) > stripTextMarker(current);
}

function cell(row: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value != null && value.trim() !== "") return value;
  }
  return undefined;
}

function numericCell(row: Record<string, string>, names: string[]): number | null {
  return parseFiniteNumber(cell(row, names));
}

function plainCells(cells: Record<string, string>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(cells)) payload[key] = cells[key];
  return payload;
}

function hashRow(cells: Record<string, string>): string {
  const body = Object.keys(cells)
    .sort()
    .map((key) => `${key}=${cells[key]}`)
    .join("\n");
  return createHash("sha256").update(body).digest("hex");
}

function kgToLb(kg: number): number {
  return kg * KG_TO_LB;
}

function originalMeasure(
  raw: string | undefined,
  unit: string,
): { originalValue: number | string; originalUnit: string } | undefined {
  if (raw == null) return undefined;
  const numeric = parseFiniteNumber(raw);
  return { originalValue: numeric != null ? numeric : raw, originalUnit: unit };
}

interface InfoRecord {
  record: Record<string, unknown>;
  info?: { lines?: number };
}

function unwrapRecord(item: unknown): { record: Record<string, unknown>; line: number } | null {
  if (!item || typeof item !== "object") return null;
  const wrapped = item as InfoRecord;
  const record =
    wrapped.record && typeof wrapped.record === "object" && !Array.isArray(wrapped.record)
      ? wrapped.record
      : (item as Record<string, unknown>);
  const line = typeof wrapped.info?.lines === "number" ? wrapped.info.lines : 0;
  return { record, line };
}

function normalizeCells(record: Record<string, unknown>): { cells: Record<string, string>; truncated: boolean } {
  const cells = Object.create(null) as Record<string, string>;
  let truncated = false;
  for (const key of Object.keys(record)) {
    const value = record[key];
    let text = value == null ? "" : String(value);
    if (text.length > MAX_FIELD_CHARS) {
      text = text.slice(0, MAX_FIELD_CHARS);
      truncated = true;
    }
    cells[key] = text;
  }
  return { cells, truncated };
}

function pushNormalized(
  rows: RawRow[],
  errors: ImportError[],
  file: string,
  item: unknown,
): void {
  const unwrapped = unwrapRecord(item);
  if (!unwrapped) return;
  const normalized = normalizeCells(unwrapped.record);
  const line = unwrapped.line > 0 ? unwrapped.line : null;
  if (normalized.truncated) {
    errors.push({ file, row: line, message: "field truncated" });
  }
  rows.push({ file, line: unwrapped.line, cells: normalized.cells });
}

interface CsvAccum {
  rows: RawRow[];
  errors: ImportError[];
  header: string[] | null;
  headerFailed: boolean;
}

function readHeader(line: string): string[] | null {
  try {
    const parsed: unknown = parseCsvSync(line, { relax_column_count: true, skip_records_with_error: true });
    if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0])) return null;
    return (parsed[0] as unknown[]).map((name) => (name == null ? "" : String(name)));
  } catch {
    return null;
  }
}

function parseDataLine(file: string, lineNo: number, text: string, header: string[], acc: CsvAccum): void {
  let skipped = false;
  try {
    const options = {
      columns: header,
      relax_column_count: true,
      skip_records_with_error: true,
      on_skip: (err: CsvSkipError) => {
        skipped = true;
        acc.errors.push({ file, row: lineNo, message: err.message || "row skipped" });
      },
    };
    const parsed: unknown = parseCsvSync(text, options as Parameters<typeof parseCsvSync>[1]);
    if (!Array.isArray(parsed)) return;
    for (const record of parsed) {
      pushNormalized(acc.rows, acc.errors, file, { record, info: { lines: lineNo } });
    }
  } catch (err) {
    if (skipped) return;
    acc.errors.push({
      file,
      row: lineNo,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Samsung exports are one record per physical line. Line 1 is metadata; line 2 is the header. */
function consumeCsvLine(file: string, lineNo: number, text: string, acc: CsvAccum): void {
  if (lineNo < 2 || text.length === 0) return;
  if (text.length > MAX_RECORD_CHARS) {
    acc.errors.push({ file, row: lineNo, message: "Max record size exceeded" });
    return;
  }
  if (!acc.header) {
    if (acc.headerFailed) return;
    const header = readHeader(text);
    if (!header) {
      acc.headerFailed = true;
      acc.errors.push({ file, row: lineNo, message: "unparseable header" });
      return;
    }
    acc.header = header;
    return;
  }
  parseDataLine(file, lineNo, text, acc.header, acc);
}

function emptyCsvAccum(): CsvAccum {
  return { rows: [], errors: [], header: null, headerFailed: false };
}

function parseCsvText(csvText: string, file: string): { rows: RawRow[]; errors: ImportError[] } {
  const normalized = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  const acc = emptyCsvAccum();
  parts.forEach((text, index) => consumeCsvLine(file, index + 1, text, acc));
  return { rows: acc.rows, errors: acc.errors };
}

async function parseCsvReadable(stream: Readable, file: string): Promise<{ rows: RawRow[]; errors: ImportError[] }> {
  const acc = emptyCsvAccum();
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (let text of lines) {
      lineNo += 1;
      if (lineNo === 1) text = text.replace(/^\uFEFF/, "");
      consumeCsvLine(file, lineNo, text, acc);
    }
  } catch (err) {
    acc.errors.push({
      file,
      row: null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { rows: acc.rows, errors: acc.errors };
}

function capPrimitive(value: unknown): { value: unknown; truncated: boolean } {
  if (typeof value === "string") {
    if (value.length > MAX_FIELD_CHARS) return { value: value.slice(0, MAX_FIELD_CHARS), truncated: true };
    return { value, truncated: false };
  }
  if (typeof value === "number") return { value: Number.isFinite(value) ? value : null, truncated: false };
  if (typeof value === "boolean" || value == null) return { value, truncated: false };
  return { value: null, truncated: false };
}

function capHeartRate(value: unknown): { value: number | string | null; truncated: boolean } {
  const capped = capPrimitive(value);
  if (typeof capped.value === "number") return { value: capped.value, truncated: false };
  if (typeof capped.value !== "string") return { value: null, truncated: capped.truncated };
  const numeric = parseFiniteNumber(capped.value);
  if (numeric != null) return { value: numeric, truncated: capped.truncated };
  return { value: capped.value, truncated: capped.truncated };
}

function reduceWeight(rows: RawRow[]): { wins: WeightWin[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const best = new Map<string, WeightWin>();
  for (const row of rows) {
    try {
      const startRaw = cell(row.cells, ["start_time", "com.samsung.health.weight.start_time"]);
      const weightRaw = cell(row.cells, ["weight", "com.samsung.health.weight.weight"]);
      if (startRaw == null && weightRaw == null) continue;
      const startTime = startRaw ? stripTextMarker(startRaw) : "";
      const date = startTime ? calendarDate(startTime) : null;
      const recordedAt = startTime ? recordedAtFromTimestamp(startTime) : null;
      if (!date || !recordedAt) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable start_time" });
        continue;
      }
      const kg = parseFiniteNumber(weightRaw);
      if (kg == null) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable weight" });
        continue;
      }
      if (kg > 100) {
        errors.push({ file: row.file, row: row.line || null, message: "weight above 100 kg skipped" });
        continue;
      }
      const prev = best.get(date);
      if (prev && !isLaterTimestamp(startTime, prev.startTime)) continue;

      const bodyFatRaw = cell(row.cells, ["body_fat", "com.samsung.health.weight.body_fat"]);
      const fatMassRaw = cell(row.cells, ["body_fat_mass", "com.samsung.health.weight.body_fat_mass"]);
      const muscleRaw = cell(row.cells, ["skeletal_muscle_mass", "com.samsung.health.weight.skeletal_muscle_mass"]);
      const waterRaw = cell(row.cells, ["total_body_water", "com.samsung.health.weight.total_body_water"]);
      const bodyFat = parseFiniteNumber(bodyFatRaw);
      const fatMass = parseFiniteNumber(fatMassRaw);
      const muscle = parseFiniteNumber(muscleRaw);
      const water = parseFiniteNumber(waterRaw);
      const datauuid = cell(row.cells, ["datauuid", "com.samsung.health.weight.datauuid"]);

      const original: Record<string, unknown> = {
        recordedAt,
        weightKg: kg,
        weight: { originalValue: kg, originalUnit: "kg" },
        payload: plainCells(row.cells),
      };
      const bodyFatMeasure = originalMeasure(bodyFatRaw, "%");
      const fatMassMeasure = originalMeasure(fatMassRaw, "kg");
      const muscleMeasure = originalMeasure(muscleRaw, "kg");
      const waterMeasure = originalMeasure(waterRaw, "kg");
      if (bodyFatMeasure) original.bodyFat = bodyFatMeasure;
      if (fatMassMeasure) {
        original.fatMass = fatMassMeasure;
        if (typeof fatMassMeasure.originalValue === "number") original.bodyFatMassKg = fatMassMeasure.originalValue;
      }
      if (muscleMeasure) {
        original.skeletalMuscle = muscleMeasure;
        if (typeof muscleMeasure.originalValue === "number") original.skeletalMuscleMassKg = muscleMeasure.originalValue;
      }
      if (waterMeasure) {
        original.bodyWater = waterMeasure;
        if (typeof waterMeasure.originalValue === "number") original.totalBodyWaterKg = waterMeasure.originalValue;
      }

      const win: WeightWin = {
        date,
        startTime,
        recordedAt,
        sourceId: datauuid?.trim() ? datauuid.trim() : hashRow(row.cells),
        weightLb: kgToLb(kg),
        original,
      };
      if (bodyFat != null) win.bodyFatPercent = bodyFat;
      if (fatMass != null) win.fatMassLb = kgToLb(fatMass);
      if (muscle != null) win.skeletalMuscleLb = kgToLb(muscle);
      if (water != null) win.bodyWaterLb = kgToLb(water);
      best.set(date, win);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { wins: [...best.values()], errors };
}

function reduceSteps(rows: RawRow[]): { days: { date: string; steps: number }[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const days = new Map<string, number>();
  for (const row of rows) {
    try {
      const sourceRaw = cell(row.cells, ["source_type", "com.samsung.shealth.step_daily_trend.source_type"]);
      const sourceNumeric = parseFiniteNumber(sourceRaw);
      const sourceText = sourceRaw?.trim().replace(/^'/, "") ?? "";
      if (sourceText !== "-2" && sourceNumeric !== -2) continue;
      const dayRaw =
        cell(row.cells, ["day_time", "com.samsung.shealth.step_daily_trend.day_time"]) ??
        cell(row.cells, ["start_time", "com.samsung.shealth.step_daily_trend.start_time"]);
      const date = calendarDate(dayRaw);
      if (!date) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable date" });
        continue;
      }
      const countRaw = cell(row.cells, ["count", "com.samsung.shealth.step_daily_trend.count"]);
      const count = parseFiniteNumber(countRaw);
      if (count == null) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable count" });
        continue;
      }
      days.set(date, Math.round(count));
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { days: [...days.entries()].map(([date, steps]) => ({ date, steps })), errors };
}

function nutritionNumber(row: RawRow, names: string[], errors: ImportError[]): number | null {
  const raw = cell(row.cells, names);
  if (raw == null) return null;
  const value = parseFiniteNumber(raw);
  if (value == null) {
    errors.push({ file: row.file, row: row.line || null, message: "unparseable number" });
    return null;
  }
  return value;
}

function reduceNutrition(rows: RawRow[]): {
  days: {
    date: string;
    calories?: number;
    proteinG?: number;
    carbG?: number;
    fiberG?: number;
    fatG?: number;
    sodiumMg?: number;
  }[];
  errors: ImportError[];
} {
  const errors: ImportError[] = [];
  const acc = new Map<
    string,
    { calories?: number; proteinG?: number; carbG?: number; fiberG?: number; fatG?: number; sodiumMg?: number }
  >();
  for (const row of rows) {
    try {
      const startRaw = cell(row.cells, ["start_time", "com.samsung.health.nutrition.start_time"]);
      const date = calendarDate(startRaw);
      if (!date) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable date" });
        continue;
      }
      const calories = nutritionNumber(row, ["calorie", "com.samsung.health.nutrition.calorie"], errors);
      const protein = nutritionNumber(row, ["protein", "com.samsung.health.nutrition.protein"], errors);
      const carbs = nutritionNumber(row, ["carbohydrate", "com.samsung.health.nutrition.carbohydrate"], errors);
      const fiber = nutritionNumber(row, ["dietary_fiber", "com.samsung.health.nutrition.dietary_fiber"], errors);
      const fat = nutritionNumber(row, ["total_fat", "com.samsung.health.nutrition.total_fat"], errors);
      const sodium = nutritionNumber(row, ["sodium", "com.samsung.health.nutrition.sodium"], errors);
      if (calories == null && protein == null && carbs == null && fiber == null && fat == null && sodium == null) {
        continue;
      }
      const bucket = acc.get(date) ?? {};
      if (calories != null) bucket.calories = (bucket.calories ?? 0) + calories;
      if (protein != null) bucket.proteinG = (bucket.proteinG ?? 0) + protein;
      if (carbs != null) bucket.carbG = (bucket.carbG ?? 0) + carbs;
      if (fiber != null) bucket.fiberG = (bucket.fiberG ?? 0) + fiber;
      if (fat != null) bucket.fatG = (bucket.fatG ?? 0) + fat;
      if (sodium != null) bucket.sodiumMg = (bucket.sodiumMg ?? 0) + sodium;
      acc.set(date, bucket);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const days = [...acc.entries()].map(([date, bucket]) => {
    const day: {
      date: string;
      calories?: number;
      proteinG?: number;
      carbG?: number;
      fiberG?: number;
      fatG?: number;
      sodiumMg?: number;
    } = { date };
    if (bucket.calories != null) day.calories = bucket.calories;
    if (bucket.proteinG != null) day.proteinG = bucket.proteinG;
    if (bucket.carbG != null) day.carbG = bucket.carbG;
    if (bucket.fiberG != null) day.fiberG = bucket.fiberG;
    if (bucket.fatG != null) day.fatG = bucket.fatG;
    if (bucket.sodiumMg != null) day.sodiumMg = bucket.sodiumMg;
    return day;
  });
  return { days, errors };
}

function sleepHoursFromRows(rows: RawRow[], mode: "last" | "sum"): {
  days: { date: string; sleepHours: number }[];
  errors: ImportError[];
} {
  const errors: ImportError[] = [];
  if (mode === "last") {
    const days = new Map<string, number>();
    for (const row of rows) {
      try {
        const endRaw = cell(row.cells, ["end_time", "com.samsung.shealth.sleep_combined.end_time", "com.samsung.shealth.sleep.end_time"]);
        const startRaw = cell(row.cells, ["start_time", "com.samsung.shealth.sleep_combined.start_time", "com.samsung.shealth.sleep.start_time"]);
        const date = calendarDate(endRaw) ?? calendarDate(startRaw);
        if (!date) {
          if (endRaw != null || startRaw != null) {
            errors.push({ file: row.file, row: row.line || null, message: "unparseable date" });
          }
          continue;
        }
        const durationRaw = cell(row.cells, [
          "sleep_duration",
          "com.samsung.shealth.sleep_combined.sleep_duration",
          "com.samsung.shealth.sleep.sleep_duration",
        ]);
        const minutes = parseFiniteNumber(durationRaw);
        if (minutes == null) {
          errors.push({ file: row.file, row: row.line || null, message: "unparseable sleep_duration" });
          continue;
        }
        days.set(date, minutes / 60);
      } catch (err) {
        errors.push({
          file: row.file,
          row: row.line || null,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { days: [...days.entries()].map(([date, sleepHours]) => ({ date, sleepHours })), errors };
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    try {
      const endRaw = cell(row.cells, ["end_time", "com.samsung.shealth.sleep.end_time"]);
      const startRaw = cell(row.cells, ["start_time", "com.samsung.shealth.sleep.start_time"]);
      const date = calendarDate(endRaw) ?? calendarDate(startRaw);
      if (!date) {
        if (endRaw != null || startRaw != null) {
          errors.push({ file: row.file, row: row.line || null, message: "unparseable date" });
        }
        continue;
      }
      const durationRaw = cell(row.cells, ["sleep_duration", "com.samsung.shealth.sleep.sleep_duration"]);
      const minutes = parseFiniteNumber(durationRaw);
      if (minutes == null) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable sleep_duration" });
        continue;
      }
      totals.set(date, (totals.get(date) ?? 0) + minutes);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    days: [...totals.entries()].map(([date, minutes]) => ({ date, sleepHours: minutes / 60 })),
    errors,
  };
}

function reduceExercise(rows: RawRow[]): { workouts: InternalWorkout[]; duplicatesSkipped: number; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const byId = new Map<string, InternalWorkout>();
  let duplicatesSkipped = 0;

  for (const row of rows) {
    try {
      const datauuid = cell(row.cells, ["com.samsung.health.exercise.datauuid", "datauuid"]);
      if (!datauuid?.trim()) {
        errors.push({ file: row.file, row: row.line || null, message: "missing datauuid" });
        continue;
      }
      const startRaw = cell(row.cells, ["com.samsung.health.exercise.start_time", "start_time"]);
      const date = calendarDate(startRaw);
      const startedAt = startRaw ? recordedAtFromTimestamp(startRaw) : null;
      if (!date || !startedAt) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable start_time" });
        continue;
      }
      const durationMs = numericCell(row.cells, ["com.samsung.health.exercise.duration", "duration"]);
      const distanceM = numericCell(row.cells, ["com.samsung.health.exercise.distance", "distance"]);
      const durationOk = durationMs != null && durationMs > 0;
      const distanceOk = distanceM != null && distanceM > 0;
      if (!durationOk && !distanceOk) {
        errors.push({ file: row.file, row: row.line || null, message: "duration and distance are not positive" });
        continue;
      }
      const sourceId = datauuid.trim();
      if (byId.has(sourceId)) duplicatesSkipped += 1;
      const exerciseType = numericCell(row.cells, ["com.samsung.health.exercise.exercise_type", "exercise_type"]) ?? 0;
      const calories = numericCell(row.cells, [
        "com.samsung.health.exercise.calorie",
        "calorie",
        "total_calorie",
        "com.samsung.health.exercise.total_calorie",
      ]);
      const meanSpeed = numericCell(row.cells, ["com.samsung.health.exercise.mean_speed", "mean_speed"]);
      const maxSpeed = numericCell(row.cells, ["com.samsung.health.exercise.max_speed", "max_speed"]);
      byId.set(sourceId, {
        date,
        sourceId,
        startedAt,
        exerciseType,
        durationMin: durationOk && durationMs != null ? durationMs / 60000 : null,
        distanceMi: distanceM != null ? distanceM * M_TO_MI : null,
        calories,
        meanSpeedMph: meanSpeed != null ? meanSpeed * MS_TO_MPH : null,
        maxSpeedMph: maxSpeed != null ? maxSpeed * MS_TO_MPH : null,
        meanHr: numericCell(row.cells, ["com.samsung.health.exercise.mean_heart_rate", "mean_heart_rate"]),
        maxHr: numericCell(row.cells, ["com.samsung.health.exercise.max_heart_rate", "max_heart_rate"]),
        minHr: numericCell(row.cells, ["com.samsung.health.exercise.min_heart_rate", "min_heart_rate"]),
        meanCadence: numericCell(row.cells, ["com.samsung.health.exercise.mean_cadence", "mean_cadence"]),
        payload: plainCells(row.cells),
      });
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { workouts: [...byId.values()], duplicatesSkipped, errors };
}

interface CalorieWin {
  date: string;
  update: string;
  bmr?: number;
  activeCalories?: number;
  burnedCalories?: number;
}

function reduceCalories(rows: RawRow[]): { days: CalorieWin[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const best = new Map<string, CalorieWin>();
  for (const row of rows) {
    try {
      const date = calendarDate(
        cell(row.cells, ["com.samsung.shealth.calories_burned.day_time", "day_time"]),
      );
      if (!date) continue;
      const update =
        cell(row.cells, ["com.samsung.shealth.calories_burned.update_time", "update_time"])?.trim() ?? "";
      const prev = best.get(date);
      if (prev && !isLaterTimestamp(update, prev.update)) continue;
      const rest = numericCell(row.cells, ["com.samsung.shealth.calories_burned.rest_calorie", "rest_calorie"]);
      const active = numericCell(row.cells, ["com.samsung.shealth.calories_burned.active_calorie", "active_calorie"]);
      const tef = numericCell(row.cells, ["com.samsung.shealth.calories_burned.tef_calorie", "tef_calorie"]);
      if (rest == null && active == null && tef == null) continue;
      const win: CalorieWin = { date, update, burnedCalories: (rest ?? 0) + (active ?? 0) + (tef ?? 0) };
      if (rest != null) win.bmr = rest;
      if (active != null) win.activeCalories = active;
      best.set(date, win);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { days: [...best.values()], errors };
}

interface SummaryWin {
  date: string;
  update: string;
  walkMinutes?: number;
  workoutMinutes?: number;
  activeCalories?: number;
  steps?: number;
}

function reduceDaySummary(rows: RawRow[]): { days: SummaryWin[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const best = new Map<string, SummaryWin>();
  for (const row of rows) {
    try {
      const date =
        calendarDate(cell(row.cells, ["day_time", "com.samsung.shealth.activity.day_summary.day_time"])) ??
        calendarDate(cell(row.cells, ["create_time", "com.samsung.shealth.activity.day_summary.create_time"]));
      if (!date) continue;
      const update = cell(row.cells, ["update_time", "com.samsung.shealth.activity.day_summary.update_time"])?.trim() ?? "";
      const prev = best.get(date);
      if (prev && !isLaterTimestamp(update, prev.update)) continue;
      const walkMs = numericCell(row.cells, ["walk_time", "com.samsung.shealth.activity.day_summary.walk_time"]);
      const exerciseMs = numericCell(row.cells, ["exercise_time", "com.samsung.shealth.activity.day_summary.exercise_time"]);
      const active = numericCell(row.cells, ["calorie", "com.samsung.shealth.activity.day_summary.calorie"]);
      const steps = numericCell(row.cells, ["step_count", "com.samsung.shealth.activity.day_summary.step_count"]);
      const win: SummaryWin = { date, update };
      if (walkMs != null) win.walkMinutes = walkMs / 60000;
      if (exerciseMs != null && exerciseMs > 0) win.workoutMinutes = exerciseMs / 60000;
      if (active != null) win.activeCalories = active;
      if (steps != null) win.steps = Math.round(steps);
      best.set(date, win);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { days: [...best.values()], errors };
}

function parseBirthValue(raw: string): string | null {
  const text = raw.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) {
    const iso = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return isRealDate(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && isRealDate(text)) return text;
  return null;
}

function reduceProfile(rows: RawRow[]): { birthDate: string | null; errors: ImportError[] } {
  const errors: ImportError[] = [];
  let birthDate: string | null = null;
  for (const row of rows) {
    try {
      const key = cell(row.cells, ["key", "com.samsung.health.user_profile.key"]);
      if (key !== "birth_date") continue;
      const candidates = [
        cell(row.cells, ["text_value", "com.samsung.health.user_profile.text_value"]),
        cell(row.cells, ["int_value", "com.samsung.health.user_profile.int_value"]),
        cell(row.cells, ["long_value", "com.samsung.health.user_profile.long_value"]),
      ].filter((value): value is string => value != null);
      let parsed: string | null = null;
      for (const candidate of candidates) {
        parsed = parseBirthValue(candidate);
        if (parsed) break;
      }
      if (!parsed) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable birth_date" });
        continue;
      }
      birthDate = parsed;
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { birthDate, errors };
}

function ensureDay(days: Map<string, SamsungDay>, date: string): SamsungDay {
  const existing = days.get(date);
  if (existing) return existing;
  const created: SamsungDay = { date, sourceIds: [] };
  days.set(date, created);
  return created;
}

function addSourceId(day: SamsungDay, sourceId: string | undefined): void {
  if (!sourceId || day.sourceIds.includes(sourceId)) return;
  day.sourceIds.push(sourceId);
}

function assignWeight(day: SamsungDay, win: WeightWin): void {
  day.weightLb = win.weightLb;
  if (win.bodyFatPercent != null) day.bodyFatPercent = win.bodyFatPercent;
  else delete day.bodyFatPercent;
  if (win.fatMassLb != null) day.fatMassLb = win.fatMassLb;
  else delete day.fatMassLb;
  if (win.skeletalMuscleLb != null) day.skeletalMuscleLb = win.skeletalMuscleLb;
  else delete day.skeletalMuscleLb;
  if (win.bodyWaterLb != null) day.bodyWaterLb = win.bodyWaterLb;
  else delete day.bodyWaterLb;
  day.original = win.original;
  addSourceId(day, win.sourceId);
}

function publicWorkout(workout: InternalWorkout): SamsungWorkout {
  return {
    sourceId: workout.sourceId,
    startedAt: workout.startedAt,
    exerciseType: workout.exerciseType,
    durationMin: workout.durationMin,
    distanceMi: workout.distanceMi,
    calories: workout.calories,
    meanSpeedMph: workout.meanSpeedMph,
    maxSpeedMph: workout.maxSpeedMph,
    meanHr: workout.meanHr,
    maxHr: workout.maxHr,
    minHr: workout.minHr,
    meanCadence: workout.meanCadence,
    payload: workout.payload,
  };
}

function attachLiveData(workouts: InternalWorkout[], files: LoadedFile[], errors: ImportError[]): void {
  for (const file of files) {
    if (file.dataset !== "liveData") continue;
    const text = file.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      errors.push({ file: file.name, row: null, message: "malformed live data JSON" });
      continue;
    }
    if (!Array.isArray(parsed)) {
      errors.push({ file: file.name, row: null, message: "live data is not a JSON array" });
      continue;
    }
    const samples: Record<string, unknown>[] = [];
    parsed.forEach((sample, index) => {
      if (!sample || typeof sample !== "object" || Array.isArray(sample)) return;
      const record = sample as Record<string, unknown>;
      const start = capPrimitive(Object.prototype.hasOwnProperty.call(record, "start_time") ? record.start_time : null);
      const heart = capHeartRate(Object.prototype.hasOwnProperty.call(record, "heart_rate") ? record.heart_rate : null);
      if (start.truncated || heart.truncated) {
        errors.push({ file: file.name, row: index + 1, message: "field truncated" });
      }
      samples.push({ start_time: start.value, heart_rate: heart.value });
    });
    const base = basename(file.name).toLowerCase();
    const matches = workouts.filter((workout) => base.startsWith(workout.sourceId.toLowerCase()));
    if (!matches.length) continue;
    const maxLength = matches.reduce((max, workout) => Math.max(max, workout.sourceId.length), 0);
    for (const workout of matches) {
      if (workout.sourceId.length !== maxLength) continue;
      workout.payload = { ...workout.payload, heartRateSamples: samples.map((sample) => ({ ...sample })) };
    }
  }
}

function rowsFor(files: LoadedFile[], dataset: SamsungDataset): RawRow[] {
  const rows: RawRow[] = [];
  for (const file of files) {
    if (file.dataset === dataset) rows.push(...file.rows);
  }
  return rows;
}

function buildDraft(files: LoadedFile[], extraErrors: ImportError[]): SamsungImportDraft {
  const draft = emptyDraft();
  for (const file of files) {
    draft.discovered.push({
      name: file.name,
      dataset: file.dataset,
      supported: file.dataset != null,
    });
    if (file.dataset == null) draft.unsupported.push(file.name);
    draft.errors.push(...file.errors);
  }
  draft.errors.push(...extraErrors);

  const weight = reduceWeight(rowsFor(files, "weight"));
  const steps = reduceSteps(rowsFor(files, "steps"));
  const nutrition = reduceNutrition(rowsFor(files, "nutrition"));
  const combinedRows = rowsFor(files, "sleepCombined");
  const sleep = sleepHoursFromRows(combinedRows.length ? combinedRows : rowsFor(files, "sleep"), combinedRows.length ? "last" : "sum");
  const calories = reduceCalories(rowsFor(files, "caloriesBurned"));
  const summary = reduceDaySummary(rowsFor(files, "daySummary"));
  const profile = reduceProfile(rowsFor(files, "userProfile"));
  draft.errors.push(
    ...weight.errors,
    ...steps.errors,
    ...nutrition.errors,
    ...sleep.errors,
    ...calories.errors,
    ...summary.errors,
    ...profile.errors,
  );
  draft.profile.birthDate = profile.birthDate;

  const workouts: InternalWorkout[] = [];
  const seen = new Map<string, InternalWorkout>();
  for (const file of files) {
    if (file.dataset !== "exercise") continue;
    const reduced = reduceExercise(file.rows);
    draft.errors.push(...reduced.errors);
    draft.duplicatesSkipped += reduced.duplicatesSkipped;
    for (const workout of reduced.workouts) {
      if (seen.has(workout.sourceId)) {
        draft.duplicatesSkipped += 1;
        const index = workouts.findIndex((item) => item.sourceId === workout.sourceId);
        if (index >= 0) workouts[index] = workout;
      } else {
        workouts.push(workout);
      }
      seen.set(workout.sourceId, workout);
    }
  }
  attachLiveData(workouts, files, draft.errors);

  const days = new Map<string, SamsungDay>();
  for (const win of weight.wins) assignWeight(ensureDay(days, win.date), win);
  for (const step of steps.days) ensureDay(days, step.date).steps = step.steps;
  for (const meal of nutrition.days) {
    const day = ensureDay(days, meal.date);
    if (meal.calories != null) day.calories = meal.calories;
    if (meal.proteinG != null) day.proteinG = meal.proteinG;
    if (meal.carbG != null) day.carbG = meal.carbG;
    if (meal.fatG != null) day.fatG = meal.fatG;
    if (meal.fiberG != null) day.fiberG = meal.fiberG;
    if (meal.sodiumMg != null) day.sodiumMg = meal.sodiumMg;
  }
  for (const night of sleep.days) ensureDay(days, night.date).sleepHours = night.sleepHours;
  for (const burned of calories.days) {
    const day = ensureDay(days, burned.date);
    if (burned.bmr != null) day.bmr = burned.bmr;
    if (burned.activeCalories != null) day.activeCalories = burned.activeCalories;
    if (burned.burnedCalories != null) day.burnedCalories = burned.burnedCalories;
  }

  const exerciseByDate = new Map<string, InternalWorkout[]>();
  for (const workout of workouts) {
    const list = exerciseByDate.get(workout.date) ?? [];
    list.push(workout);
    exerciseByDate.set(workout.date, list);
  }
  for (const [date, sessions] of exerciseByDate) {
    const day = ensureDay(days, date);
    let minutes = 0;
    let caloriesSum = 0;
    let sawDuration = false;
    let sawCalories = false;
    let resistance = false;
    for (const session of sessions) {
      addSourceId(day, session.sourceId);
      if (session.durationMin != null) {
        minutes += session.durationMin;
        sawDuration = true;
      }
      if (session.calories != null) {
        caloriesSum += session.calories;
        sawCalories = true;
      }
      if (session.exerciseType === RESISTANCE_EXERCISE_TYPE) resistance = true;
    }
    if (sawDuration) day.workoutMinutes = minutes;
    if (sawCalories) day.exerciseCalories = caloriesSum;
    day.resistanceTraining = resistance;
  }

  for (const fill of summary.days) {
    const useful =
      fill.walkMinutes != null || fill.steps != null || fill.activeCalories != null || fill.workoutMinutes != null;
    if (!useful) continue;
    const day = ensureDay(days, fill.date);
    if (fill.walkMinutes != null) day.walkMinutes = fill.walkMinutes;
    if (fill.steps != null && day.steps == null) day.steps = fill.steps;
    if (fill.activeCalories != null && day.activeCalories == null) day.activeCalories = fill.activeCalories;
    if (fill.workoutMinutes != null) {
      day.workoutMinutes = day.workoutMinutes != null ? Math.max(day.workoutMinutes, fill.workoutMinutes) : fill.workoutMinutes;
    }
  }

  draft.days = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  draft.workouts = workouts
    .slice()
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.sourceId.localeCompare(b.sourceId)))
    .map(publicWorkout);
  return draft;
}

function asRecords(rows: readonly object[]): Record<string, unknown>[] {
  return rows.map((row) => ({ ...row }) as Record<string, unknown>);
}

function recordsForDataset(dataset: SamsungDataset, rows: RawRow[]): { records: Record<string, unknown>[]; errors: ImportError[]; duplicatesSkipped: number } {
  switch (dataset) {
    case "weight": {
      const reduced = reduceWeight(rows);
      return { records: asRecords(reduced.wins), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "steps": {
      const reduced = reduceSteps(rows);
      return { records: asRecords(reduced.days), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "nutrition": {
      const reduced = reduceNutrition(rows);
      return { records: asRecords(reduced.days), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "sleepCombined":
    case "sleep": {
      const reduced = sleepHoursFromRows(rows, dataset === "sleepCombined" ? "last" : "sum");
      return { records: asRecords(reduced.days), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "exercise": {
      const reduced = reduceExercise(rows);
      return {
        records: asRecords(reduced.workouts.map((workout) => publicWorkout(workout))),
        errors: reduced.errors,
        duplicatesSkipped: reduced.duplicatesSkipped,
      };
    }
    case "caloriesBurned": {
      const reduced = reduceCalories(rows);
      return { records: asRecords(reduced.days), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "daySummary": {
      const reduced = reduceDaySummary(rows);
      return { records: asRecords(reduced.days), errors: reduced.errors, duplicatesSkipped: 0 };
    }
    case "userProfile": {
      const reduced = reduceProfile(rows);
      return {
        records: reduced.birthDate ? [{ birthDate: reduced.birthDate }] : [],
        errors: reduced.errors,
        duplicatesSkipped: 0,
      };
    }
    case "liveData":
      return { records: [], errors: [], duplicatesSkipped: 0 };
    default:
      return { records: [], errors: [], duplicatesSkipped: 0 };
  }
}

export function parseSamsungCsv(
  dataset: SamsungDataset,
  csvText: string,
): { records: Record<string, unknown>[]; errors: ImportError[] } {
  if (dataset === "liveData") {
    try {
      const parsed: unknown = JSON.parse(csvText);
      if (!Array.isArray(parsed)) {
        return { records: [], errors: [{ file: "liveData", row: null, message: "live data is not a JSON array" }] };
      }
      return { records: parsed.filter((item) => item && typeof item === "object") as Record<string, unknown>[], errors: [] };
    } catch {
      return { records: [], errors: [{ file: "liveData", row: null, message: "malformed live data JSON" }] };
    }
  }
  const table = parseCsvText(csvText, dataset);
  const reduced = recordsForDataset(dataset, table.rows);
  return { records: reduced.records, errors: [...table.errors, ...reduced.errors] };
}

function loadTextFile(file: { name: string; text?: string; bytes?: Buffer }): LoadedFile {
  const dataset = datasetFromFilename(file.name);
  const text = file.text ?? (file.bytes ? file.bytes.toString("utf8") : "");
  if (dataset == null) return { name: file.name, dataset: null, rows: [], errors: [], text };
  if (dataset === "liveData") return { name: file.name, dataset, rows: [], errors: [], text };
  const parsed = parseCsvText(text, file.name);
  return { name: file.name, dataset, rows: parsed.rows, errors: parsed.errors, text };
}

export async function parseSamsungFiles(
  files: { name: string; text?: string; bytes?: Buffer }[],
): Promise<SamsungImportDraft> {
  const loaded: LoadedFile[] = [];
  for (const file of files) loaded.push(loadTextFile(file));
  return buildDraft(loaded, []);
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function loadZipEntry(entry: Entry, stream: Readable): Promise<LoadedFile> {
  const name = decodeEntryName(entry);
  const dataset = datasetFromFilename(name);
  if (dataset == null || dataset === "liveData" || !/\.csv$/i.test(basename(name))) {
    const bytes = await readStream(stream);
    const text = bytes.toString("utf8");
    if (dataset == null || dataset === "liveData") {
      return { name, dataset, rows: [], errors: [], text };
    }
    const parsed = parseCsvText(text, name);
    return { name, dataset, rows: parsed.rows, errors: parsed.errors, text };
  }
  const parsed = await parseCsvReadable(stream, name);
  return { name, dataset, rows: parsed.rows, errors: parsed.errors };
}

export const MAX_ZIP_ENTRIES = 2_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1_000_000_000;
export const ZIP_TOO_MANY_ENTRIES = "zip has too many entries";
export const ZIP_UNCOMPRESSED_TOO_LARGE = "zip uncompressed size exceeds the limit";

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 65_535);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

/** Read central-directory headers only, before yauzl inflates anything. */
function zipLimitError(buffer: Buffer): string | null {
  const eocd = findEocd(buffer);
  if (eocd < 0 || eocd + 22 > buffer.length) return null;
  const declared = buffer.readUInt16LE(eocd + 10);
  if (declared !== 0xffff && declared > MAX_ZIP_ENTRIES) return ZIP_TOO_MANY_ENTRIES;
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset > buffer.length || cdSize > buffer.length - cdOffset) return null;
  let offset = cdOffset;
  const end = cdOffset + cdSize;
  let count = 0;
  let uncompressed = 0;
  while (offset + 46 <= end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    count += 1;
    const size = buffer.readUInt32LE(offset + 24);
    uncompressed += size === 0xffffffff ? MAX_ZIP_UNCOMPRESSED_BYTES + 1 : size;
    if (count > MAX_ZIP_ENTRIES) return ZIP_TOO_MANY_ENTRIES;
    if (uncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) return ZIP_UNCOMPRESSED_TOO_LARGE;
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export function parseSamsungZip(buffer: Buffer): Promise<SamsungImportDraft> {
  const limit = zipLimitError(buffer);
  if (limit) {
    const draft = emptyDraft();
    draft.errors.push({ file: "", row: null, message: limit });
    return Promise.resolve(draft);
  }
  return parseSamsungZipEntries(buffer);
}

function parseSamsungZipEntries(buffer: Buffer): Promise<SamsungImportDraft> {
  return new Promise((resolve) => {
    // decodeStrings is off so yauzl does not abort the archive on a ".." entry name.
    yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) {
        const draft = emptyDraft();
        draft.errors.push({ file: "", row: null, message: err?.message ?? "invalid zip" });
        resolve(draft);
        return;
      }
      const loaded: LoadedFile[] = [];
      const extraErrors: ImportError[] = [];
      let settled = false;
      let entryCount = 0;
      let uncompressedBytes = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        zip.close();
        try {
          resolve(buildDraft(loaded, extraErrors));
        } catch (buildErr) {
          const draft = emptyDraft();
          draft.errors.push({
            file: "",
            row: null,
            message: buildErr instanceof Error ? buildErr.message : String(buildErr),
          });
          resolve(draft);
        }
      };
      const next = () => {
        if (!settled) zip.readEntry();
      };
      zip.on("error", (zipErr: Error) => {
        const message = zipErr.message ?? "";
        if (message.includes("..") || /invalid relative path|absolute path/i.test(message)) {
          extraErrors.push({ file: "unsafe", row: null, message: "rejected unsafe path" });
        } else if (/size mismatch/i.test(message) && [...message.matchAll(/\d+/g)].some((match) => Number(match[0]) > MAX_ZIP_UNCOMPRESSED_BYTES)) {
          extraErrors.push({ file: "", row: null, message: ZIP_UNCOMPRESSED_TOO_LARGE });
        } else {
          extraErrors.push({ file: "", row: null, message: message });
        }
        finish();
      });
      zip.on("end", () => finish());
      zip.on("entry", (entry: Entry) => {
        const name = decodeEntryName(entry);
        if (isUnsafeZipPath(name)) {
          extraErrors.push({ file: "unsafe", row: null, message: "rejected unsafe path" });
          next();
          return;
        }
        if (name.endsWith("/")) {
          next();
          return;
        }
        entryCount += 1;
        uncompressedBytes += Number(entry.uncompressedSize) || 0;
        if (entryCount > MAX_ZIP_ENTRIES || uncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
          extraErrors.push({
            file: "",
            row: null,
            message: entryCount > MAX_ZIP_ENTRIES ? ZIP_TOO_MANY_ENTRIES : ZIP_UNCOMPRESSED_TOO_LARGE,
          });
          loaded.length = 0;
          finish();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            extraErrors.push({
              file: name,
              row: null,
              message: streamErr?.message ?? "unreadable zip entry",
            });
            next();
            return;
          }
          loadZipEntry(entry, stream)
            .then((file) => {
              loaded.push(file);
              next();
            })
            .catch((readErr: unknown) => {
              extraErrors.push({
                file: name,
                row: null,
                message: readErr instanceof Error ? readErr.message : String(readErr),
              });
              next();
            });
        });
      });
      zip.readEntry();
    });
  });
}
