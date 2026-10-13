export const KG_TO_LB = 2.20462262;
export const LB_TO_KG = 1 / KG_TO_LB;
export const CM_TO_IN = 1 / 2.54;
export const IN_TO_CM = 2.54;

export function toPounds(value: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "lb" || normalized === "lbs" || normalized === "pound" || normalized === "pounds") {
    return value;
  }
  if (normalized === "kg" || normalized === "kilogram" || normalized === "kilograms") {
    return value * KG_TO_LB;
  }
  throw new Error(`Unsupported mass unit: ${unit}`);
}

export function toInches(value: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "in" || normalized === "inch" || normalized === "inches") return value;
  if (normalized === "cm" || normalized === "centimeter" || normalized === "centimeters") return value * CM_TO_IN;
  throw new Error(`Unsupported length unit: ${unit}`);
}

export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
