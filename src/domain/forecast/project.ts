/** Heuristic forecasting. Figures are projections, not guaranteed biological outcomes. */

export const FORECAST_VERSION = "forecast-v1" as const;

export const KCAL_PER_LB = 3500;
export const MAX_FAT_LOSS_LB_PER_WEEK = 1.5;
export const MAX_FAT_LOSS_FRACTION_OF_BW = 0.01;
/** Fat fraction of body weight. Reported body-fat figures use percent. */
export const BF_FLOOR = 0.05;

export const LEAN_GAIN_CAP_LB_PER_WEEK = {
  conservative: 0.1,
  expected: 0.25,
  aggressive: 0.5,
} as const;

/** Scales the energy-predicted weekly weight change. */
export const MODE_MULTIPLIER = {
  conservative: 0.5,
  expected: 1,
  aggressive: 1.5,
} as const;

export const DISCLAIMER =
  "Outcomes are not guaranteed. This is a heuristic projection, not a promise of what will happen.";

export const CAPPED_ASSUMPTIONS: readonly string[] = [
  "Uses a 3500 kcal/lb proxy to turn the gap between intake and TDEE into an expected weight change.",
  "Fat loss is capped at the lesser of 1.5 lb per week and 1% of current body weight per week.",
  "Lean gain is capped at 0.1, 0.25, or 0.5 lb per week for conservative, expected, and aggressive modes. Mode also scales the energy-predicted weekly change by 0.5, 1, or 1.5. Fat-free mass change is not muscle.",
  "A 5% fat floor stops estimated fat loss from crossing below 5% of body weight. A deficit does not add weight to reach that floor.",
  "This is a heuristic, compared later against linear extrapolation.",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SeriesPoint {
  at: string;
  value: number;
}

export interface TimedPoint {
  at: string;
  time: number;
  value: number;
}

export interface LinearModel {
  n: number;
  slopePerWeek: number | null;
  intercept: number | null;
  r2: number | null;
  residualSd: number | null;
}

export interface LinearProjection {
  version: typeof FORECAST_VERSION;
  method: "linear";
  status: "ok" | "insufficient_data";
  projected: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  slopePerWeek: number | null;
  disclaimer: string;
}

export type ForecastMode = keyof typeof MODE_MULTIPLIER;

export interface CappedInput {
  weightLb: number;
  fatMassLb: number;
  intakeKcal: number;
  tdeeKcal: number;
  horizonDays: number;
  mode: ForecastMode;
}

export interface CappedWeek {
  week: number;
  weightLb: number;
  fatMassLb: number;
  fatFreeMassLb: number;
  bodyFatPercent: number;
}

export interface CappedResult {
  version: typeof FORECAST_VERSION;
  method: "capped";
  heuristic: true;
  status: "ok" | "invalid";
  weightLb: number | null;
  fatMassLb: number | null;
  fatFreeMassLb: number | null;
  bodyFatPercent: number | null;
  weeklyPath: CappedWeek[];
  assumptions: string[];
  disclaimer: string;
}

export interface PlateauResult {
  plateau: boolean;
  slopePerWeek: number | null;
  reason: string;
}

export interface BacktestResult {
  linearMae: number | null;
  naiveMae: number | null;
  n: number;
  linearBeatsNaive: boolean | null;
}

export function parseSeries(points: SeriesPoint[]): TimedPoint[] {
  const parsed: TimedPoint[] = [];
  for (const point of points) {
    if (!point || typeof point.at !== "string" || !Number.isFinite(point.value)) continue;
    const time = Date.parse(point.at);
    if (!Number.isFinite(time)) continue;
    parsed.push({ at: point.at, time, value: point.value });
  }
  parsed.sort((a, b) => a.time - b.time || a.at.localeCompare(b.at));
  return parsed;
}

function emptyLinearModel(n: number): LinearModel {
  return { n, slopePerWeek: null, intercept: null, r2: null, residualSd: null };
}

export function linearModel(points: SeriesPoint[]): LinearModel {
  const series = parseSeries(points);
  const n = series.length;
  if (n < 2) return emptyLinearModel(n);

  const t0 = series[0].time;
  const x = series.map((point) => (point.time - t0) / MS_PER_DAY);
  const y = series.map((point) => point.value);
  const xMean = mean(x);
  const yMean = mean(y);

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xMean;
    const dy = y[i] - yMean;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (syy === 0) {
    return {
      n,
      slopePerWeek: 0,
      intercept: yMean,
      r2: null,
      residualSd: n > 2 ? 0 : null,
    };
  }

  if (sxx === 0) return emptyLinearModel(n);

  const slopePerDay = sxy / sxx;
  const intercept = yMean - slopePerDay * xMean;
  const residuals = y.map((value, i) => value - (intercept + slopePerDay * x[i]));
  const sse = residuals.reduce((sum, residual) => sum + residual * residual, 0);
  const r2 = 1 - sse / syy;

  let residualSd: number | null = null;
  if (n > 2) {
    const residualMean = mean(residuals);
    let centered = 0;
    for (const residual of residuals) {
      const delta = residual - residualMean;
      centered += delta * delta;
    }
    residualSd = Math.sqrt(centered / (n - 2));
  }

  return {
    n,
    slopePerWeek: slopePerDay * 7,
    intercept,
    r2,
    residualSd,
  };
}

function insufficientProjection(): LinearProjection {
  return {
    version: FORECAST_VERSION,
    method: "linear",
    status: "insufficient_data",
    projected: null,
    bandLow: null,
    bandHigh: null,
    slopePerWeek: null,
    disclaimer: DISCLAIMER,
  };
}

export function projectLinear(
  points: SeriesPoint[],
  horizonDays: number,
  asOf?: string,
): LinearProjection {
  if (!Number.isFinite(horizonDays)) return insufficientProjection();

  const fit = linearModel(points);
  if (fit.n < 2 || fit.slopePerWeek === null || fit.intercept === null) {
    return insufficientProjection();
  }

  const series = parseSeries(points);
  const first = series[0].time;
  const last = series[series.length - 1].time;
  const lastDay = (last - first) / MS_PER_DAY;
  const slopePerDay = fit.slopePerWeek / 7;

  let targetDay = lastDay + horizonDays;
  if (asOf !== undefined) {
    const asOfTime = Date.parse(asOf);
    if (Number.isFinite(asOfTime)) {
      targetDay = (asOfTime - first) / MS_PER_DAY + horizonDays;
    }
  }

  const projected = fit.intercept + slopePerDay * targetDay;
  let bandLow: number | null = null;
  let bandHigh: number | null = null;
  if (fit.n >= 8 && fit.residualSd !== null && Number.isFinite(fit.residualSd)) {
    const halfWidth = 1.96 * fit.residualSd;
    bandLow = projected - halfWidth;
    bandHigh = projected + halfWidth;
  }

  return {
    version: FORECAST_VERSION,
    method: "linear",
    status: "ok",
    projected,
    bandLow,
    bandHigh,
    slopePerWeek: fit.slopePerWeek,
    disclaimer: DISCLAIMER,
  };
}

function invalidCapped(): CappedResult {
  return {
    version: FORECAST_VERSION,
    method: "capped",
    heuristic: true,
    status: "invalid",
    weightLb: null,
    fatMassLb: null,
    fatFreeMassLb: null,
    bodyFatPercent: null,
    weeklyPath: [],
    assumptions: [...CAPPED_ASSUMPTIONS],
    disclaimer: DISCLAIMER,
  };
}

export function projectCapped(input: CappedInput): CappedResult {
  const { weightLb, fatMassLb, intakeKcal, tdeeKcal, horizonDays, mode } = input;
  const multiplier = MODE_MULTIPLIER[mode];
  const leanCapPerWeek = LEAN_GAIN_CAP_LB_PER_WEEK[mode];
  if (
    multiplier === undefined ||
    leanCapPerWeek === undefined ||
    !Number.isFinite(weightLb) ||
    weightLb <= 0 ||
    !Number.isFinite(fatMassLb) ||
    fatMassLb < 0 ||
    fatMassLb > weightLb ||
    !Number.isFinite(horizonDays) ||
    horizonDays <= 0 ||
    !Number.isFinite(intakeKcal) ||
    !Number.isFinite(tdeeKcal)
  ) {
    return invalidCapped();
  }

  const rawWeekly = ((intakeKcal - tdeeKcal) * 7 / KCAL_PER_LB) * multiplier;
  let weight = weightLb;
  let fat = fatMassLb;
  const weeklyPath: CappedWeek[] = [];
  const steps = Math.ceil(horizonDays / 7);

  for (let step = 0; step < steps; step++) {
    const days = Math.min(7, horizonDays - step * 7);
    const fraction = days / 7;
    const raw = rawWeekly * fraction;
    let fatChange: number;
    let leanChange: number;

    if (raw < 0) {
      const cap = Math.min(MAX_FAT_LOSS_LB_PER_WEEK, MAX_FAT_LOSS_FRACTION_OF_BW * weight) * fraction;
      fatChange = Math.max(raw, -cap);
      leanChange = 0;
    } else {
      const leanCap = leanCapPerWeek * fraction;
      leanChange = Math.min(raw, leanCap);
      fatChange = raw - leanChange;
    }

    let newFat = fat + fatChange;
    const newLean = weight - fat + leanChange;
    let newWeight = newFat + newLean;
    if (newWeight > 0 && newFat / newWeight < BF_FLOOR) {
      const floorFat = (BF_FLOOR / (1 - BF_FLOOR)) * newLean;
      if (raw < 0) {
        // A deficit must not create fat to reach the floor. Hold the previous fat
        // when the body is already under 5%; otherwise stop the loss at 5%.
        newFat = Math.min(fat, Math.max(newFat, floorFat));
      } else {
        newFat = floorFat;
      }
      newWeight = newLean + newFat;
    }

    weight = newWeight;
    fat = newFat;
    const fatFreeMassLb = weight - fat;
    weeklyPath.push({
      week: step + 1,
      weightLb: weight,
      fatMassLb: fat,
      fatFreeMassLb,
      bodyFatPercent: weight > 0 ? (fat / weight) * 100 : 0,
    });
  }

  const fatFreeMassLb = weight - fat;
  return {
    version: FORECAST_VERSION,
    method: "capped",
    heuristic: true,
    status: "ok",
    weightLb: weight,
    fatMassLb: fat,
    fatFreeMassLb,
    bodyFatPercent: weight > 0 ? (fat / weight) * 100 : 0,
    weeklyPath,
    assumptions: [...CAPPED_ASSUMPTIONS],
    disclaimer: DISCLAIMER,
  };
}

export function detectPlateau(points: SeriesPoint[], windowDays = 21): PlateauResult {
  const series = parseSeries(points);
  if (series.length === 0) {
    return { plateau: false, slopePerWeek: null, reason: "No finite points to judge a plateau." };
  }

  const lastTime = series[series.length - 1].time;
  const windowMs = windowDays * MS_PER_DAY;
  const window = series.filter((point) => point.time >= lastTime - windowMs && point.time <= lastTime);
  const fit = linearModel(window.map((point) => ({ at: point.at, value: point.value })));

  if (window.length < 4) {
    return {
      plateau: false,
      slopePerWeek: fit.slopePerWeek,
      reason: "Fewer than 4 points in the recent window.",
    };
  }

  const slope = fit.slopePerWeek;
  const change = window[window.length - 1].value - window[0].value;
  const sd = sampleStandardDeviation(window.map((point) => point.value));
  const spanWeeks = (window[window.length - 1].time - window[0].time) / MS_PER_DAY / 7;
  const noise = fit.residualSd;
  const slopeEffect = slope === null || !Number.isFinite(spanWeeks) ? null : Math.abs(slope) * spanWeeks;

  if (slope === null || noise === null || slopeEffect === null || !Number.isFinite(noise)) {
    return {
      plateau: false,
      slopePerWeek: slope,
      reason: "The recent window does not support a slope relative to its noise.",
    };
  }

  if (slopeEffect > noise) {
    return {
      plateau: false,
      slopePerWeek: slope,
      reason: "The change implied by the weekly slope is larger than the residual noise.",
    };
  }

  if (Math.abs(change) > sd) {
    return {
      plateau: false,
      slopePerWeek: slope,
      reason: "Net change in the window is larger than the variation of the series.",
    };
  }

  return {
    plateau: true,
    slopePerWeek: slope,
    reason: "The slope is near zero relative to the residual noise, and the net change sits within the variation of the window.",
  };
}

export function backtest(points: SeriesPoint[], horizonDays: number): BacktestResult {
  const empty: BacktestResult = {
    linearMae: null,
    naiveMae: null,
    n: 0,
    linearBeatsNaive: null,
  };
  if (!Number.isFinite(horizonDays)) return empty;

  const series = parseSeries(points);
  const linearErrors: number[] = [];
  const naiveErrors: number[] = [];

  for (let i = 1; i < series.length - 1; i++) {
    const futureIndex = findFutureIndex(series, i, horizonDays);
    if (futureIndex === null) continue;

    const training = series.slice(0, i + 1).map((point) => ({ at: point.at, value: point.value }));
    const fit = linearModel(training);
    if (fit.intercept === null || fit.slopePerWeek === null) continue;

    const slopePerDay = fit.slopePerWeek / 7;
    const futureDay = (series[futureIndex].time - series[0].time) / MS_PER_DAY;
    const predicted = fit.intercept + slopePerDay * futureDay;
    const actual = series[futureIndex].value;
    linearErrors.push(Math.abs(predicted - actual));
    naiveErrors.push(Math.abs(series[i].value - actual));
  }

  if (linearErrors.length === 0) return empty;

  const linearMae = mean(linearErrors);
  const naiveMae = mean(naiveErrors);
  return {
    linearMae,
    naiveMae,
    n: linearErrors.length,
    linearBeatsNaive: linearMae <= naiveMae,
  };
}

function findFutureIndex(series: TimedPoint[], originIndex: number, horizonDays: number): number | null {
  const originTime = series[originIndex].time;
  let bestIndex: number | null = null;
  let bestDistance = Infinity;

  for (let j = originIndex + 1; j < series.length; j++) {
    const deltaDays = (series[j].time - originTime) / MS_PER_DAY;
    if (deltaDays < horizonDays - 1) continue;
    if (deltaDays > horizonDays + 1) break;

    const distance = Math.abs(deltaDays - horizonDays);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = j;
    }
  }

  return bestIndex;
}

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const center = mean(values);
  let sum = 0;
  for (const value of values) {
    const delta = value - center;
    sum += delta * delta;
  }
  return Math.sqrt(sum / (values.length - 1));
}
