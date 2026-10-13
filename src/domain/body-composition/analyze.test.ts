import { describe, expect, it } from "vitest";
import { analyzeBodyComposition } from "./index";
import { ewma, linearSlopePerWeek, mad, median, modifiedZ, robustCv, rollingMean } from "./stats";
import type { BodyReading } from "./analyze";

function reading(dayOffset: number, overrides: Partial<BodyReading> = {}): BodyReading {
  const recordedAt = new Date(Date.UTC(2026, 0, 1 + dayOffset)).toISOString();
  return {
    recordedAt,
    weightLb: 150,
    bodyFatPercent: 20,
    fatMassLb: 30,
    skeletalMuscleLb: 70,
    bodyWaterLb: 90,
    ...overrides,
  };
}

function stableSeries(days: number, overrides: Partial<BodyReading> = {}): BodyReading[] {
  return Array.from({ length: days }, (_, index) => reading(index, overrides));
}

describe("stats", () => {
  it("computes median, MAD, modified z, and robust CV", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(mad([1, 2, 3, 4, 5])).toBe(1);
    expect(modifiedZ(100, 90, 10)).toBeCloseTo(0.6745, 4);
    expect(modifiedZ(90, 90, 0)).toBe(0);
    expect(robustCv([1, 2, 3, 4, 5])).toBeCloseTo(1.4826 / 3, 5);
    expect(robustCv([90, 90, 90])).toBe(0);
  });

  it("smooths with EWMA and reports an OLS slope per week", () => {
    expect(ewma([10, 20], 0.2)).toEqual([10, 12]);
    expect(
      linearSlopePerWeek([
        { day: 0, value: 150 },
        { day: 7, value: 151 },
      ]),
    ).toBeCloseTo(1, 5);
    expect(linearSlopePerWeek([{ day: 0, value: 150 }])).toBeNull();
  });

  it("uses a trailing inclusive window for the rolling mean", () => {
    const points = [
      { recordedAt: "2026-01-01T00:00:00.000Z", value: 10 },
      { recordedAt: "2026-01-02T00:00:00.000Z", value: 20 },
      { recordedAt: "2026-01-03T00:00:00.000Z", value: 30 },
    ];
    expect(rollingMean(points, 1)).toEqual([10, 15, 25]);
  });
});

describe("analyzeBodyComposition", () => {
  it("normalizes a stable series and keeps two-compartment estimates beside raw values", () => {
    const input = stableSeries(10).reverse();
    const snapshot = input.map((item) => ({ ...item }));
    const result = analyzeBodyComposition(input);

    expect(input).toEqual(snapshot);
    expect(result.version).toBe("body-comp-v1");
    expect(result.normalization.status).toBe("ok");
    expect(result.baselineBodyWaterLb).toBeCloseTo(90, 3);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations.join(" ")).toMatch(/estimate/i);
    expect(result.limitations.join(" ")).toMatch(/impedance|BIA/i);
    expect(result.limitations.join(" ")).toMatch(/not muscle gain/i);
    expect(result.points.map((point) => point.recordedAt)).toEqual(
      [...result.points.map((point) => point.recordedAt)].sort(),
    );

    for (const point of result.points) {
      expect(point.unusualHydration).toBe(false);
      expect(point.outlier).toBe(false);
      expect(point.rawFatMassLb).toBeCloseTo(30, 3);
      expect(point.rawFatFreeMassLb).toBeCloseTo(120, 3);
      expect(point.rawSkeletalMuscleLb).toBeCloseTo(70, 3);
      expect(point.rawBodyFatPercent).toBeCloseTo(20, 3);
      expect(point.hydrationContext?.excessWaterLb).toBeCloseTo(0, 3);
      expect(point.hydrationContext?.adjustedWeightLb).toBeCloseTo(150, 3);
      expect(point.hydrationContext?.fatMassLb).toBeCloseTo(30, 3);
      expect(point.hydrationContext?.bodyFatPercent).toBeCloseTo(20, 3);
      expect(point.twoCompartment?.fatFreeMassLb).toBeCloseTo(90 / 0.73, 3);
      expect(point.twoCompartment?.fatMassLb).toBeCloseTo(150 - 90 / 0.73, 3);
      expect(point.twoCompartment?.fatFreeMassLowLb).toBeCloseTo(90 / 0.76, 3);
      expect(point.twoCompartment?.fatFreeMassHighLb).toBeCloseTo(90 / 0.7, 3);
      expect(point.twoCompartment?.implausible).toBe(false);
      expect(point.ewmaWeightLb).toBeCloseTo(150, 3);
      expect(point.rollingWeightLb).toBeCloseTo(150, 3);
    }

    expect(result.rates.weightLbPerWeek).toBeCloseTo(0, 3);
    expect(result.rates.fatMassLbPerWeek).toBeCloseTo(0, 3);
    expect(result.rates.fatFreeMassLbPerWeek).toBeCloseTo(0, 3);
  });

  it("keeps the fat-mass trend when a dehydrated day spikes raw fat", () => {
    const result = analyzeBodyComposition([
      ...stableSeries(10),
      reading(10, { weightLb: 147, fatMassLb: 33, bodyFatPercent: 22.4, bodyWaterLb: 87 }),
    ]);
    const last = result.points[10];

    expect(result.normalization.status).toBe("ok");
    expect(last?.unusualHydration).toBe(true);
    expect(last?.rawFatMassLb).toBeCloseTo(33, 3);
    expect(last?.hydrationContext?.excessWaterLb).toBeCloseTo(-3, 3);
    expect(last?.hydrationContext?.adjustedWeightLb).toBeCloseTo(150, 3);
    expect(last?.hydrationContext?.fatMassLb).toBeCloseTo(30, 3);
    expect(last?.hydrationContext?.bodyFatPercent).toBeCloseTo(20, 3);
    expect(result.points.slice(0, 10).every((point) => !point.unusualHydration)).toBe(true);
  });

  it("removes a water spike from adjusted weight without recomputing fat from that day's raw percent", () => {
    const result = analyzeBodyComposition([
      ...stableSeries(10),
      reading(10, { weightLb: 158, fatMassLb: 30, bodyFatPercent: null, bodyWaterLb: 98 }),
    ]);
    const last = result.points[10];

    expect(result.normalization.status).toBe("ok");
    expect(last?.unusualHydration).toBe(true);
    expect(last?.hydrationContext?.excessWaterLb).toBeCloseTo(8, 3);
    expect(last?.hydrationContext?.adjustedWeightLb).toBeCloseTo(150, 3);
    expect(last?.hydrationContext?.bodyFatPercent).toBeCloseTo(20, 3);
    expect(last?.hydrationContext?.fatMassLb).toBeCloseTo(30, 3);
    expect(last?.rawBodyFatPercent).toBeCloseTo((30 / 158) * 100, 2);
    expect(last?.rawFatMassLb).toBeCloseTo(30, 3);
  });

  it("withholds hydration context when fewer than 8 paired days are available", () => {
    const result = analyzeBodyComposition(stableSeries(7));

    expect(result.normalization.status).toBe("insufficient_data");
    expect(result.normalization.reason).toMatch(/7/);
    expect(result.baselineBodyWaterLb).toBeNull();
    expect(result.points).toHaveLength(7);
    for (const point of result.points) {
      expect(point.hydrationContext).toBeNull();
      expect(point.twoCompartment).not.toBeNull();
      expect(point.rawFatMassLb).toBeCloseTo(30, 2);
      expect(point.weightLb).toBeCloseTo(150, 2);
      expect(point.bodyWaterLb).toBeCloseTo(90, 2);
    }
  });

  it("rejects an unstable total-body-water baseline", () => {
    const result = analyzeBodyComposition(
      Array.from({ length: 10 }, (_, index) => reading(index, { bodyWaterLb: index % 2 === 0 ? 80 : 100 })),
    );

    expect(result.normalization.status).toBe("insufficient_data");
    expect(result.normalization.reason).toMatch(/unstable|robust CV/i);
    expect(result.baselineBodyWaterLb).toBeNull();
    expect(result.points.every((point) => point.hydrationContext === null)).toBe(true);
    expect(result.points.every((point) => point.twoCompartment !== null)).toBe(true);
  });

  it("leaves water and two-compartment empty when body water is missing", () => {
    const readings = [reading(0), reading(1, { bodyWaterLb: null }), reading(2)];
    const result = analyzeBodyComposition(readings);

    expect(result.points[1]?.bodyWaterLb).toBeNull();
    expect(result.points[1]?.twoCompartment).toBeNull();
    expect(result.points[1]?.rawFatMassLb).toBeCloseTo(30, 2);
    expect(result.points[0]?.twoCompartment).not.toBeNull();
    expect(result.points[2]?.bodyWaterLb).toBeCloseTo(90, 2);
  });

  it("returns an empty point list when there are no readings", () => {
    const result = analyzeBodyComposition([]);

    expect(result.normalization.status).toBe("insufficient_data");
    expect(result.points).toEqual([]);
    expect(result.baselineBodyWaterLb).toBeNull();
    expect(result.rates.weightLbPerWeek).toBeNull();
    expect(result.rates.fatMassLbPerWeek).toBeNull();
    expect(result.rates.fatFreeMassLbPerWeek).toBeNull();
    expect(result.limitations.length).toBeGreaterThan(0);
  });
});
