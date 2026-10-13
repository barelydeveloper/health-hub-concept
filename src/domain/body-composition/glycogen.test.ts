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
    expect(result.projectedBodyFatMidPercent).toBeCloseTo(19.75, 2);
    expect(result.projectedBodyFatMidPercent).toBeCloseTo((30 / projectedMid) * 100, 5);
    expect(result.projectedWeightLowLb).toBeLessThan(result.projectedWeightMidLb);
    expect(result.projectedWeightMidLb).toBeLessThan(result.projectedWeightHighLb);
    expect(result.limitations.join(" ")).toMatch(/heuristic/i);
    expect(result.limitations.join(" ")).toMatch(/2\.7/);
    expect(result.limitations.join(" ")).toMatch(/4\.0/);
    expect(result).not.toHaveProperty("skeletalMuscleLb");
  });
});
