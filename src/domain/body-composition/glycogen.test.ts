import { describe, expect, it } from "vitest";
import { GRAMS_PER_LB, estimateGlycogenRefill } from "./index";

describe("estimateGlycogenRefill", () => {
  it("projects mid-band refill weight and body fat for a 200 g glycogen restoration", () => {
    const result = estimateGlycogenRefill({
      depletedWeightLb: 150,
      referenceFatMassLb: 30,
      glycogenG: 200,
    });

    const glycogenLb = 200 / GRAMS_PER_LB;
    const midWaterLb = (200 * ((2.7 + 4) / 2)) / GRAMS_PER_LB;
    const projectedMid = 150 + glycogenLb + midWaterLb;

    expect(result.version).toBe("glycogen-refill-v1");
    expect(result.heuristic).toBe(true);
    expect(result.glycogenLb).toBeCloseTo(0.4409, 3);
    expect(result.glycogenLb).toBeCloseTo(glycogenLb, 5);
    expect(result.projectedWeightMidLb).toBeCloseTo(151.918, 3);
    expect(result.projectedWeightMidLb).toBeCloseTo(projectedMid, 5);
    const midPercent = result.projectedBodyFatMidPercent;
    const weightLow = result.projectedWeightLowLb;
    const weightMid = result.projectedWeightMidLb;
    const weightHigh = result.projectedWeightHighLb;
    if (midPercent === null || weightLow === null || weightMid === null || weightHigh === null) {
      throw new Error("expected a finite glycogen projection");
    }
    expect(midPercent).toBeCloseTo(19.75, 2);
    expect(midPercent).toBeCloseTo((30 / projectedMid) * 100, 5);
    expect(weightLow).toBeLessThan(weightMid);
    expect(weightMid).toBeLessThan(weightHigh);
    expect(result.limitations.join(" ")).toMatch(/heuristic/i);
    expect(result.limitations.join(" ")).toMatch(/2\.7/);
    expect(result.limitations.join(" ")).toMatch(/4\.0/);
    expect(result).not.toHaveProperty("skeletalMuscleLb");
  });

  it("returns null body fat instead of NaN when projected weight is not positive", () => {
    const result = estimateGlycogenRefill({
      depletedWeightLb: 0,
      referenceFatMassLb: 30,
      glycogenG: 0,
    });

    expect(result.projectedWeightMidLb).toBe(0);
    expect(result.projectedBodyFatLowPercent).toBeNull();
    expect(result.projectedBodyFatMidPercent).toBeNull();
    expect(result.projectedBodyFatHighPercent).toBeNull();
  });

  it("returns nulls instead of NaN when a glycogen input is not finite", () => {
    const result = estimateGlycogenRefill({
      depletedWeightLb: Number.NaN,
      referenceFatMassLb: 30,
      glycogenG: 200,
    });

    expect(result.glycogenLb).toBeNull();
    expect(result.projectedWeightLowLb).toBeNull();
    expect(result.projectedWeightMidLb).toBeNull();
    expect(result.projectedWeightHighLb).toBeNull();
    expect(result.projectedBodyFatMidPercent).toBeNull();
    expect(result.heuristic).toBe(true);
  });
});
