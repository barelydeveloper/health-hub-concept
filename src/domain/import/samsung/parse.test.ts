import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { planImportMerge } from "../merge";
import { UNSUPPORTED_ADAPTERS, selectAdapter } from "../registry";
import { activityStoredFields, hasStoredActivity, hasStoredNutrition, nutritionStoredFields, scaleImportedNumber } from "../scale";
import { KG_TO_LB, M_TO_MI, MS_TO_MPH, MAX_ZIP_UNCOMPRESSED_BYTES, ZIP_TOO_MANY_ENTRIES, ZIP_UNCOMPRESSED_TOO_LARGE, parseSamsungCsv, parseSamsungFiles, parseSamsungZip } from "./parse";

const fixtureDir = path.resolve(process.cwd(), "fixtures/samsung");

function fixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0);
  return buf;
}

/** Minimal uncompressed ZIP. Entry names are stored as written, including unsafe paths. */
function zipStored(entries: { name: string; data: Buffer; uncompressedSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const uncompressed = entry.uncompressedSize ?? entry.data.length;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

describe("samsung weight", () => {
  it("keeps eight stable paired days for a hydration-context fixture", async () => {
    const draft = await parseSamsungFiles([{ name: "com.samsung.health.weight.csv", text: fixture("weight_hydration.csv") }]);
    expect(draft.errors).toEqual([]);
    expect(draft.days).toHaveLength(8);
    expect(draft.days.every((day) => day.weightLb != null && day.bodyWaterLb != null && day.bodyFatPercent === 19)).toBe(true);
    const water = new Set(draft.days.map((day) => day.bodyWaterLb));
    expect(water.size).toBe(1);
  });

  it("converts kg to lb, keeps the later timestamp, and skips weight above 100 kg", async () => {
    const text = fixture("weight.csv");
    const name = "com.samsung.health.weight.20260601123000.csv";
    const parsed = parseSamsungCsv("weight", text);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.weightLb).toBe(69.127 * KG_TO_LB);
    expect(parsed.records[0]?.bodyFatPercent).toBe(20.5);
    expect(parsed.errors.some((error) => error.message === "weight above 100 kg skipped")).toBe(true);

    const draft = await parseSamsungFiles([{ name, text }]);
    expect(draft.days).toHaveLength(1);
    const day = draft.days[0];
    expect(day?.date).toBe("2026-06-01");
    expect(day?.weightLb).toBe(69.127 * KG_TO_LB);
    expect(day?.weightLb).not.toBe(68 * KG_TO_LB);
    expect(day?.weightLb).not.toBe(150 * KG_TO_LB);
    expect(day?.bodyFatPercent).toBe(20.5);
    expect(day?.fatMassLb).toBe(14.2 * KG_TO_LB);
    expect(day?.skeletalMuscleLb).toBe(30.1 * KG_TO_LB);
    expect(day?.skeletalMuscleLb).not.toBe(41 * KG_TO_LB);
    expect(day?.bodyWaterLb).toBe(40 * KG_TO_LB);
    expect(day?.sourceIds).toEqual(["win-uuid"]);
    expect(day?.original).toMatchObject({
      recordedAt: "2026-06-01T09:30:00.000Z",
      weightKg: 69.127,
      weight: { originalValue: 69.127, originalUnit: "kg" },
      bodyFat: { originalValue: 20.5, originalUnit: "%" },
      fatMass: { originalValue: 14.2, originalUnit: "kg" },
      skeletalMuscle: { originalValue: 30.1, originalUnit: "kg" },
      bodyWater: { originalValue: 40, originalUnit: "kg" },
    });
    expect(draft.errors).toContainEqual({
      file: name,
      row: 6,
      message: "weight above 100 kg skipped",
    });
    expect(draft.discovered).toContainEqual({ name, dataset: "weight", supported: true });
  });
});

describe("samsung steps", () => {
  it("ignores source_type 0 and keeps the last -2 row per day", async () => {
    const draft = await parseSamsungFiles([
      { name: "com.samsung.shealth.step_daily_trend.20260601120000.csv", text: fixture("steps.csv") },
    ]);
    const byDate = new Map(draft.days.map((day) => [day.date, day.steps]));
    expect(byDate.get("2026-06-01")).toBe(2222);
    expect(byDate.get("2026-06-02")).toBe(3333);
    expect(draft.days.some((day) => day.steps === 9999)).toBe(false);
    expect(draft.errors).toEqual([]);
  });
});

describe("samsung nutrition", () => {
  it("sums foods on one day and keeps that day when another row has a bad date", async () => {
    const draft = await parseSamsungFiles([
      { name: "com.samsung.health.nutrition.20260603120000.csv", text: fixture("nutrition.csv") },
    ]);
    expect(draft.days).toHaveLength(1);
    expect(draft.days[0]).toMatchObject({
      date: "2026-06-03",
      calories: 100.5 + 50.25,
      proteinG: 10.5 + 1.25,
      carbG: 20.25 + 1.5,
      fiberG: 0.5 + 0.25,
      fatG: 5.5 + 1.25,
      sodiumMg: 100.5 + 10.25,
    });
    expect(draft.days[0]?.calories).not.toBe(150.75 + 999);
    expect(draft.errors.some((error) => error.message === "unparseable date" && error.row != null)).toBe(true);
  });
});

describe("samsung exercise", () => {
  it("converts distance, keeps the last duplicate uuid, and marks resistance training", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.exercise.20260605120000.csv",
        text: fixture("exercise.csv"),
      },
    ]);
    expect(draft.duplicatesSkipped).toBe(1);
    expect(draft.workouts).toHaveLength(2);
    const walk = draft.workouts.find((workout) => workout.sourceId === "walk-uuid");
    const lift = draft.workouts.find((workout) => workout.sourceId === "lift-uuid");
    expect(walk).toMatchObject({
      exerciseType: 1001,
      startedAt: "2026-06-05T10:00:00.000Z",
      durationMin: 1800000 / 60000,
      distanceMi: 1609.344 * M_TO_MI,
      calories: 220,
      meanSpeedMph: 1.5 * MS_TO_MPH,
      maxSpeedMph: 3 * MS_TO_MPH,
      meanHr: 140,
      maxHr: 180,
      minHr: 90,
      meanCadence: 170,
    });
    expect(walk?.distanceMi).not.toBe(100 * M_TO_MI);
    expect(walk?.calories).not.toBe(50);
    expect(lift?.exerciseType).toBe(15004);
    expect(lift?.durationMin).toBe(60);
    const day = draft.days.find((item) => item.date === "2026-06-05");
    expect(day?.workoutMinutes).toBe(90);
    expect(day?.exerciseCalories).toBe(520);
    expect(day?.resistanceTraining).toBe(true);
    expect(day?.sourceIds).toEqual(["walk-uuid", "lift-uuid"]);
  });
});

describe("samsung unsupported files", () => {
  it("lists unrecognized names and does not invent days", async () => {
    const draft = await parseSamsungFiles([
      { name: "unsupported.txt", text: fixture("unsupported.txt") },
      {
        name: "com.samsung.shealth.exercise.periodization.csv",
        text: fixture("exercise.csv"),
      },
    ]);
    expect(draft.unsupported).toEqual(["unsupported.txt", "com.samsung.shealth.exercise.periodization.csv"]);
    expect(draft.days).toEqual([]);
    expect(draft.workouts).toEqual([]);
    expect(draft.discovered).toContainEqual({
      name: "com.samsung.shealth.exercise.periodization.csv",
      dataset: null,
      supported: false,
    });
  });
});

describe("samsung zip", () => {
  it("rejects an unsafe path and still imports a sibling weight csv", async () => {
    const evil = Buffer.from(
      "EVILMARKER\nstart_time,weight\n2026-06-01 12:00:00,55\n",
      "utf8",
    );
    const archive = zipStored([
      { name: "../evil.csv", data: evil },
      { name: "com.samsung.health.weight.csv", data: Buffer.from(fixture("weight.csv"), "utf8") },
    ]);
    const draft = await parseSamsungZip(archive);
    expect(draft.errors.some((error) => error.message === "rejected unsafe path")).toBe(true);
    expect(draft.days).toHaveLength(1);
    expect(draft.days[0]?.weightLb).toBe(69.127 * KG_TO_LB);
    expect(draft.days.some((day) => day.weightLb === 55 * KG_TO_LB)).toBe(false);
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain("EVILMARKER");
    expect(serialized).not.toContain("../evil.csv");
    expect(draft.discovered.some((file) => file.name.includes(".."))).toBe(false);
    expect(draft.unsupported.some((name) => name.includes(".."))).toBe(false);
  });

  it("rejects an archive with more than 2000 entries before inflating", async () => {
    const archive = zipStored(Array.from({ length: 2001 }, (_, index) => ({
      name: `notes/file-${index}.txt`,
      data: Buffer.from("x"),
    })));
    const draft = await parseSamsungZip(archive);
    expect(draft.errors.some((error) => error.message === ZIP_TOO_MANY_ENTRIES)).toBe(true);
    expect(draft.days).toEqual([]);
    expect(draft.discovered).toEqual([]);
  });

  it("rejects an uncompressed-size bomb before inflating", async () => {
    const archive = zipStored([{
      name: "com.samsung.health.weight.csv",
      data: Buffer.from("x"),
      uncompressedSize: MAX_ZIP_UNCOMPRESSED_BYTES + 1,
    }]);
    const draft = await parseSamsungZip(archive);
    expect(draft.errors.some((error) => error.message === ZIP_UNCOMPRESSED_TOO_LARGE)).toBe(true);
    expect(draft.days).toEqual([]);
  });
});

describe("formula cells", () => {
  it("does not evaluate =1+1 into 2", async () => {
    const weight = [
      "com.samsung.health.weight",
      "start_time,weight,body_fat,body_fat_mass",
      "2026-06-01 08:00:00,70,=1+1,10",
      "2026-06-02 08:00:00,=1+1,20,10",
      "2026-06-03 08:00:00,'71.5,18,12",
    ].join("\n");
    const steps = ["step", "source_type,day_time,count", "-2,2026-08-01,10", "-2,2026-08-01,=1+1"].join("\n");
    const draft = await parseSamsungFiles([
      { name: "com.samsung.health.weight.csv", text: weight },
      { name: "com.samsung.shealth.step_daily_trend.csv", text: steps },
    ]);
    const kept = draft.days.find((day) => day.date === "2026-06-01");
    expect(kept?.weightLb).toBe(70 * KG_TO_LB);
    expect(kept?.bodyFatPercent).toBeUndefined();
    expect(kept?.fatMassLb).toBe(10 * KG_TO_LB);
    expect(kept?.original).toMatchObject({
      bodyFat: { originalValue: "=1+1", originalUnit: "%" },
    });
    const payload = (kept?.original?.payload ?? {}) as Record<string, unknown>;
    expect(payload.body_fat).toBe("=1+1");
    expect(draft.days.find((day) => day.date === "2026-06-02")).toBeUndefined();
    expect(draft.days.find((day) => day.date === "2026-06-03")?.weightLb).toBe(71.5 * KG_TO_LB);
    expect(draft.days.find((day) => day.date === "2026-08-01")?.steps).toBe(10);
    expect(draft.days.some((day) => day.weightLb === 2 || day.bodyFatPercent === 2 || day.steps === 2)).toBe(false);
  });
});

describe("large step files", () => {
  it("parses 3000 step rows into one value per distinct day", async () => {
    const lines = ["step_daily_trend", "source_type,day_time,count"];
    for (let day = 0; day < 100; day += 1) {
      const date = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
      for (let row = 0; row < 30; row += 1) {
        const source = row === 0 ? "0" : "-2";
        lines.push(`${source},${date},${day * 100 + row}`);
      }
    }
    expect(lines.length - 2).toBe(3000);
    const draft = await parseSamsungFiles([
      { name: "com.samsung.shealth.step_daily_trend.csv", text: lines.join("\n") },
    ]);
    expect(draft.days).toHaveLength(100);
    for (let day = 0; day < 100; day += 1) {
      const date = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
      expect(draft.days.find((item) => item.date === date)?.steps).toBe(day * 100 + 29);
    }
  });
});

describe("import merge", () => {
  it("skips unchanged rows, revises imports, keeps user corrections, and inserts the rest", () => {
    const incoming = [
      { sourceSystem: "samsung_health", sourceId: "same", contentHash: "h1" },
      { sourceSystem: "samsung_health", sourceId: "changed", contentHash: "h2" },
      { sourceSystem: "samsung_health", sourceId: "corrected", contentHash: "h3" },
      { sourceSystem: "samsung_health", sourceId: "new", contentHash: "h4" },
      { sourceSystem: "samsung_health", sourceId: "measured", contentHash: "h5" },
      { sourceSystem: "samsung_health", sourceId: "fixture", contentHash: "h6" },
      { sourceSystem: "samsung_health", sourceId: "estimated", contentHash: "h7" },
    ];
    const plan = planImportMerge(
      [
        {
          sourceSystem: "samsung_health",
          sourceId: "same",
          contentHash: "h1",
          valueOrigin: "imported",
          superseded: false,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "changed",
          contentHash: "old",
          valueOrigin: "imported",
          superseded: false,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "corrected",
          contentHash: "old",
          valueOrigin: "user_entered",
          superseded: false,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "new",
          contentHash: "gone",
          valueOrigin: "imported",
          superseded: true,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "measured",
          contentHash: "old",
          valueOrigin: "measured",
          superseded: false,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "fixture",
          contentHash: "old",
          valueOrigin: "fixture",
          superseded: false,
        },
        {
          sourceSystem: "samsung_health",
          sourceId: "estimated",
          contentHash: "old",
          valueOrigin: "estimated",
          superseded: false,
        },
      ],
      incoming,
    );
    expect(plan.skipUnchanged.map((row) => row.sourceId)).toEqual(["same"]);
    expect(plan.revise.map((row) => row.sourceId)).toEqual(["changed", "fixture", "estimated"]);
    expect(plan.keepUserCorrection.map((row) => row.sourceId)).toEqual(["corrected", "measured"]);
    expect(plan.insert.map((row) => row.sourceId)).toEqual(["new"]);
  });
});

describe("adapter selection", () => {
  it("does not treat Apple Health or Vitruvian files as Samsung", async () => {
    expect(selectAdapter([{ name: "export.xml" }])).toBeNull();
    expect(selectAdapter([{ name: "apple_health/export.xml" }])).toBeNull();
    expect(selectAdapter([{ name: "vitruvian.json" }])).toBeNull();
    expect(selectAdapter([{ name: "backup/vitruvian/session.json" }])).toBeNull();
    expect(selectAdapter([{ name: "com.samsung.health.weight.csv" }])?.id).toBe("samsung_health");
    expect(UNSUPPORTED_ADAPTERS).toEqual(["apple_health", "vitruvian", "generic_csv"]);

    const apple = await parseSamsungFiles([{ name: "export.xml", text: "<HealthData/>" }]);
    const vitruvian = await parseSamsungFiles([{ name: "vitruvian.json", text: "{\"workouts\":[]}" }]);
    expect(apple.days).toEqual([]);
    expect(apple.workouts).toEqual([]);
    expect(apple.unsupported).toEqual(["export.xml"]);
    expect(vitruvian.days).toEqual([]);
    expect(vitruvian.unsupported).toEqual(["vitruvian.json"]);
  });
});

describe("samsung sleep, calories, profile, and live data", () => {
  it("uses the last combined sleep row and ignores raw sleep when combined rows exist", async () => {
    const draft = await parseSamsungFiles([
      { name: "com.samsung.shealth.sleep_combined.csv", text: fixture("sleep_combined.csv") },
      {
        name: "com.samsung.shealth.sleep.csv",
        text: ["sleep", "end_time,start_time,sleep_duration", "2026-06-04 08:00:00,2026-06-03 20:00:00,1440"].join("\n"),
      },
    ]);
    expect(draft.days).toEqual([{ date: "2026-06-04", sourceIds: [], sleepHours: 300 / 60 }]);
  });

  it("sums sleep sessions when no combined rows exist", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.sleep.csv",
        text: [
          "sleep",
          "end_time,start_time,sleep_duration",
          "2026-06-04 03:00:00,2026-06-03 23:00:00,60",
          "2026-06-04 06:00:00,2026-06-04 04:00:00,30",
        ].join("\n"),
      },
    ]);
    expect(draft.days[0]?.sleepHours).toBe(90 / 60);
  });

  it("fills day summary without overwriting steps, active calories, or a higher workout total", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.step_daily_trend.csv",
        text: ["steps", "source_type,day_time,count", "-2,2026-07-01,5000"].join("\n"),
      },
      {
        name: "com.samsung.shealth.calories_burned.details.csv",
        text: [
          "calories",
          "day_time,update_time,rest_calorie,active_calorie,tef_calorie",
          "2026-07-01,2026-07-01 01:00:00,1000,100,10",
          "2026-07-01,2026-07-01 05:00:00,1400,300,100",
        ].join("\n"),
      },
      {
        name: "com.samsung.shealth.exercise.csv",
        text: [
          "exercise",
          "datauuid,exercise_type,start_time,duration,distance,calorie",
          "day1,1001,2026-07-01 09:00:00,1800000,0,200",
          "day2,1002,2026-07-02 09:00:00,600000,100,40",
        ].join("\n"),
      },
      {
        name: "com.samsung.shealth.activity.day_summary.csv",
        text: [
          "summary",
          "day_time,update_time,step_count,calorie,exercise_time,walk_time",
          "2026-07-01,2026-07-01 01:00:00,99999,9999,9999999,0",
          "2026-07-01,2026-07-01 08:00:00,10,50,600000,120000",
          "2026-07-02,2026-07-02 08:00:00,10,50,2400000,120000",
        ].join("\n"),
      },
    ]);
    const day1 = draft.days.find((day) => day.date === "2026-07-01");
    const day2 = draft.days.find((day) => day.date === "2026-07-02");
    expect(day1).toMatchObject({
      steps: 5000,
      bmr: 1400,
      activeCalories: 300,
      burnedCalories: 1800,
      workoutMinutes: 30,
      exerciseCalories: 200,
      walkMinutes: 2,
      resistanceTraining: false,
    });
    expect(day2).toMatchObject({
      steps: 10,
      activeCalories: 50,
      workoutMinutes: 40,
      exerciseCalories: 40,
      walkMinutes: 2,
    });
  });

  it("reads birth_date from text or numeric profile values", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.health.user_profile.csv",
        text: [
          "profile",
          "key,text_value,int_value,long_value",
          "height,180,,",
          "birth_date,not-a-date,,",
          "birth_date,,19900131,",
          "birth_date,1992-02-29,,",
        ].join("\n"),
      },
    ]);
    expect(draft.profile.birthDate).toBe("1992-02-29");
    expect(draft.errors.some((error) => error.message === "unparseable birth_date")).toBe(true);
    expect(draft.days).toEqual([]);
  });

  it("attaches live heart-rate samples and continues after malformed JSON", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.exercise.csv",
        text: [
          "exercise",
          "datauuid,exercise_type,start_time,duration,distance,calorie",
          `${id},1001,2026-06-08 10:00:00,60000,50,80`,
        ].join("\n"),
      },
      {
        name: `${id}.com.samsung.health.exercise.live_data.json`,
        text: JSON.stringify([
          { start_time: 1, heart_rate: 120, extra: "ignored" },
          { start_time: 2, heart_rate: "=1+1" },
        ]),
      },
      {
        name: "22222222-2222-4222-8222-222222222222.com.samsung.health.exercise.live_data.json",
        text: "{not json",
      },
    ]);
    expect(draft.workouts).toHaveLength(1);
    expect(draft.workouts[0]?.payload.heartRateSamples).toEqual([
      { start_time: 1, heart_rate: 120 },
      { start_time: 2, heart_rate: "=1+1" },
    ]);
    expect(draft.errors.some((error) => error.row === null && error.message === "malformed live data JSON")).toBe(true);
    expect(JSON.stringify(draft.workouts[0]?.payload.heartRateSamples)).not.toContain("ignored");
  });

  it("accepts a header-only csv without throwing", async () => {
    const draft = await parseSamsungFiles([
      { name: "com.samsung.health.weight.csv", text: "com.samsung.health.weight\nstart_time,weight\n" },
      { name: "com.samsung.shealth.step_daily_trend.csv", text: "" },
    ]);
    expect(draft.days).toEqual([]);
    expect(draft.workouts).toEqual([]);
    expect(draft.discovered.every((file) => file.supported)).toBe(true);
  });
});

describe("samsung malformed rows and timestamps", () => {
  it("rejects invalid clocks and trailing garbage instead of storing midnight", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.exercise.csv",
        text: [
          "exercise",
          "datauuid,exercise_type,start_time,duration,distance,calorie",
          "bad-clock,1001,2026-06-05 99:99:99,60000,10,1",
          "bad-tail,1001,2026-06-06 garbage,60000,10,1",
          "ok,1001,2026-06-07 10:00:00,60000,10,1",
          "quoted,1001,'2026-06-08 10:00:00,60000,10,1",
          "offset,1001,2026-06-09 10:00:00-04:00,60000,10,1",
        ].join("\n"),
      },
    ]);
    expect(draft.workouts.map((workout) => workout.sourceId).sort()).toEqual(["offset", "ok", "quoted"]);
    expect(draft.workouts.find((workout) => workout.sourceId === "bad-clock")).toBeUndefined();
    expect(draft.workouts.find((workout) => workout.sourceId === "bad-tail")).toBeUndefined();
    expect(draft.workouts.find((workout) => workout.sourceId === "ok")?.startedAt).toBe("2026-06-07T10:00:00.000Z");
    expect(draft.workouts.find((workout) => workout.sourceId === "quoted")?.startedAt).toBe("2026-06-08T10:00:00.000Z");
    expect(draft.workouts.find((workout) => workout.sourceId === "offset")?.startedAt).toBe("2026-06-09T14:00:00.000Z");
    expect(draft.workouts.some((workout) => workout.startedAt.endsWith("T00:00:00.000Z"))).toBe(false);
    expect(draft.errors.filter((error) => error.message === "unparseable start_time")).toHaveLength(2);
  });

  it("keeps valid weight rows when other rows have a bad time or a bad number", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.health.weight.csv",
        text: [
          "weight",
          "start_time,weight,datauuid",
          "2026-06-01 99:99:99,70,bad-time",
          "2026-06-02 08:00:00,71,good",
          "2026-06-03 08:00:00,70.5 kg,bad-number",
          "not-a-date,72,bad-date",
          "2026-06-04 08:00:00,,missing",
        ].join("\n"),
      },
    ]);
    expect(draft.days.map((day) => day.date)).toEqual(["2026-06-02"]);
    expect(draft.days[0]?.weightLb).toBe(71 * KG_TO_LB);
    expect(draft.days[0]?.sourceIds).toEqual(["good"]);
    expect(draft.errors).toEqual([
      { file: "com.samsung.health.weight.csv", row: 3, message: "unparseable start_time" },
      { file: "com.samsung.health.weight.csv", row: 5, message: "unparseable weight" },
      { file: "com.samsung.health.weight.csv", row: 6, message: "unparseable start_time" },
      { file: "com.samsung.health.weight.csv", row: 7, message: "unparseable weight" },
    ]);
  });

  it("reports a steps aggregate row whose count is not a number and keeps the earlier value", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.step_daily_trend.csv",
        text: ["steps", "source_type,day_time,count", "-2,2026-08-01,10", "-2,2026-08-01,=1+1", "-2,2026-08-02,nope", "0,2026-08-02,9999"].join("\n"),
      },
    ]);
    expect(draft.days).toEqual([{ date: "2026-08-01", sourceIds: [], steps: 10 }]);
    expect(draft.errors.map((error) => error.message)).toEqual(["unparseable count", "unparseable count"]);
  });

  it("keeps a valid sleep session when another row has a bad duration", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.sleep.csv",
        text: [
          "sleep",
          "end_time,start_time,sleep_duration",
          "2026-06-04 06:00:00,2026-06-04 04:00:00,30",
          "2026-06-04 03:00:00,2026-06-03 23:00:00,nope",
        ].join("\n"),
      },
    ]);
    expect(draft.days[0]?.sleepHours).toBe(30 / 60);
    expect(draft.errors).toEqual([
      { file: "com.samsung.shealth.sleep.csv", row: 4, message: "unparseable sleep_duration" },
    ]);
  });

  it("sums valid nutrition cells when another cell on the row is not a number", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.health.nutrition.csv",
        text: ["nutrition", "start_time,calorie,protein", "2026-06-03 08:00:00,100,=1+1", "2026-06-03 13:00:00,50,4"].join("\n"),
      },
    ]);
    expect(draft.days[0]).toMatchObject({ date: "2026-06-03", calories: 150, proteinG: 4 });
    expect(draft.days[0]?.carbG).toBeUndefined();
    expect(draft.days[0]?.fatG).toBeUndefined();
    expect(draft.days[0]?.fiberG).toBeUndefined();
    expect(draft.days[0]?.sodiumMg).toBeUndefined();
    expect(draft.errors).toEqual([{ file: "com.samsung.health.nutrition.csv", row: 3, message: "unparseable number" }]);
  });

  it("does not fill absent nutrition columns with zero", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.health.nutrition.csv",
        text: ["nutrition", "start_time,dietary_fiber", "2026-06-03 08:00:00,4.5", "2026-06-04 08:00:00,0"].join("\n"),
      },
    ]);
    expect(draft.errors).toEqual([]);
    expect(draft.days).toEqual([
      { date: "2026-06-03", sourceIds: [], fiberG: 4.5 },
      { date: "2026-06-04", sourceIds: [], fiberG: 0 },
    ]);
    const stored = nutritionStoredFields(draft.days[0]!);
    expect(stored.calories).toBeNull();
    expect(stored.fiber).toBe(4.5);
    expect(hasStoredNutrition(nutritionStoredFields(draft.days[1]!))).toBe(true);
  });

  it("orders same-day rows by instant instead of raw timestamp text", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.health.weight.csv",
        text: [
          "weight",
          "start_time,weight,datauuid",
          "2026-06-01 12:00:00,70,early-utc",
          "2026-06-01 09:30:00-04:00,71,later-offset",
          "2026-06-02 09:30:00,71,plain",
          "2026-06-02 09:30:00.000,70,millis",
        ].join("\n"),
      },
      {
        name: "com.samsung.shealth.calories_burned.details.csv",
        text: [
          "calories",
          "day_time,update_time,rest_calorie,active_calorie",
          "2026-07-01,2026-07-01 12:00:00,1000,100",
          "2026-07-01,2026-07-01 09:30:00-04:00,1400,300",
        ].join("\n"),
      },
      {
        name: "com.samsung.shealth.activity.day_summary.csv",
        text: [
          "summary",
          "day_time,update_time,step_count,calorie,exercise_time,walk_time",
          "2026-07-02,2026-07-02 12:00:00,100,10,60000,60000",
          "2026-07-02,2026-07-02 09:00:00-04:00,200,20,120000,120000",
        ].join("\n"),
      },
    ]);
    const june1 = draft.days.find((day) => day.date === "2026-06-01");
    expect(june1?.sourceIds).toEqual(["later-offset"]);
    expect(june1?.weightLb).toBe(71 * KG_TO_LB);
    expect(june1?.original).toMatchObject({ recordedAt: "2026-06-01T13:30:00.000Z" });
    expect(draft.days.find((day) => day.date === "2026-06-02")?.sourceIds).toEqual(["plain"]);
    expect(draft.days.find((day) => day.date === "2026-07-01")).toMatchObject({
      bmr: 1400,
      activeCalories: 300,
      burnedCalories: 1700,
    });
    expect(draft.days.find((day) => day.date === "2026-07-02")).toMatchObject({
      steps: 200,
      activeCalories: 20,
      workoutMinutes: 2,
      walkMinutes: 2,
    });
  });

  it("keeps valid rows that follow an unclosed quote", async () => {
    const text = [
      "weight",
      "start_time,weight,datauuid",
      "2026-06-01 08:00:00,70,before",
      '"unterminated,80,bad',
      "2026-06-03 08:00:00,72,after",
    ].join("\n");
    const draft = await parseSamsungFiles([{ name: "com.samsung.health.weight.csv", text }]);
    expect(draft.days.map((day) => day.date)).toEqual(["2026-06-01", "2026-06-03"]);
    expect(draft.days.map((day) => day.sourceIds[0])).toEqual(["before", "after"]);
    expect(draft.errors).toEqual([
      expect.objectContaining({
        file: "com.samsung.health.weight.csv",
        row: 4,
        message: expect.stringMatching(/quote/i),
      }),
    ]);

    const zipped = await parseSamsungZip(zipStored([{ name: "com.samsung.health.weight.csv", data: Buffer.from(text) }]));
    expect(zipped.days.map((day) => day.date)).toEqual(["2026-06-01", "2026-06-03"]);
    expect(zipped.errors.some((error) => error.row === 4 && /quote/i.test(error.message))).toBe(true);
  });

  it("does not invent workout minutes for a distance-only session", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.exercise.csv",
        text: [
          "exercise",
          "datauuid,exercise_type,start_time,duration,distance,calorie",
          "walk,1001,2026-06-05 10:00:00,0,1609.344,10",
        ].join("\n"),
      },
    ]);
    expect(draft.errors).toEqual([]);
    expect(draft.workouts).toHaveLength(1);
    expect(draft.workouts[0]).toMatchObject({
      durationMin: null,
      distanceMi: 1609.344 * M_TO_MI,
      calories: 10,
    });
    const day = draft.days[0];
    expect(day?.workoutMinutes).toBeUndefined();
    expect(day?.exerciseCalories).toBe(10);
    expect(hasStoredActivity(activityStoredFields(day!))).toBe(false);
  });

  it("counts the same workout id from a later file", async () => {
    const draft = await parseSamsungFiles([
      {
        name: "com.samsung.shealth.exercise.csv",
        text: ["exercise", "datauuid,exercise_type,start_time,duration,distance,calorie", "same,1001,2026-06-05 10:00:00,60000,10,1"].join("\n"),
      },
      {
        name: "com.samsung.shealth.exercise.20260605120000.csv",
        text: ["exercise", "datauuid,exercise_type,start_time,duration,distance,calorie", "same,1002,2026-06-05 11:00:00,120000,20,9"].join("\n"),
      },
    ]);
    expect(draft.duplicatesSkipped).toBe(1);
    expect(draft.workouts).toHaveLength(1);
    expect(draft.workouts[0]).toMatchObject({ sourceId: "same", exerciseType: 1002, calories: 9, startedAt: "2026-06-05T11:00:00.000Z" });
  });
});

describe("stored import values", () => {
  it("rounds to the decimal scale a repeat import will read back", () => {
    const pounds = scaleImportedNumber(70 * KG_TO_LB, 3);
    expect(pounds).toBe(154.324);
    expect(scaleImportedNumber(1000 / 60000, 2)).toBe(0.02);
    expect(scaleImportedNumber(7 / 60, 3)).toBe(0.117);
    expect(scaleImportedNumber(0.1 + 0.2, 2)).toBe(0.3);
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(hash({ kind: "weight", value: pounds })).toBe(hash({ kind: "weight", value: 154.324 }));
    expect(hash({ kind: "weight", value: 70 * KG_TO_LB })).not.toBe(hash({ kind: "weight", value: pounds }));
  });

  it("does not treat walk minutes alone as a stored activity row", () => {
    const walkOnly = activityStoredFields({ walkMinutes: 2 });
    expect(walkOnly).toEqual({ steps: null, active: null, minutes: null });
    expect(hasStoredActivity(walkOnly)).toBe(false);
    expect(activityStoredFields({ steps: 10, activeCalories: 10.126, workoutMinutes: 1000 / 60000 })).toEqual({
      steps: 10,
      active: 10.13,
      minutes: 0.02,
    });
  });

  it("includes fiber and sodium in the nutrition identity", () => {
    const stored = nutritionStoredFields({ calories: 100, proteinG: 1, fiberG: 0.1 + 0.2, sodiumMg: 10.126 });
    expect(stored).toEqual({
      calories: 100,
      protein: 1,
      carbs: null,
      fat: null,
      fiber: 0.3,
      sodium: 10.13,
    });
    expect(Object.keys(stored)).toEqual(["calories", "protein", "carbs", "fat", "fiber", "sodium"]);
  });
});
