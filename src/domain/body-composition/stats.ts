/** Milliseconds in a civil day, used for trailing windows and weekly slopes. */
export const MS_PER_DAY = 86_400_000;

/** Default exponentially weighted moving average smoothing factor. */
export const EWMA_ALPHA_DEFAULT = 0.2;

/** Faster EWMA smoothing factor. */
export const EWMA_ALPHA_FAST = 0.4;

/** Slower EWMA smoothing factor. */
export const EWMA_ALPHA_SLOW = 0.1;

/** Alias required by the body-composition engine contract. */
export const FAST = EWMA_ALPHA_FAST;

/** Alias required by the body-composition engine contract. */
export const SLOW = EWMA_ALPHA_SLOW;

/**
 * Modified z-score threshold. Points with a larger absolute modified z are
 * unusual when the median absolute deviation is positive.
 */
export const OUTLIER_MODIFIED_Z = 3.5;

/**
 * When MAD is 0, a point is unusual only if it is farther than this many
 * pounds from the median, or farther than {@link MAD_ZERO_RELATIVE_FRACTION}
 * of the median, whichever is larger.
 */
export const MAD_ZERO_ABS_LB = 1.5;

/** Relative half of the MAD-zero unusual-value rule (2% of the median). */
export const MAD_ZERO_RELATIVE_FRACTION = 0.02;

const MODIFIED_Z_NUMERATOR = 0.6745;
const ROBUST_SIGMA_FACTOR = 1.4826;

/**
 * Median of a numeric sample. Even-length samples use the mean of the two
 * central values. An empty sample returns NaN.
 */
export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Median absolute deviation from the sample median. */
export function mad(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

/**
 * Iglewicz–Hoaglin modified z-score.
 * Returns 0 when MAD is 0 so a constant series is not treated as infinite.
 */
export function modifiedZ(value: number, center: number, madValue: number): number {
  if (madValue === 0) return 0;
  return (MODIFIED_Z_NUMERATOR * (value - center)) / madValue;
}

/**
 * Robust coefficient of variation: (1.4826 * MAD) / median.
 * Returns 0 when the sample is empty, the median is 0, or MAD is 0.
 */
export function robustCv(values: number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  const deviation = mad(values);
  if (center === 0 || deviation === 0) return 0;
  return (ROBUST_SIGMA_FACTOR * deviation) / center;
}

/**
 * Exponentially weighted moving average.
 * y0 = x0; y_t = alpha * x_t + (1 - alpha) * y_{t-1}.
 */
export function ewma(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const smoothed: number[] = [values[0]!];
  for (let index = 1; index < values.length; index += 1) {
    const previous = smoothed[index - 1]!;
    smoothed.push(alpha * values[index]! + (1 - alpha) * previous);
  }
  return smoothed;
}

/**
 * Ordinary least-squares slope expressed per week (slope per day × 7).
 * Returns null when fewer than two points are available or the day axis
 * has no variance.
 */
export function linearSlopePerWeek(
  points: readonly { day: number; value: number }[],
): number | null {
  if (points.length < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (const point of points) {
    sumX += point.day;
    sumY += point.value;
  }
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    const dx = point.day - meanX;
    numerator += dx * (point.value - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return null;
  const perWeek = (numerator / denominator) * 7;
  return Number.isFinite(perWeek) ? perWeek : null;
}

/**
 * Trailing, inclusive rolling mean aligned to input order.
 * A sample contributes when its timestamp is within `windowDays` of the
 * anchor and not after it. Non-finite values are ignored.
 */
export function rollingMean(
  points: readonly { recordedAt: string; value: number }[],
  windowDays: number,
): (number | null)[] {
  const times = points.map((point) => Date.parse(point.recordedAt));
  return points.map((_, index) => {
    const anchor = times[index];
    if (anchor === undefined || !Number.isFinite(anchor)) return null;
    let sum = 0;
    let count = 0;
    for (let other = 0; other < points.length; other += 1) {
      const value = points[other]!.value;
      const time = times[other];
      if (!Number.isFinite(value) || time === undefined || !Number.isFinite(time)) continue;
      const deltaDays = (anchor - time) / MS_PER_DAY;
      if (deltaDays >= 0 && deltaDays <= windowDays) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  });
}

/**
 * Shared unusual-value rule for total body water and scale weight.
 * A constant series is never flagged. When MAD is 0 but some values differ,
 * a point is unusual once it exceeds max(1.5 lb, 2% of |median|).
 */
export function isRobustOutlier(
  value: number,
  center: number,
  madValue: number,
  zThreshold: number,
  allEqual: boolean,
): boolean {
  if (allEqual) return false;
  if (madValue > 0) {
    return Math.abs(modifiedZ(value, center, madValue)) > zThreshold;
  }
  const floor = Math.max(MAD_ZERO_ABS_LB, MAD_ZERO_RELATIVE_FRACTION * Math.abs(center));
  return Math.abs(value - center) > floor;
}
