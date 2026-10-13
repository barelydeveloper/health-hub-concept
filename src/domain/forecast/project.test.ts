import { describe, expect, it } from "vitest";
import {
  DISCLAIMER,
  backtest,
  detectPlateau,
  linearModel,
  projectCapped,
  projectLinear,
  type SeriesPoint,
} from "./project";
import { projectGoal } from "./goals";

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN = Date.UTC(2026, 0, 1);

function atDay(day: number): string {
  return new Date(ORIGIN + day * DAY_MS).toISOString();
}

function series(values: number[], stepDays = 7): SeriesPoint[] {
  return values.map((value, index) => ({ at: atDay(index * stepDays), value }));
}

describe("linearModel", () => {
  it("fits a one-pound-per-week decline", () => {
    const fit = linearModel([
      { at: atDay(0), value: 150 },
      { at: atDay(7), value: 149 },
      { at: atDay(14), value: 148 },
    ]);

    expect(fit.n).toBe(3);
    expect(fit.slopePerWeek).toBeCloseTo(-1, 8);
    expect(fit.intercept).toBeCloseTo(150, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
    expect(fit.residualSd).toBeCloseTo(0, 8);
  });

  it("returns a zero slope and null r2 when every value is equal", () => {
    const fit = linearModel(series([150, 150, 150, 150]));
    expect(fit.n).toBe(4);
    expect(fit.slopePerWeek).toBe(0);
    expect(fit.intercept).toBe(150);
    expect(fit.r2).toBeNull();
    expect(fit.residualSd).toBe(0);
  });

  it("uses the n-2 residual standard deviation", () => {
    const fit = linearModel([
      { at: atDay(0), value: 0 },
      { at: atDay(1), value: 0 },
      { at: atDay(2), value: 3 },
    ]);
    expect(fit.slopePerWeek).toBeCloseTo(10.5, 8);
    expect(fit.intercept).toBeCloseTo(-0.5, 8);
    expect(fit.r2).toBeCloseTo(0.75, 8);
    expect(fit.residualSd).toBeCloseTo(Math.sqrt(1.5), 8);
  });

  it("returns nulls when fewer than two finite points exist", () => {
    const fit = linearModel([
      { at: atDay(0), value: Number.NaN },
      { at: "not-a-date", value: 10 },
      { at: atDay(1), value: 12 },
    ]);
    expect(fit).toEqual({
      n: 1,
      slopePerWeek: null,
      intercept: null,
      r2: null,
      residualSd: null,
    });
  });
});

describe("projectLinear", () => {
  const decline: SeriesPoint[] = [
    { at: atDay(0), value: 150 },
    { at: atDay(7), value: 149 },
    { at: atDay(14), value: 148 },
  ];

  it("projects seven days past the last point and withholds a band for n=3", () => {
    const result = projectLinear(decline, 7);
    expect(result.version).toBe("forecast-v1");
    expect(result.method).toBe("linear");
    expect(result.status).toBe("ok");
    expect(result.projected).toBeCloseTo(147, 8);
    expect(result.slopePerWeek).toBeCloseTo(-1, 8);
    expect(result.bandLow).toBeNull();
    expect(result.bandHigh).toBeNull();
    expect(result.disclaimer).toContain("not guaranteed");
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it("returns insufficient_data for a single finite point", () => {
    const result = projectLinear([{ at: atDay(0), value: 150 }], 7);
    expect(result.status).toBe("insufficient_data");
    expect(result.projected).toBeNull();
    expect(result.bandLow).toBeNull();
    expect(result.bandHigh).toBeNull();
    expect(result.disclaimer).toContain("not guaranteed");
  });

  it("builds a residual band only once eight points are available", () => {
    const values = [150, 149, 148, 147, 146, 145, 144, 143];
    const small = projectLinear(series(values.slice(0, 7)), 7);
    expect(small.projected).toBeCloseTo(143, 8);
    expect(small.bandLow).toBeNull();
    expect(small.bandHigh).toBeNull();

    const full = projectLinear(series(values), 7);
    expect(full.projected).toBeCloseTo(142, 8);
    expect(full.bandLow).toBeCloseTo(142, 8);
    expect(full.bandHigh).toBeCloseTo(142, 8);
  });

  it("places the horizon beyond asOf when that anchor is provided", () => {
    const result = projectLinear(decline, 7, atDay(21));
    expect(result.projected).toBeCloseTo(146, 8);
  });
});

describe("projectCapped", () => {
  const base = {
    weightLb: 200,
    fatMassLb: 40,
    intakeKcal: 2000,
    tdeeKcal: 2500,
    horizonDays: 7,
  };

  it("drops one pound of fat in the expected deficit case", () => {
    const result = projectCapped({ ...base, mode: "expected" });
    expect(result.status).toBe("ok");
    expect(result.heuristic).toBe(true);
    expect(result.version).toBe("forecast-v1");
    expect(result.weightLb).toBeCloseTo(199, 8);
    expect(result.fatMassLb).toBeCloseTo(39, 8);
    expect(result.fatFreeMassLb).toBeCloseTo(160, 8);
    expect(result.bodyFatPercent).toBeCloseTo((39 / 199) * 100, 5);
    expect(result.bodyFatPercent).toBeCloseTo(19.598, 3);
    expect(result.weeklyPath).toHaveLength(1);
    expect(result.weeklyPath[0]).toMatchObject({
      week: 1,
      weightLb: 199,
      fatMassLb: 39,
      fatFreeMassLb: 160,
    });
    expect(result.disclaimer).toContain("not guaranteed");
    const assumptions = result.assumptions.join(" ");
    expect(assumptions).toMatch(/3500 kcal\/lb/);
    expect(assumptions).toMatch(/fat loss/i);
    expect(assumptions).toMatch(/1\.5/);
    expect(assumptions).toMatch(/lean/i);
    expect(assumptions).toMatch(/5%/);
    expect(assumptions).toMatch(/heuristic/i);
    expect(assumptions).toMatch(/linear extrapolation/i);
    expect(assumptions).not.toMatch(/muscle gain/i);
  });

  it("applies the aggressive and conservative multipliers inside the fat-loss cap", () => {
    const aggressive = projectCapped({ ...base, mode: "aggressive" });
    expect(aggressive.weightLb).toBeCloseTo(198.5, 8);
    expect(aggressive.fatMassLb).toBeCloseTo(38.5, 8);
    expect(aggressive.fatFreeMassLb).toBeCloseTo(160, 8);

    const conservative = projectCapped({ ...base, mode: "conservative" });
    expect(conservative.weightLb).toBeCloseTo(199.5, 8);
    expect(conservative.fatMassLb).toBeCloseTo(39.5, 8);
    expect(conservative.fatFreeMassLb).toBeCloseTo(160, 8);
  });

  it("holds body fat at the 5% floor across a deep deficit", () => {
    const result = projectCapped({
      weightLb: 150,
      fatMassLb: 8,
      intakeKcal: 1000,
      tdeeKcal: 3000,
      horizonDays: 28,
      mode: "aggressive",
    });
    expect(result.status).toBe("ok");
    expect(result.weeklyPath).toHaveLength(4);
    expect(result.bodyFatPercent).toBeGreaterThanOrEqual(4.99);
    expect(result.bodyFatPercent).toBeCloseTo(5, 2);
    for (const week of result.weeklyPath) {
      expect(week.bodyFatPercent).toBeGreaterThanOrEqual(4.99);
    }
  });

  it("splits a surplus between the lean cap and fat mass", () => {
    const result = projectCapped({
      weightLb: 150,
      fatMassLb: 30,
      intakeKcal: 3000,
      tdeeKcal: 2500,
      horizonDays: 7,
      mode: "expected",
    });
    expect(result.weightLb).toBeCloseTo(151, 8);
    expect(result.fatMassLb).toBeCloseTo(30.75, 8);
    expect(result.fatFreeMassLb).toBeCloseTo(120.25, 8);
  });

  it("does not gain weight in a deficit to manufacture the 5% fat floor", () => {
    const result = projectCapped({
      weightLb: 200,
      fatMassLb: 8,
      intakeKcal: 1500,
      tdeeKcal: 2500,
      horizonDays: 7,
      mode: "expected",
    });
    expect(result.status).toBe("ok");
    expect(result.weightLb).toBeCloseTo(200, 6);
    expect(result.fatMassLb).toBeCloseTo(8, 6);
    expect(result.fatFreeMassLb).toBeCloseTo(192, 6);
    expect(result.bodyFatPercent).toBeCloseTo(4, 6);
  });

  it("rejects inputs that cannot describe a body or a horizon", () => {
    const cases = [
      { ...base, mode: "expected" as const, weightLb: 0 },
      { ...base, mode: "expected" as const, fatMassLb: -1 },
      { ...base, mode: "expected" as const, fatMassLb: 250 },
      { ...base, mode: "expected" as const, horizonDays: 0 },
      { ...base, mode: "expected" as const, intakeKcal: Number.NaN },
      { ...base, mode: "expected" as const, tdeeKcal: Number.POSITIVE_INFINITY },
    ];
    for (const input of cases) {
      const result = projectCapped(input);
      expect(result.status).toBe("invalid");
      expect(result.weightLb).toBeNull();
      expect(result.weeklyPath).toEqual([]);
      expect(result.disclaimer).toContain("not guaranteed");
    }
  });
});

describe("detectPlateau", () => {
  it("does not treat a steady one-pound-per-week decline as a plateau", () => {
    const result = detectPlateau(series([180, 179, 178, 177]));
    expect(result.plateau).toBe(false);
    expect(result.slopePerWeek).toBeCloseTo(-1, 8);
  });

  it("flags a flat series with tiny noise", () => {
    const values = [150, 150.05, 149.95, 150.02, 149.98, 150.04, 149.97, 150];
    const points = values.map((value, index) => ({ at: atDay(index * 3), value }));
    const result = detectPlateau(points);
    expect(result.plateau).toBe(true);
    expect(result.slopePerWeek).not.toBeNull();
    expect(Math.abs(result.slopePerWeek as number)).toBeLessThan(0.15);
  });

  it("treats a noisy slope above 0.15 lb/week as a plateau when it is small relative to residual error", () => {
    const values = [150, 158, 143, 160, 141, 155, 149.6];
    const points = values.map((value, index) => ({ at: atDay(index * 3.5), value }));
    const fit = linearModel(points);
    const spanWeeks = 3;
    expect(fit.slopePerWeek).not.toBeNull();
    expect(Math.abs(fit.slopePerWeek as number)).toBeGreaterThan(0.15);
    expect(fit.residualSd as number).toBeGreaterThan(Math.abs(fit.slopePerWeek as number) * spanWeeks);

    const result = detectPlateau(points, 21);
    expect(result.plateau).toBe(true);
    expect(result.slopePerWeek).toBeCloseTo(fit.slopePerWeek as number, 8);
  });

  it("judges only the recent window", () => {
    const early = [200, 190, 170, 160].map((value, index) => ({ at: atDay(index * 7), value }));
    const flat = [150, 150.05, 149.95, 150.01, 149.99, 150].map((value, index) => ({
      at: atDay(40 + index * 4),
      value,
    }));
    const result = detectPlateau([...early, ...flat], 21);
    expect(result.plateau).toBe(true);
  });
});

describe("backtest", () => {
  it("shows near-zero linear error on a perfect decline and beats the naive baseline", () => {
    const points = series([200, 199, 198, 197, 196, 195, 194, 193, 192, 191, 190, 189]);
    const result = backtest(points, 7);
    expect(result.n).toBe(10);
    expect(result.linearMae).toBeCloseTo(0, 8);
    expect(result.naiveMae).toBeCloseTo(1, 8);
    expect(result.linearBeatsNaive).toBe(true);
  });

  it("prefers an exact horizon match inside the one-day window", () => {
    const points: SeriesPoint[] = [
      { at: atDay(0), value: 0 },
      { at: atDay(10), value: 0 },
      { at: atDay(16), value: 100 },
      { at: atDay(17), value: 5 },
      { at: atDay(18), value: 100 },
    ];
    const result = backtest(points, 7);
    expect(result.n).toBe(1);
    expect(result.linearMae).toBeCloseTo(5, 8);
    expect(result.naiveMae).toBeCloseTo(5, 8);
  });

  it("returns nulls when nothing can be scored", () => {
    const result = backtest(series([150, 149]), 7);
    expect(result).toEqual({
      linearMae: null,
      naiveMae: null,
      n: 0,
      linearBeatsNaive: null,
    });
  });
});

describe("projectGoal", () => {
  it("estimates about fourteen days to gain two more pounds", () => {
    const points = series([150, 151, 152, 153]);
    const result = projectGoal(points, { type: "weight", target: 155, direction: "up" });
    expect(result.version).toBe("forecast-v1");
    expect(result.method).toBe("linear");
    expect(result.status).toBe("projected");
    expect(result.latest).toBe(153);
    expect(result.slopePerWeek).toBeCloseTo(1, 8);
    const last = new Date(points[points.length - 1].at).getTime();
    const estimated = new Date(result.estimatedDate ?? "").getTime();
    expect((estimated - last) / DAY_MS).toBeCloseTo(14, 5);
    expect(result.disclaimer).toContain("not guaranteed");
    expect(result.disclaimer).toContain("not a guaranteed date");
  });

  it("reports a goal that the latest value already satisfies", () => {
    const result = projectGoal(series([150, 156]), {
      type: "weight",
      target: 155,
      direction: "up",
    });
    expect(result.status).toBe("already_met");
    expect(result.latest).toBe(156);
    expect(result.estimatedDate).toBeNull();
  });

  it("does not cross when weight is rising toward a lower target", () => {
    const result = projectGoal(series([150, 151, 152, 153]), {
      type: "weight",
      target: 140,
      direction: "down",
    });
    expect(result.status).toBe("no_crossing");
    expect(result.estimatedDate).toBeNull();
    expect(result.slopePerWeek).toBeCloseTo(1, 8);
  });

  it("uses the same slope math for training frequency", () => {
    const points = series([2, 3, 4]);
    const result = projectGoal(points, {
      type: "training_frequency",
      target: 6,
      direction: "up",
    });
    expect(result.status).toBe("projected");
    expect(result.latest).toBe(4);
    expect(result.slopePerWeek).toBeCloseTo(1, 8);
    const last = new Date(points[points.length - 1].at).getTime();
    const estimated = new Date(result.estimatedDate ?? "").getTime();
    expect((estimated - last) / DAY_MS).toBeCloseTo(14, 5);
  });

  it("anchors the estimated date at asOf when that timestamp is provided", () => {
    const points = series([150, 151, 152, 153]);
    const asOf = atDay(3 * 7 + 10);
    const result = projectGoal(points, { type: "weight", target: 155, direction: "up" }, asOf);
    const estimated = new Date(result.estimatedDate ?? "").getTime();
    expect((estimated - Date.parse(asOf)) / DAY_MS).toBeCloseTo(14, 5);
  });

  it("does not throw when the projected crossing is not a representable date", () => {
    const result = projectGoal(
      [
        { at: atDay(0), value: 0 },
        { at: atDay(7), value: 1e-5 },
      ],
      { type: "weight", target: 1_000_000, direction: "up" },
    );
    expect(result.status).toBe("no_crossing");
    expect(result.estimatedDate).toBeNull();
    expect(result.slopePerWeek).toBeCloseTo(1e-5, 8);
  });

  it("returns insufficient_data below two points when the goal is still ahead", () => {
    const result = projectGoal([{ at: atDay(0), value: 150 }], {
      type: "weight",
      target: 155,
      direction: "up",
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.latest).toBe(150);
    expect(result.estimatedDate).toBeNull();
  });
});
