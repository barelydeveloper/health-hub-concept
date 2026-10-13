import {
  EWMA_ALPHA_DEFAULT,
  MS_PER_DAY,
  OUTLIER_MODIFIED_Z,
  ewma,
  isRobustOutlier,
  linearSlopePerWeek,
  mad,
  median,
  robustCv,
  rollingMean,
} from "./stats";

export const BODY_COMP_VERSION = "body-comp-v1" as const;

/**
 * Default fat-free mass hydration fraction (Pace–Rathbun / Wang).
 * An estimate, not a medical measurement.
 */
export const HYDRATION_FRACTION = 0.73;

export const HYDRATION_FRACTION_LOW = 0.7;

export const HYDRATION_FRACTION_HIGH = 0.76;

export const MIN_PAIRED_DAYS = 8;

export const MAX_ROBUST_CV = 0.08;

export const MIN_NON_UNUSUAL_TBW = 5;

export const ROLLING_WINDOW_DAYS = 7;

export interface BodyReading {
  recordedAt: string;
  weightLb?: number | null;
  bodyFatPercent?: number | null;
  fatMassLb?: number | null;
  skeletalMuscleLb?: number | null;
  bodyWaterLb?: number | null;
}

export interface BodyCompConfig {
  hydrationFraction?: number;
  hydrationFractionLow?: number;
  hydrationFractionHigh?: number;
  minPairedDays?: number;
  ewmaAlpha?: number;
  outlierZ?: number;
  maxRobustCv?: number;
  rollingWindowDays?: number;
}

export interface TwoCompartmentEstimate {
  fatFreeMassLb: number;
  fatMassLb: number;
  bodyFatPercent: number;
  fatFreeMassLowLb: number;
  fatFreeMassHighLb: number;
  implausible: boolean;
}

export interface HydrationContext {
  excessWaterLb: number;
  adjustedWeightLb: number;
  fatMassLb: number | null;
  bodyFatPercent: number | null;
}

export interface BodyCompositionPoint {
  recordedAt: string;
  weightLb: number | null;
  rawBodyFatPercent: number | null;
  rawFatMassLb: number | null;
  rawFatFreeMassLb: number | null;
  rawSkeletalMuscleLb: number | null;
  bodyWaterLb: number | null;
  rollingWeightLb: number | null;
  ewmaWeightLb: number | null;
  unusualHydration: boolean;
  outlier: boolean;
  twoCompartment: TwoCompartmentEstimate | null;
  hydrationContext: HydrationContext | null;
}

export interface BodyCompositionAnalysis {
  version: "body-comp-v1";
  normalization: { status: "ok" | "insufficient_data"; reason?: string };
  limitations: string[];
  baselineBodyWaterLb: number | null;
  points: BodyCompositionPoint[];
  rates: {
    weightLbPerWeek: number | null;
    fatMassLbPerWeek: number | null;
    fatFreeMassLbPerWeek: number | null;
  };
}

const LIMITATIONS = [
  "Hydration-adjusted and two-compartment values are estimates, not medical measurements.",
  "Samsung and BIA fat and total body water often come from the same impedance reading, so water cannot prove a corrected true body-fat percentage. The hydration-context fat mass is the trend of raw fat mass, not a recomputation from the same BIA percentages.",
  "Fat-free mass change is not muscle gain. Skeletal muscle is reported only as the raw device value.",
];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pickNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function rawFatMassLb(reading: BodyReading): number | null {
  if (isFiniteNumber(reading.fatMassLb)) return reading.fatMassLb;
  if (isFiniteNumber(reading.weightLb) && isFiniteNumber(reading.bodyFatPercent)) {
    return (reading.weightLb * reading.bodyFatPercent) / 100;
  }
  return null;
}

function rawBodyFatPercent(reading: BodyReading, fatMassLb: number | null): number | null {
  if (isFiniteNumber(reading.bodyFatPercent)) return reading.bodyFatPercent;
  if (fatMassLb !== null && isFiniteNumber(reading.weightLb) && reading.weightLb !== 0) {
    return (fatMassLb / reading.weightLb) * 100;
  }
  return null;
}

function positiveFraction(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function twoCompartmentEstimate(
  weightLb: number | null,
  bodyWaterLb: number | null,
  hydrationFraction: number,
  hydrationFractionLow: number,
  hydrationFractionHigh: number,
): TwoCompartmentEstimate | null {
  if (
    weightLb === null ||
    bodyWaterLb === null ||
    weightLb <= 0 ||
    bodyWaterLb <= 0 ||
    !positiveFraction(hydrationFraction) ||
    !positiveFraction(hydrationFractionLow) ||
    !positiveFraction(hydrationFractionHigh)
  ) {
    return null;
  }
  const fatFreeMassLb = bodyWaterLb / hydrationFraction;
  const fatFreeMassLowLb = bodyWaterLb / hydrationFractionHigh;
  const fatFreeMassHighLb = bodyWaterLb / hydrationFractionLow;
  const fatMassLb = weightLb - fatFreeMassLb;
  return {
    fatFreeMassLb,
    fatMassLb,
    bodyFatPercent: (fatMassLb / weightLb) * 100,
    fatFreeMassLowLb,
    fatFreeMassHighLb,
    implausible: fatMassLb < 0 || fatFreeMassLb > weightLb,
  };
}

function flagSeries(values: number[], zThreshold: number): boolean[] {
  if (values.length === 0) return [];
  const center = median(values);
  const deviation = mad(values);
  const allEqual = values.every((value) => value === values[0]);
  return values.map((value) => isRobustOutlier(value, center, deviation, zThreshold, allEqual));
}

function flagsForReadings(
  readings: readonly BodyReading[],
  select: (reading: BodyReading) => number | null,
  zThreshold: number,
): boolean[] {
  const indexes: number[] = [];
  const values: number[] = [];
  readings.forEach((reading, index) => {
    const value = select(reading);
    if (value !== null) {
      indexes.push(index);
      values.push(value);
    }
  });
  const flagged = flagSeries(values, zThreshold);
  const flags = readings.map(() => false);
  flagged.forEach((isFlagged, position) => {
    const index = indexes[position];
    if (index !== undefined) flags[index] = isFlagged;
  });
  return flags;
}

/**
 * Sort a copy by timestamp. Invalid timestamps sort after valid ones and
 * keep their relative order. The caller's array is not mutated.
 */
function sortedReadings(readings: readonly BodyReading[]): BodyReading[] {
  return readings.map((reading, index) => ({ reading, index })).sort((a, b) => {
    const aTime = Date.parse(a.reading.recordedAt);
    const bTime = Date.parse(b.reading.recordedAt);
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);
    if (aValid && bValid && aTime !== bTime) return aTime - bTime;
    if (aValid !== bValid) return aValid ? -1 : 1;
    return a.index - b.index;
  }).map((entry) => entry.reading);
}

/** UTC calendar day, so repeated readings on one day count once. */
function pairedDayKey(recordedAt: string): string | null {
  const time = Date.parse(recordedAt);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().slice(0, 10);
}

function normalizationDecision(
  pairedDays: number,
  minPairedDays: number,
  bodyWaterValues: readonly number[],
  maxRobustCv: number,
  nonUnusualCount: number,
): { status: "ok" | "insufficient_data"; reason?: string } {
  if (pairedDays < minPairedDays) {
    return {
      status: "insufficient_data",
      reason: `Only ${pairedDays} paired days have both weight and total body water above zero; at least ${minPairedDays} are required.`,
    };
  }
  const cv = robustCv([...bodyWaterValues]);
  if (cv > maxRobustCv) {
    return {
      status: "insufficient_data",
      reason: `Total body water is too unstable for a baseline (robust CV ${cv.toFixed(3)} exceeds ${maxRobustCv}).`,
    };
  }
  if (nonUnusualCount < MIN_NON_UNUSUAL_TBW) {
    return {
      status: "insufficient_data",
      reason: `Only ${nonUnusualCount} non-unusual total body water readings remain; at least ${MIN_NON_UNUSUAL_TBW} are required for a baseline.`,
    };
  }
  return { status: "ok" };
}

/**
 * Body-composition series analysis. Raw device fields stay beside any
 * hydration context. Context is omitted when the total-body-water baseline
 * is not justified. Skeletal muscle is never treated as fat-free mass.
 */
export function analyzeBodyComposition(
  readings: readonly BodyReading[],
  config: BodyCompConfig = {},
): BodyCompositionAnalysis {
  const hydrationFraction = pickNumber(config.hydrationFraction, HYDRATION_FRACTION);
  const hydrationFractionLow = pickNumber(config.hydrationFractionLow, HYDRATION_FRACTION_LOW);
  const hydrationFractionHigh = pickNumber(config.hydrationFractionHigh, HYDRATION_FRACTION_HIGH);
  const minPairedDays = pickNumber(config.minPairedDays, MIN_PAIRED_DAYS);
  const ewmaAlpha = pickNumber(config.ewmaAlpha, EWMA_ALPHA_DEFAULT);
  const outlierZ = pickNumber(config.outlierZ, OUTLIER_MODIFIED_Z);
  const maxRobustCv = pickNumber(config.maxRobustCv, MAX_ROBUST_CV);
  const rollingWindowDays = pickNumber(config.rollingWindowDays, ROLLING_WINDOW_DAYS);

  const sorted = sortedReadings(readings);
  const finiteWater = (reading: BodyReading): number | null =>
    isFiniteNumber(reading.bodyWaterLb) ? reading.bodyWaterLb : null;
  const finiteWeight = (reading: BodyReading): number | null =>
    isFiniteNumber(reading.weightLb) ? reading.weightLb : null;

  const unusualFlags = flagsForReadings(sorted, finiteWater, outlierZ);
  const outlierFlags = flagsForReadings(sorted, finiteWeight, outlierZ);
  const bodyWaterValues = sorted.flatMap((reading) => {
    const water = finiteWater(reading);
    return water === null ? [] : [water];
  });
  const nonUnusualWater = sorted.flatMap((reading, index) => {
    const water = finiteWater(reading);
    if (water === null || unusualFlags[index]) return [];
    return [water];
  });

  const pairedDays = new Set(
    sorted.flatMap((reading) => {
      if (
        !isFiniteNumber(reading.weightLb) ||
        reading.weightLb <= 0 ||
        !isFiniteNumber(reading.bodyWaterLb) ||
        reading.bodyWaterLb <= 0
      ) {
        return [];
      }
      const day = pairedDayKey(reading.recordedAt);
      return day === null ? [] : [day];
    }),
  ).size;

  const normalization = normalizationDecision(
    pairedDays,
    minPairedDays,
    bodyWaterValues,
    maxRobustCv,
    nonUnusualWater.length,
  );
  const baselineBodyWaterLb =
    normalization.status === "ok" ? median(nonUnusualWater) : null;

  const weightSequence = sorted.flatMap((reading) => {
    const weight = finiteWeight(reading);
    return weight === null ? [] : [weight];
  });
  const weightEwma = ewma(weightSequence, ewmaAlpha);
  let weightEwmaIndex = 0;

  const rollingWeights = rollingMean(
    sorted.map((reading) => ({
      recordedAt: reading.recordedAt,
      value: finiteWeight(reading) ?? Number.NaN,
    })),
    rollingWindowDays,
  );

  let fatEwma: number | null = null;
  const points: BodyCompositionPoint[] = sorted.map((reading, index) => {
    const weightLb = finiteWeight(reading);
    const bodyWaterLb = finiteWater(reading);
    const fatMass = rawFatMassLb(reading);
    const unusualHydration = unusualFlags[index] ?? false;
    if (!unusualHydration && fatMass !== null) {
      fatEwma = fatEwma === null ? fatMass : ewmaAlpha * fatMass + (1 - ewmaAlpha) * fatEwma;
    }

    let hydrationContext: HydrationContext | null = null;
    if (
      normalization.status === "ok" &&
      baselineBodyWaterLb !== null &&
      weightLb !== null &&
      bodyWaterLb !== null
    ) {
      const excessWaterLb = bodyWaterLb - baselineBodyWaterLb;
      const adjustedWeightLb = weightLb - excessWaterLb;
      hydrationContext = {
        excessWaterLb,
        adjustedWeightLb,
        fatMassLb: fatEwma,
        bodyFatPercent:
          fatEwma !== null && adjustedWeightLb > 0 ? (fatEwma / adjustedWeightLb) * 100 : null,
      };
    }

    return {
      recordedAt: reading.recordedAt,
      weightLb,
      rawBodyFatPercent: rawBodyFatPercent(reading, fatMass),
      rawFatMassLb: fatMass,
      rawFatFreeMassLb: weightLb !== null && fatMass !== null ? weightLb - fatMass : null,
      rawSkeletalMuscleLb: isFiniteNumber(reading.skeletalMuscleLb) ? reading.skeletalMuscleLb : null,
      bodyWaterLb,
      rollingWeightLb: rollingWeights[index] ?? null,
      ewmaWeightLb: weightLb === null ? null : (weightEwma[weightEwmaIndex++] ?? null),
      unusualHydration,
      outlier: outlierFlags[index] ?? false,
      twoCompartment: twoCompartmentEstimate(
        weightLb,
        bodyWaterLb,
        hydrationFraction,
        hydrationFractionLow,
        hydrationFractionHigh,
      ),
      hydrationContext,
    };
  });

  const originMs = sorted.length > 0 ? Date.parse(sorted[0]!.recordedAt) : Number.NaN;
  const weightSlope: { day: number; value: number }[] = [];
  const fatSlope: { day: number; value: number }[] = [];
  const fatFreeSlope: { day: number; value: number }[] = [];
  points.forEach((point) => {
    const day = (Date.parse(point.recordedAt) - originMs) / MS_PER_DAY;
    if (!point.outlier && point.weightLb !== null) {
      weightSlope.push({ day, value: point.weightLb });
    }
    if (!point.unusualHydration && point.rawFatMassLb !== null) {
      fatSlope.push({ day, value: point.rawFatMassLb });
    }
    if (!point.unusualHydration && point.rawFatFreeMassLb !== null) {
      fatFreeSlope.push({ day, value: point.rawFatFreeMassLb });
    }
  });

  return {
    version: BODY_COMP_VERSION,
    normalization,
    limitations: [...LIMITATIONS],
    baselineBodyWaterLb,
    points,
    rates: {
      weightLbPerWeek: linearSlopePerWeek(weightSlope),
      fatMassLbPerWeek: linearSlopePerWeek(fatSlope),
      fatFreeMassLbPerWeek: linearSlopePerWeek(fatFreeSlope),
    },
  };
}
