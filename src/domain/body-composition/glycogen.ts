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
  glycogenLb: number;
  associatedWaterLowLb: number;
  associatedWaterMidLb: number;
  associatedWaterHighLb: number;
  projectedWeightLowLb: number;
  projectedWeightMidLb: number;
  projectedWeightHighLb: number;
  projectedBodyFatLowPercent: number;
  projectedBodyFatMidPercent: number;
  projectedBodyFatHighPercent: number;
}

const GLYCOGEN_LIMITATIONS = [
  "This glycogen and water refill projection is a heuristic, not a body-composition measurement and not part of body-composition normalization.",
  "The default associated-water ratio is 2.7–4.0 grams of water per gram of glycogen.",
];

function projectedBodyFatPercent(referenceFatMassLb: number, projectedWeightLb: number): number {
  if (projectedWeightLb <= 0) return Number.NaN;
  return (referenceFatMassLb / projectedWeightLb) * 100;
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
