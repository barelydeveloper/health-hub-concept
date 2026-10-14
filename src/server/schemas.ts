import { z } from "zod";

export const modalitySchema = z.enum([
  "conventional",
  "eccentric_only",
  "isometric",
  "assisted",
  "bodyweight",
  "weighted_bodyweight",
]);

export const setSchema = z.object({
  modality: modalitySchema,
  reps: z.number().int().nonnegative().nullable().optional(),
  durationSec: z.number().nonnegative().nullable().optional(),
  externalLoadLb: z.number().nonnegative().nullable().optional(),
  addedLoadLb: z.number().nonnegative().nullable().optional(),
  assistanceLb: z.number().nonnegative().nullable().optional(),
  bodyWeightLb: z.number().positive().nullable().optional(),
  rpe: z.number().min(0).max(10).nullable().optional(),
  rir: z.number().min(0).max(10).nullable().optional(),
  side: z.enum(["left", "right", "both"]).nullable().optional(),
  isWarmup: z.boolean().optional(),
  tempo: z.string().max(40).nullable().optional(),
  effort: z.string().max(80).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const workoutCreateSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  timezone: z.string().max(80).optional(),
  sourceId: z.string().max(200).nullable().optional(),
  exercises: z.array(z.object({
    exerciseSlug: z.string().min(1).max(80),
    exerciseName: z.string().min(1).max(160).optional(),
    notes: z.string().max(2000).nullable().optional(),
    sets: z.array(setSchema).min(1),
  })).min(1),
});

export const workoutPatchSchema = z.object({
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  timezone: z.string().max(80).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update." });

export const addSetsSchema = z.object({
  exerciseSlug: z.string().min(1).max(80),
  exerciseName: z.string().min(1).max(160).optional(),
  sets: z.array(setSchema).min(1),
});

export const measurementSchema = z.object({
  recordedAt: z.string().datetime(),
  site: z.enum(["neck", "chest", "waist", "hips", "thigh_left", "thigh_right", "upper_arm_left", "upper_arm_right", "other"]).optional(),
  siteLabel: z.string().max(80).optional(),
  valueInches: z.number().positive().optional(),
  weightLb: z.number().positive().optional(),
  bodyFatPercent: z.number().min(0).max(100).optional(),
  fatMassLb: z.number().nonnegative().optional(),
  fatFreeMassLb: z.number().nonnegative().optional(),
  skeletalMuscleLb: z.number().nonnegative().optional(),
  bodyWaterLb: z.number().nonnegative().optional(),
  note: z.string().max(2000).optional(),
  sourceId: z.string().max(200).optional(),
}).superRefine((value, ctx) => {
  if (value.site || value.valueInches != null) {
    if (!value.site || value.valueInches == null) {
      ctx.addIssue({ code: "custom", message: "Circumference records need site and valueInches.", path: ["site"] });
    }
    return;
  }
  const hasBody = [value.weightLb, value.bodyFatPercent, value.fatMassLb, value.fatFreeMassLb, value.skeletalMuscleLb, value.bodyWaterLb]
    .some((item) => item != null);
  if (!hasBody) ctx.addIssue({ code: "custom", message: "Provide at least one measurement.", path: ["weightLb"] });
});

export const measurementPatchSchema = z.object({
  value: z.number().finite(),
  note: z.string().max(2000).optional(),
});

export const nutritionSchema = z.object({
  recordedAt: z.string().datetime(),
  name: z.string().min(1).max(200),
  calories: z.number().nonnegative().nullable().optional(),
  proteinG: z.number().nonnegative().nullable().optional(),
  carbG: z.number().nonnegative().nullable().optional(),
  fatG: z.number().nonnegative().nullable().optional(),
  fiberG: z.number().nonnegative().nullable().optional(),
  sodiumMg: z.number().nonnegative().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  meal: z.string().max(80).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  sourceId: z.string().max(200).optional(),
});

export const goalSchema = z.object({
  type: z.enum([
    "weight",
    "body_fat_percent",
    "fat_mass",
    "circumference",
    "pull_up_reps",
    "hold_duration",
    "dumbbell_press_weight",
    "deadlift_weight",
    "training_frequency",
    "calories",
    "protein",
    "custom",
  ]),
  name: z.string().min(1).max(160),
  targetValue: z.number().finite(),
  targetHigh: z.number().finite().nullable().optional(),
  targetUnit: z.string().min(1).max(32),
  targetDate: z.string().datetime().nullable().optional(),
  direction: z.enum(["up", "down"]).optional(),
  circumferenceSite: z.enum(["neck", "chest", "waist", "hips", "thigh_left", "thigh_right", "upper_arm_left", "upper_arm_right", "other"]).optional(),
  exerciseSlug: z.string().max(80).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const forecastSchema = z.object({
  name: z.string().min(1).max(160),
  mode: z.enum(["conservative", "expected", "aggressive"]),
  intakeKcal: z.number().positive(),
  tdeeKcal: z.number().positive(),
  horizonDays: z.number().int().positive().max(3650),
});

export const profilePatchSchema = z.object({
  displayName: z.string().max(120).nullable().optional(),
  heightInches: z.number().positive().max(100).nullable().optional(),
  sex: z.enum(["female", "male", "unspecified"]).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  maxHeartRate: z.number().int().min(80).max(230).nullable().optional(),
  timezone: z.string().max(80).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const tokenSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(["read", "write", "import"])).min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const importUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200).regex(/\.zip$/i, "filename must end with .zip"),
  byteSize: z.number().int().min(1).max(256 * 1024 * 1024),
});

export const importJsonSchema = z.object({
  label: z.string().max(200).optional(),
  files: z.array(z.object({
    name: z.string().min(1).max(500),
    text: z.string().max(20_000_000).optional(),
    base64: z.string().max(30_000_000).optional(),
  })).min(1),
}).superRefine((value, ctx) => {
  value.files.forEach((file, index) => {
    if (!file.text && !file.base64) {
      ctx.addIssue({ code: "custom", message: "Each file needs text or base64 contents.", path: ["files", index] });
    }
  });
});

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(200).includes("@"),
  password: z.string().min(1).max(200),
});
