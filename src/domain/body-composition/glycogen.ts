/** Grams in one avoirdupois pound. */
export const GRAMS_PER_LB = 453.59237;

export const GLYCOGEN_VERSION = "glycogen-refill-v1" as const;

/** Default grams of associated water per gram of glycogen, low end. */
export const GLYCOGEN_WATER_RATIO_LOW = 2.7;

/** Default grams of associated water per gram of glycogen, high end. */
export const GLYCOGEN_WATER_RATIO_HIGH = 4.0;

export interface GlycogenRefillInput {
  depletedWeightLb: number;
  referenceFatMassLb: number;
  glycogenG: number;
  waterRatioLow?: number;
  waterRatioHigh?: number;
  extraWaterLb?: number;
}

export interface GlycogenRefillResult {
  version: "glycogen-refill-v1";
  heuristic: true;
  limitations: string[];
  glycogenLb: number | null;
  associatedWaterLowLb: number | null;
  associatedWaterMidLb: number | null;
  associatedWaterHighLb: number | null;
  projectedWeightLowLb: number | null;
  projectedWeightMidLb: number | null;
  projectedWeightHighLb: number | null;
  projectedBodyFatLowPercent: number | null;
  projectedBodyFatMidPercent: number | null;
  projectedBodyFatHighPercent: number | null;
}

const GLYCOGEN_LIMITATIONS = [
  "This glycogen and water refill projection is a heuristic, not a body-composition measurement and not part of body-composition normalization.",
  "The default associated-water ratio is 2.7–4.0 grams of water per gram of glycogen.",
];

function projectedBodyFatPercent(
  referenceFatMassLb: number,
  projectedWeightLb: number,
): number | null {
  if (!Number.isFinite(projectedWeightLb) || projectedWeightLb <= 0 || !Number.isFinite(referenceFatMassLb)) {
    return null;
  }
  return (referenceFatMassLb / projectedWeightLb) * 100;
}

function emptyGlycogenResult(): GlycogenRefillResult {
  return {
    version: GLYCOGEN_VERSION,
    heuristic: true,
    limitations: [...GLYCOGEN_LIMITATIONS],
    glycogenLb: null,
    associatedWaterLowLb: null,
    associatedWaterMidLb: null,
    associatedWaterHighLb: null,
    projectedWeightLowLb: null,
    projectedWeightMidLb: null,
    projectedWeightHighLb: null,
    projectedBodyFatLowPercent: null,
    projectedBodyFatMidPercent: null,
    projectedBodyFatHighPercent: null,
  };
}

/**
 * Heuristic scale-weight and body-fat projection after glycogen is restored.
 * This is not a body-composition measurement and does not predict skeletal muscle.
 * Low, mid, and high bands follow the water-per-glycogen ratio, not the body-fat percent.
 */
export function estimateGlycogenRefill(input: GlycogenRefillInput): GlycogenRefillResult {
  const waterRatioLow = input.waterRatioLow ?? GLYCOGEN_WATER_RATIO_LOW;
  const waterRatioHigh = input.waterRatioHigh ?? GLYCOGEN_WATER_RATIO_HIGH;
  const extraWaterLb = input.extraWaterLb ?? 0;
  if (
    !Number.isFinite(input.depletedWeightLb) ||
    !Number.isFinite(input.referenceFatMassLb) ||
    !Number.isFinite(input.glycogenG) ||
    !Number.isFinite(waterRatioLow) ||
    !Number.isFinite(waterRatioHigh) ||
    !Number.isFinite(extraWaterLb)
  ) {
    return emptyGlycogenResult();
  }
  const waterRatioMid = (waterRatioLow + waterRatioHigh) / 2;

  const glycogenLb = input.glycogenG / GRAMS_PER_LB;
  const associatedWaterLowLb = (input.glycogenG * waterRatioLow) / GRAMS_PER_LB;
  const associatedWaterMidLb = (input.glycogenG * waterRatioMid) / GRAMS_PER_LB;
  const associatedWaterHighLb = (input.glycogenG * waterRatioHigh) / GRAMS_PER_LB;

  const projectedWeightLowLb = input.depletedWeightLb + glycogenLb + associatedWaterLowLb + extraWaterLb;
  const projectedWeightMidLb = input.depletedWeightLb + glycogenLb + associatedWaterMidLb + extraWaterLb;
  const projectedWeightHighLb = input.depletedWeightLb + glycogenLb + associatedWaterHighLb + extraWaterLb;

  return {
    version: GLYCOGEN_VERSION,
    heuristic: true,
    limitations: [...GLYCOGEN_LIMITATIONS],
    glycogenLb,
    associatedWaterLowLb,
    associatedWaterMidLb,
    associatedWaterHighLb,
    projectedWeightLowLb,
    projectedWeightMidLb,
    projectedWeightHighLb,
    projectedBodyFatLowPercent: projectedBodyFatPercent(input.referenceFatMassLb, projectedWeightLowLb),
    projectedBodyFatMidPercent: projectedBodyFatPercent(input.referenceFatMassLb, projectedWeightMidLb),
    projectedBodyFatHighPercent: projectedBodyFatPercent(input.referenceFatMassLb, projectedWeightHighLb),
  };
}
