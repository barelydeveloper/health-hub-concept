import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parse as parseCsvStream } from "csv-parse";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { Options } from "csv-parse";
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

function csvOptions(onSkip: (err: CsvSkipError) => void): Options {
  return {
    columns: true,
    from_line: 2,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    info: true,
    skip_records_with_error: true,
    max_record_size: 5_000_000,
    on_skip: onSkip,
  } as Options;
}

function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let text = raw.trim();
  if (text.startsWith("'")) text = text.slice(1).trim();
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
  const text = ts.trim();
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
  const text = ts.trim();
  if (!text) return null;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const zoned = new Date(text.includes("T") ? text : text.replace(" ", "T"));
    return Number.isNaN(zoned.getTime()) ? null : zoned.toISOString();
  }
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?))?/.exec(text);
  if (match && isRealDate(match[1])) {
    const time = match[2] ?? "00:00:00";
    const date = new Date(`${match[1]}T${time}Z`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return `${match[1]}T00:00:00.000Z`;
  }
  const epoch = parseFiniteNumber(text);
  if (epoch != null && Math.abs(epoch) > 1e11) {
    const date = new Date(epoch);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
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

function parseCsvText(csvText: string, file: string): { rows: RawRow[]; errors: ImportError[] } {
  const rows: RawRow[] = [];
  const errors: ImportError[] = [];
  try {
    const parsed: unknown = parseCsvSync(
      csvText,
      csvOptions((err) => {
        errors.push({
          file,
          row: typeof err.lines === "number" ? err.lines : null,
          message: err.message || "row skipped",
        });
      }),
    );
    if (Array.isArray(parsed)) {
      for (const item of parsed) pushNormalized(rows, errors, file, item);
    }
  } catch (err) {
    errors.push({
      file,
      row: null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { rows, errors };
}

async function parseCsvReadable(stream: Readable, file: string): Promise<{ rows: RawRow[]; errors: ImportError[] }> {
  const rows: RawRow[] = [];
  const errors: ImportError[] = [];
  const parser = parseCsvStream(
    csvOptions((err) => {
      errors.push({
        file,
        row: typeof err.lines === "number" ? err.lines : null,
        message: err.message || "row skipped",
      });
    }),
  );
  parser.on("data", (item: unknown) => {
    pushNormalized(rows, errors, file, item);
  });
  try {
    await pipeline(stream, parser);
  } catch (err) {
    errors.push({
      file,
      row: null,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return { rows, errors };
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
      const date = calendarDate(startRaw);
      if (!date || !startRaw) continue;
      const weightRaw = cell(row.cells, ["weight", "com.samsung.health.weight.weight"]);
      const kg = parseFiniteNumber(weightRaw);
      if (kg == null) continue;
      if (kg > 100) {
        errors.push({ file: row.file, row: row.line || null, message: "weight above 100 kg skipped" });
        continue;
      }
      const startTime = startRaw.trim();
      const prev = best.get(date);
      if (prev && startTime <= prev.startTime) continue;

      const bodyFatRaw = cell(row.cells, ["body_fat", "com.samsung.health.weight.body_fat"]);
      const fatMassRaw = cell(row.cells, ["body_fat_mass", "com.samsung.health.weight.body_fat_mass"]);
      const muscleRaw = cell(row.cells, ["skeletal_muscle_mass", "com.samsung.health.weight.skeletal_muscle_mass"]);
      const waterRaw = cell(row.cells, ["total_body_water", "com.samsung.health.weight.total_body_water"]);
      const bodyFat = parseFiniteNumber(bodyFatRaw);
      const fatMass = parseFiniteNumber(fatMassRaw);
      const muscle = parseFiniteNumber(muscleRaw);
      const water = parseFiniteNumber(waterRaw);
      const datauuid = cell(row.cells, ["datauuid", "com.samsung.health.weight.datauuid"]);
      const recordedAt = recordedAtFromTimestamp(startTime) ?? `${date}T00:00:00.000Z`;

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
      const date =
        calendarDate(cell(row.cells, ["day_time", "com.samsung.shealth.step_daily_trend.day_time"])) ??
        calendarDate(cell(row.cells, ["start_time", "com.samsung.shealth.step_daily_trend.start_time"]));
      if (!date) continue;
      const count = numericCell(row.cells, ["count", "com.samsung.shealth.step_daily_trend.count"]);
      if (count == null) continue;
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
    { calories: number; proteinG: number; carbG: number; fiberG: number; fatG: number; sodiumMg: number; any: boolean }
  >();
  for (const row of rows) {
    try {
      const startRaw = cell(row.cells, ["start_time", "com.samsung.health.nutrition.start_time"]);
      const date = calendarDate(startRaw);
      if (!date) {
        errors.push({ file: row.file, row: row.line || null, message: "unparseable date" });
        continue;
      }
      const calories = numericCell(row.cells, ["calorie", "com.samsung.health.nutrition.calorie"]);
      const protein = numericCell(row.cells, ["protein", "com.samsung.health.nutrition.protein"]);
      const carbs = numericCell(row.cells, ["carbohydrate", "com.samsung.health.nutrition.carbohydrate"]);
      const fiber = numericCell(row.cells, ["dietary_fiber", "com.samsung.health.nutrition.dietary_fiber"]);
      const fat = numericCell(row.cells, ["total_fat", "com.samsung.health.nutrition.total_fat"]);
      const sodium = numericCell(row.cells, ["sodium", "com.samsung.health.nutrition.sodium"]);
      if (calories == null && protein == null && carbs == null && fiber == null && fat == null && sodium == null) {
        continue;
      }
      const bucket = acc.get(date) ?? {
        calories: 0,
        proteinG: 0,
        carbG: 0,
        fiberG: 0,
        fatG: 0,
        sodiumMg: 0,
        any: false,
      };
      if (calories != null) {
        bucket.calories += calories;
        bucket.any = true;
      }
      if (protein != null) {
        bucket.proteinG += protein;
        bucket.any = true;
      }
      if (carbs != null) {
        bucket.carbG += carbs;
        bucket.any = true;
      }
      if (fiber != null) {
        bucket.fiberG += fiber;
        bucket.any = true;
      }
      if (fat != null) {
        bucket.fatG += fat;
        bucket.any = true;
      }
      if (sodium != null) {
        bucket.sodiumMg += sodium;
        bucket.any = true;
      }
      acc.set(date, bucket);
    } catch (err) {
      errors.push({
        file: row.file,
        row: row.line || null,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const days = [...acc.entries()].filter(([, bucket]) => bucket.any).map(([date, bucket]) => {
    const day: {
      date: string;
      calories?: number;
      proteinG?: number;
      carbG?: number;
      fiberG?: number;
      fatG?: number;
      sodiumMg?: number;
    } = { date };
    day.calories = bucket.calories;
    day.proteinG = bucket.proteinG;
    day.carbG = bucket.carbG;
    day.fiberG = bucket.fiberG;
    day.fatG = bucket.fatG;
    day.sodiumMg = bucket.sodiumMg;
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
        const date =
          calendarDate(cell(row.cells, ["end_time", "com.samsung.shealth.sleep_combined.end_time", "com.samsung.shealth.sleep.end_time"])) ??
          calendarDate(cell(row.cells, ["start_time", "com.samsung.shealth.sleep_combined.start_time", "com.samsung.shealth.sleep.start_time"]));
        if (!date) continue;
        const minutes = numericCell(row.cells, [
          "sleep_duration",
          "com.samsung.shealth.sleep_combined.sleep_duration",
          "com.samsung.shealth.sleep.sleep_duration",
        ]);
        if (minutes == null) continue;
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
      const date =
        calendarDate(cell(row.cells, ["end_time", "com.samsung.shealth.sleep.end_time"])) ??
        calendarDate(cell(row.cells, ["start_time", "com.samsung.shealth.sleep.start_time"]));
      if (!date) continue;
      const minutes = numericCell(row.cells, ["sleep_duration", "com.samsung.shealth.sleep.sleep_duration"]);
      if (minutes == null) continue;
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
      if (prev && update <= prev.update) continue;
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
      if (prev && update <= prev.update) continue;
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
    day.calories = meal.calories;
    day.proteinG = meal.proteinG;
    day.carbG = meal.carbG;
    day.fatG = meal.fatG;
    day.fiberG = meal.fiberG;
    day.sodiumMg = meal.sodiumMg;
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
    let sawCalories = false;
    let resistance = false;
    for (const session of sessions) {
      addSourceId(day, session.sourceId);
      if (session.durationMin != null) minutes += session.durationMin;
      if (session.calories != null) {
        caloriesSum += session.calories;
        sawCalories = true;
      }
      if (session.exerciseType === RESISTANCE_EXERCISE_TYPE) resistance = true;
    }
    day.workoutMinutes = minutes;
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

export function parseSamsungZip(buffer: Buffer): Promise<SamsungImportDraft> {
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
