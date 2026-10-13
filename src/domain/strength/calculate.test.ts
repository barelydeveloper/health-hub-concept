import { describe, expect, it } from "vitest";
import {
  MUSCLE_CREDITS,
  compareExercise,
  effectiveLoad,
  estimateE1rm,
  muscleExposure,
  overloadSuggestion,
  personalRecords,
  rirAdjustedLoad,
  summarizeExercise,
  summarizeSession,
  trainingFrequency,
} from "./index";
import type { ExercisePerformance, SetInput, WorkoutSessionInput } from "./index";

function session(
  id: string,
  startedAt: string,
  exercises: ExercisePerformance[],
): WorkoutSessionInput {
  return { id, startedAt, exercises };
}

function exercise(
  exerciseId: string,
  exerciseName: string,
  sets: SetInput[],
  muscleCredits?: ExercisePerformance["muscleCredits"],
): ExercisePerformance {
  return { exerciseId, exerciseName, sets, muscleCredits };
}

describe("effectiveLoad", () => {
  it("uses external load for conventional sets and leaves the assumption empty", () => {
    expect(effectiveLoad({ modality: "conventional", externalLoadLb: 25 })).toEqual({
      loadLb: 25,
      assumption: null,
    });
    expect(effectiveLoad({ modality: "conventional", externalLoadLb: 0 })).toEqual({
      loadLb: null,
      assumption: null,
    });
  });

  it("keeps eccentric load separate from a one-rep max", () => {
    expect(effectiveLoad({ modality: "eccentric_only", externalLoadLb: 80 })).toEqual({
      loadLb: 80,
      assumption:
        "Eccentric-only load is tracked separately and is not converted to a one-rep max.",
    });
  });

  it("counts full body weight for bodyweight sets", () => {
    expect(effectiveLoad({ modality: "bodyweight", bodyWeightLb: 152 })).toEqual({
      loadLb: 152,
      assumption: "Full body weight is counted as the resistance.",
    });
  });

  it("adds body weight and added load for weighted bodyweight sets", () => {
    expect(
      effectiveLoad({ modality: "weighted_bodyweight", bodyWeightLb: 152, addedLoadLb: 25 }),
    ).toEqual({
      loadLb: 177,
      assumption: "Effective load is body weight plus added external load.",
    });
    expect(
      effectiveLoad({ modality: "weighted_bodyweight", bodyWeightLb: 180, addedLoadLb: 0 }).loadLb,
    ).toBe(180);
  });

  it("subtracts assistance and rejects assistance that meets or exceeds body weight", () => {
    expect(effectiveLoad({ modality: "assisted", bodyWeightLb: 150, assistanceLb: 40 })).toEqual({
      loadLb: 110,
      assumption: "Effective load is body weight minus assistance.",
    });
    const matched = effectiveLoad({ modality: "assisted", bodyWeightLb: 150, assistanceLb: 150 });
    expect(matched.loadLb).toBeNull();
    expect(matched.assumption).toMatch(/meets or exceeds/i);
    expect(matched.assumption).toMatch(/body weight/i);
    const exceeded = effectiveLoad({ modality: "assisted", bodyWeightLb: 150, assistanceLb: 160 });
    expect(exceeded.loadLb).toBeNull();
  });

  it("does not assign a load to isometric sets", () => {
    expect(
      effectiveLoad({ modality: "isometric", durationSec: 40, externalLoadLb: 25 }),
    ).toEqual({
      loadLb: null,
      assumption: "Duration is the performance measure. One-rep max is not applicable.",
    });
  });
});

describe("estimateE1rm", () => {
  it("uses body weight for a 2-rep pull-up and treats a single as the load itself", () => {
    const twoReps: SetInput = { modality: "bodyweight", reps: 2, bodyWeightLb: 152 };
    const single: SetInput = { modality: "conventional", reps: 1, externalLoadLb: 225 };

    const pullUp = estimateE1rm(twoReps);
    expect(pullUp.applicable).toBe(true);
    expect(pullUp.formula).toBe("epley");
    expect(pullUp.valueLb).toBe(152 * (1 + 2 / 30));

    const trueSingle = estimateE1rm(single);
    expect(trueSingle).toMatchObject({
      applicable: true,
      valueLb: 225,
      formula: "epley",
    });
    expect(trueSingle.valueLb).not.toBe(225 * (1 + 1 / 30));
  });

  it("estimates a 12-rep dumbbell press and refuses reps outside 1–12", () => {
    const twelve: SetInput = { modality: "conventional", reps: 12, externalLoadLb: 25 };
    const thirteen: SetInput = { modality: "conventional", reps: 13, externalLoadLb: 25 };
    const fractional: SetInput = { modality: "conventional", reps: 10.5, externalLoadLb: 100 };

    const estimated = estimateE1rm(twelve);
    expect(estimated.applicable).toBe(true);
    expect(estimated.valueLb).toBe(25 * (1 + 12 / 30));
    expect(estimated.valueLb).toBeCloseTo(35);

    const tooMany = estimateE1rm(thirteen);
    expect(tooMany.applicable).toBe(false);
    expect(tooMany.valueLb).toBeNull();
    expect(tooMany.reason).toContain("1–12");

    expect(estimateE1rm({ modality: "conventional", reps: null, externalLoadLb: 25 }).reason).toContain(
      "1–12",
    );
    expect(estimateE1rm(fractional).valueLb).toBe(100 * (1 + 10.5 / 30));
  });

  it("does not estimate a one-rep max for eccentric or isometric work", () => {
    const eccentric = estimateE1rm({
      modality: "eccentric_only",
      reps: 10,
      externalLoadLb: 80,
    });
    const hold = estimateE1rm({
      modality: "isometric",
      durationSec: 40,
      reps: 5,
      externalLoadLb: 25,
    });

    expect(eccentric.applicable).toBe(false);
    expect(eccentric.valueLb).toBeNull();
    expect(eccentric.reason).toMatch(/unsuitable/i);
    expect(hold.applicable).toBe(false);
    expect(hold.reason).toMatch(/unsuitable/i);
  });

  it("uses assisted effective load and keeps RIR adjustment off the official e1RM", () => {
    const assisted: SetInput = {
      modality: "assisted",
      reps: 5,
      bodyWeightLb: 150,
      assistanceLb: 40,
      rir: 2,
    };
    expect(estimateE1rm(assisted).valueLb).toBe(110 * (1 + 5 / 30));

    const press: SetInput = { modality: "conventional", reps: 12, externalLoadLb: 25, rir: 1 };
    expect(estimateE1rm(press).valueLb).toBe(35);
    expect(rirAdjustedLoad(press)).toBe(25 * (1 + (12 + 1) / 30));
    expect(rirAdjustedLoad(press)).not.toBe(estimateE1rm(press).valueLb);
    expect(rirAdjustedLoad({ ...press, rir: null })).toBeNull();
    expect(
      rirAdjustedLoad({ modality: "eccentric_only", reps: 10, externalLoadLb: 80, rir: 2 }),
    ).toBeNull();
  });

  it("excludes warm-up sets", () => {
    const warmup = estimateE1rm({
      modality: "conventional",
      reps: 10,
      externalLoadLb: 100,
      isWarmup: true,
    });
    expect(warmup.applicable).toBe(false);
    expect(warmup.valueLb).toBeNull();
  });
});

describe("volume, reps, and personal records", () => {
  it("sums conventional volume, ignores a 13-rep e1RM, and keeps eccentric work out of that total", () => {
    const workout = session("press", "2026-03-01T15:00:00.000Z", [
      exercise("dumbbell-shoulder-press", "Dumbbell Shoulder Press", [
        { modality: "conventional", reps: 12, externalLoadLb: 25 },
      ]),
      exercise("eccentric-calf-raise", "Eccentric Calf Raise", [
        { modality: "eccentric_only", reps: 10, externalLoadLb: 80 },
        { modality: "eccentric_only", reps: 10, externalLoadLb: 80 },
      ]),
    ]);

    const summary = summarizeSession(workout);
    expect(summary.exercises[0]?.conventionalVolumeLb).toBe(300);
    expect(summary.exercises[0]?.totalReps).toBe(12);
    expect(summary.exercises[1]?.eccentricLoadRepProduct).toBe(1600);
    expect(summary.exercises[1]?.conventionalVolumeLb).toBe(0);
    expect(summary.conventionalVolumeLb).toBe(300);
    expect(summary.totalReps).toBe(32);

    const thirteen = summarizeExercise(
      exercise("dumbbell-shoulder-press", "Dumbbell Shoulder Press", [
        { modality: "conventional", reps: 13, externalLoadLb: 25 },
      ]),
    );
    expect(thirteen.conventionalVolumeLb).toBe(325);
    expect(estimateE1rm(thirteen.bestSet ?? { modality: "conventional" }).applicable).toBe(false);
  });

  it("records a 40s dead hang without volume or an e1RM", () => {
    const hang = session("hang", "2026-03-02T15:00:00.000Z", [
      exercise("dead-hang", "Dead Hang", [{ modality: "isometric", durationSec: 40 }]),
    ]);
    const summary = summarizeSession(hang);
    expect(summary.conventionalVolumeLb).toBe(0);
    expect(summary.totalReps).toBe(0);
    expect(summary.exercises[0]?.bestDurationSec).toBe(40);
    expect(summary.exercises[0]?.bestSet?.durationSec).toBe(40);
    expect(estimateE1rm(hang.exercises[0]?.sets[0] ?? { modality: "isometric" }).applicable).toBe(
      false,
    );

    const records = personalRecords([hang], "dead-hang");
    expect(records.bestDurationSec).toBe(40);
    expect(records.bestE1rmLb).toBeNull();
    expect(records.achievedAt.bestDurationSec).toBe(hang.startedAt);
  });

  it("tracks eccentric load without folding it into conventional volume or e1RM", () => {
    const calves = session("calves", "2026-03-03T15:00:00.000Z", [
      exercise("eccentric-calf-raise", "Eccentric Calf Raise", [
        { modality: "eccentric_only", reps: 10, externalLoadLb: 80 },
        { modality: "eccentric_only", reps: 10, externalLoadLb: 80 },
      ]),
    ]);
    const summary = summarizeSession(calves);
    expect(summary.conventionalVolumeLb).toBe(0);
    expect(summary.exercises[0]?.eccentricLoadRepProduct).toBe(1600);
    expect(summary.exercises[0]?.totalReps).toBe(20);
    expect(estimateE1rm(calves.exercises[0]?.sets[0] ?? { modality: "eccentric_only" }).applicable).toBe(
      false,
    );

    const records = personalRecords([calves], "eccentric-calf-raise");
    expect(records.bestEccentricLoadLb).toBe(80);
    expect(records.bestE1rmLb).toBeNull();
    expect(records.bestConventionalLoadLb).toBeNull();
    expect(records.achievedAt.bestEccentricLoadLb).toBe(calves.startedAt);
  });

  it("excludes warm-up sets from volume, reps, and personal records", () => {
    const workout = session("bench", "2026-03-04T15:00:00.000Z", [
      exercise("bench-press", "Bench Press", [
        { modality: "conventional", reps: 10, externalLoadLb: 100, isWarmup: true },
        { modality: "conventional", reps: 5, externalLoadLb: 60 },
      ]),
    ]);
    const summary = summarizeSession(workout);
    expect(summary.conventionalVolumeLb).toBe(300);
    expect(summary.totalReps).toBe(5);
    expect(summary.exercises[0]?.bestReps).toBe(5);
    expect(summary.exercises[0]?.workSetCount).toBe(1);
    expect(summary.exercises[0]?.bestExternalLoadLb).toBe(60);

    const records = personalRecords([workout], "bench-press");
    expect(records.bestReps).toBe(5);
    expect(records.bestConventionalLoadLb).toBe(60);
    expect(records.bestE1rmLb).toBe(60 * (1 + 5 / 30));
    expect(records.achievedAt.bestE1rmLb).toBe(workout.startedAt);
  });

  it("adds both sides of a unilateral conventional exercise into volume", () => {
    const summary = summarizeExercise(
      exercise("single-arm-row", "Single-Arm Row", [
        { modality: "conventional", reps: 8, externalLoadLb: 40, side: "left" },
        { modality: "conventional", reps: 8, externalLoadLb: 40, side: "right" },
      ]),
    );
    expect(summary.conventionalVolumeLb).toBe(640);
    expect(summary.totalReps).toBe(16);
    expect(summary.bestReps).toBe(8);

    const records = personalRecords(
      [
        session("row-day", "2026-03-01T15:00:00.000Z", [
          exercise("single-arm-row", "Single-Arm Row", [
            { modality: "conventional", reps: 8, externalLoadLb: 40, side: "left" },
            { modality: "conventional", reps: 8, externalLoadLb: 40, side: "right" },
          ]),
        ]),
      ],
      "single-arm-row",
    );
    expect(records.bestReps).toBe(8);
    expect(records.bestE1rmLb).toBeCloseTo(40 * (1 + 8 / 30), 8);
  });

  it("breaks rep ties toward the heavier set and still reports the heaviest external load", () => {
    const summary = summarizeExercise(
      exercise("row", "Row", [
        { modality: "conventional", reps: 8, externalLoadLb: 50 },
        { modality: "conventional", reps: 8, externalLoadLb: 55 },
        { modality: "conventional", reps: 6, externalLoadLb: 90 },
      ]),
    );
    expect(summary.bestReps).toBe(8);
    expect(summary.bestSet?.externalLoadLb).toBe(55);
    expect(summary.bestExternalLoadLb).toBe(90);
    expect(summary.conventionalVolumeLb).toBe(8 * 50 + 8 * 55 + 6 * 90);
  });

  it("keeps the earliest achievement when a record is tied", () => {
    const first = session("first", "2026-01-01T00:00:00.000Z", [
      exercise("bench-press", "Bench Press", [
        { modality: "conventional", reps: 5, externalLoadLb: 100 },
      ]),
    ]);
    const second = session("second", "2026-02-01T00:00:00.000Z", [
      exercise("bench-press", "Bench Press", [
        { modality: "conventional", reps: 5, externalLoadLb: 100 },
      ]),
    ]);
    const records = personalRecords([second, first], "bench-press");
    expect(records.bestConventionalLoadLb).toBe(100);
    expect(records.achievedAt.bestConventionalLoadLb).toBe(first.startedAt);
  });
});

describe("compareExercise", () => {
  it("compares pull-up reps without conventional volume and estimates e1RM from body weight", () => {
    const oldest = session("oldest", "2025-12-01T10:00:00.000Z", [
      exercise("pull-up", "Pull-up", [{ modality: "bodyweight", reps: 10, bodyWeightLb: 152 }]),
    ]);
    const previous = session("previous", "2026-01-01T10:00:00.000Z", [
      exercise("pull-up", "Pull-up", [
        { modality: "bodyweight", reps: 2, bodyWeightLb: 152 },
        { modality: "bodyweight", reps: 1, bodyWeightLb: 152 },
        { modality: "bodyweight", reps: 1, bodyWeightLb: 152 },
      ]),
    ]);
    const other = session("other", "2026-01-04T10:00:00.000Z", [
      exercise("deadlift", "Deadlift", [
        { modality: "conventional", reps: 5, externalLoadLb: 185 },
      ]),
    ]);
    const latest = session("latest", "2026-01-08T10:00:00.000Z", [
      exercise("pull-up", "Pull-up", [
        { modality: "bodyweight", reps: 2, bodyWeightLb: 152 },
        { modality: "bodyweight", reps: 2, bodyWeightLb: 152 },
        { modality: "bodyweight", reps: 1, bodyWeightLb: 152 },
      ]),
    ]);

    const comparison = compareExercise([latest, other, oldest, previous], "pull-up");
    expect(comparison.exerciseId).toBe("pull-up");
    expect(comparison.latest).toMatchObject({
      sessionId: "latest",
      startedAt: latest.startedAt,
      bestReps: 2,
      totalReps: 5,
      bestDurationSec: null,
      conventionalVolumeLb: 0,
      eccentricLoadRepProduct: 0,
      bestExternalLoadLb: null,
    });
    expect(comparison.previous).toMatchObject({
      sessionId: "previous",
      bestReps: 2,
      totalReps: 4,
      conventionalVolumeLb: 0,
    });
    expect(comparison.deltaTotalReps).toBe(1);
    expect(comparison.deltaBestReps).toBe(0);
    expect(comparison.deltaBestDurationSec).toBeNull();
    expect(comparison.deltaConventionalVolumeLb).toBe(0);

    const twoRepEstimate = estimateE1rm(latest.exercises[0]?.sets[0] ?? { modality: "bodyweight" });
    expect(twoRepEstimate.applicable).toBe(true);
    expect(twoRepEstimate.valueLb).toBe(152 * (1 + 2 / 30));

    const records = personalRecords([latest], "pull-up");
    expect(records.bestE1rmLb).toBe(152 * (1 + 2 / 30));
    expect(records.bestReps).toBe(2);
  });

  it("returns null deltas when the exercise has only one session", () => {
    const only = session("only", "2026-01-08T10:00:00.000Z", [
      exercise("pull-up", "Pull-up", [{ modality: "bodyweight", reps: 2, bodyWeightLb: 152 }]),
    ]);
    const comparison = compareExercise([only], "pull-up");
    expect(comparison.latest?.totalReps).toBe(2);
    expect(comparison.previous).toBeNull();
    expect(comparison.deltaTotalReps).toBeNull();
    expect(comparison.deltaBestReps).toBeNull();
    expect(comparison.deltaConventionalVolumeLb).toBeNull();
  });
});

describe("muscleExposure", () => {
  it("credits three pull-up work sets to Back and leaves warm-ups out", () => {
    const exposure = muscleExposure([
      session("pull", "2026-04-01T12:00:00.000Z", [
        exercise("pull-up", "Pull-up", [
          { modality: "bodyweight", reps: 5, bodyWeightLb: 152, isWarmup: true },
          { modality: "bodyweight", reps: 2, bodyWeightLb: 152 },
          { modality: "bodyweight", reps: 2, bodyWeightLb: 152 },
          { modality: "bodyweight", reps: 1, bodyWeightLb: 152 },
        ]),
      ]),
    ]);

    expect(exposure.heuristic).toBe(true);
    expect(exposure.muscles.map((row) => row.muscle)).toEqual([
      "Back",
      "Biceps",
      "Core",
      "Forearms/Grip",
    ]);
    expect(exposure.muscles.find((row) => row.muscle === "Back")).toEqual({
      muscle: "Back",
      direct: 3,
      secondary: 0,
    });
    expect(exposure.muscles.find((row) => row.muscle === "Biceps")).toEqual({
      muscle: "Biceps",
      direct: 0,
      secondary: 1.5,
    });
  });

  it("uses exercise muscle credits when they are provided, including an empty override", () => {
    const custom = muscleExposure([
      session("custom", "2026-04-02T12:00:00.000Z", [
        exercise(
          "pull-up",
          "Pull-up",
          [{ modality: "bodyweight", reps: 3, bodyWeightLb: 152 }],
          [{ muscle: "Lats", role: "direct", credit: 2 }],
        ),
      ]),
    ]);
    expect(custom.muscles).toEqual([{ muscle: "Lats", direct: 2, secondary: 0 }]);

    const cleared = muscleExposure([
      session("cleared", "2026-04-02T12:00:00.000Z", [
        exercise("pull-up", "Pull-up", [{ modality: "bodyweight", reps: 3, bodyWeightLb: 152 }], []),
      ]),
    ]);
    expect(cleared.muscles).toEqual([]);
  });

  it("sums default credits across exercises and honors an inclusive date window", () => {
    const early = session("early", "2026-04-01T12:00:00.000Z", [
      exercise("pull-up", "Pull-up", [{ modality: "bodyweight", reps: 3, bodyWeightLb: 152 }]),
    ]);
    const later = session("later", "2026-04-08T12:00:00.000Z", [
      exercise("deadlift", "Deadlift", [{ modality: "conventional", reps: 5, externalLoadLb: 185 }]),
    ]);
    const exposure = muscleExposure([early, later], later.startedAt, later.startedAt);
    expect(exposure.muscles.find((row) => row.muscle === "Back")).toEqual({
      muscle: "Back",
      direct: 0,
      secondary: 0.3,
    });
    expect(exposure.muscles.find((row) => row.muscle === "Glutes")).toEqual({
      muscle: "Glutes",
      direct: 0.5,
      secondary: 0,
    });
  });

  it("ships the default credit map as a heuristic, not a measured activation model", () => {
    expect(MUSCLE_CREDITS["pull-up"]).toEqual([
      { muscle: "Back", role: "direct", credit: 1 },
      { muscle: "Biceps", role: "secondary", credit: 0.5 },
      { muscle: "Forearms/Grip", role: "secondary", credit: 0.3 },
      { muscle: "Core", role: "secondary", credit: 0.15 },
    ]);
    expect(MUSCLE_CREDITS["dumbbell-shoulder-press"]?.[0]).toEqual({
      muscle: "Delts",
      role: "direct",
      credit: 1,
    });
    expect(MUSCLE_CREDITS["eccentric-calf-raise"]).toEqual([
      { muscle: "Calves", role: "direct", credit: 1 },
    ]);
    expect(MUSCLE_CREDITS.deadlift?.filter((credit) => credit.role === "direct")).toEqual([
      { muscle: "Glutes", role: "direct", credit: 0.5 },
      { muscle: "Hamstrings", role: "direct", credit: 0.5 },
    ]);
    expect(MUSCLE_CREDITS["dead-hang"]?.[0]).toEqual({
      muscle: "Forearms/Grip",
      role: "direct",
      credit: 0.5,
    });
  });
});

describe("overloadSuggestion", () => {
  it("suggests a 5 lb increase after three conventional sets of 12 with RIR 1", () => {
    const ready = session("ready", "2026-05-01T12:00:00.000Z", [
      exercise("squat", "Squat", [
        { modality: "conventional", reps: 3, externalLoadLb: 45, isWarmup: true },
        { modality: "conventional", reps: 12, externalLoadLb: 50, rir: 1 },
        { modality: "conventional", reps: 12, externalLoadLb: 50, rir: 1 },
        { modality: "conventional", reps: 12, externalLoadLb: 50, rir: 1 },
      ]),
    ]);
    const suggestion = overloadSuggestion([ready], "squat");
    expect(suggestion.kind).toBe("load");
    expect(suggestion.loadIncrementLb).toBe(5);
    expect(suggestion.durationIncrementSec).toBeNull();
    expect(suggestion.message).toBe("Add 5 lb.");
  });

  it("repeats the current load when conventional sets stop at 8 reps", () => {
    const short = session("short", "2026-05-01T12:00:00.000Z", [
      exercise("squat", "Squat", [
        { modality: "conventional", reps: 8, externalLoadLb: 50, rir: 1 },
        { modality: "conventional", reps: 8, externalLoadLb: 50, rir: 1 },
        { modality: "conventional", reps: 8, externalLoadLb: 50, rir: 1 },
      ]),
    ]);
    const suggestion = overloadSuggestion([short], "squat");
    expect(suggestion.kind).toBe("repeat");
    expect(suggestion.message).toBe("Repeat the current load.");
    expect(suggestion.loadIncrementLb).toBeNull();
  });

  it("asks for a baseline when the exercise has no history", () => {
    expect(overloadSuggestion([], "squat")).toEqual({
      exerciseId: "squat",
      kind: "baseline",
      message: "Establish a baseline.",
      loadIncrementLb: null,
      durationIncrementSec: null,
    });
  });

  it("treats missing RIR as eligible and RIR 0 as a reason to repeat", () => {
    const sets = (rir: number | null): SetInput[] => [
      { modality: "bodyweight", reps: 12, bodyWeightLb: 152, rir },
      { modality: "bodyweight", reps: 12, bodyWeightLb: 152, rir },
    ];
    const open = overloadSuggestion(
      [session("open", "2026-05-02T12:00:00.000Z", [exercise("pull-up", "Pull-up", sets(null))])],
      "pull-up",
    );
    const failed = overloadSuggestion(
      [session("failed", "2026-05-02T12:00:00.000Z", [exercise("pull-up", "Pull-up", sets(0))])],
      "pull-up",
    );
    expect(open.kind).toBe("load");
    expect(failed.kind).toBe("repeat");
  });

  it("adds eccentric load without calling that an e1RM progression", () => {
    const hit = overloadSuggestion(
      [
        session("ecc", "2026-05-03T12:00:00.000Z", [
          exercise("eccentric-calf-raise", "Eccentric Calf Raise", [
            { modality: "eccentric_only", reps: 12, externalLoadLb: 80 },
            { modality: "eccentric_only", reps: 12, externalLoadLb: 80 },
          ]),
        ]),
      ],
      "eccentric-calf-raise",
    );
    expect(hit.kind).toBe("load");
    expect(hit.loadIncrementLb).toBe(5);
    expect(hit.message).toMatch(/Eccentric work is not an e1RM progression/);

    const miss = overloadSuggestion(
      [
        session("ecc-short", "2026-05-03T12:00:00.000Z", [
          exercise("eccentric-calf-raise", "Eccentric Calf Raise", [
            { modality: "eccentric_only", reps: 8, externalLoadLb: 80 },
          ]),
        ]),
      ],
      "eccentric-calf-raise",
    );
    expect(miss.kind).toBe("repeat");
  });

  it("extends an isometric hold by 5 seconds and does not suggest a load increase", () => {
    const hang = session("hang", "2026-05-04T12:00:00.000Z", [
      exercise("dead-hang", "Dead Hang", [
        { modality: "isometric", durationSec: 40, reps: 12, externalLoadLb: 25 },
      ]),
    ]);
    const met = overloadSuggestion([hang], "dead-hang", { durationTargetSec: 30 });
    expect(met.kind).toBe("duration");
    expect(met.durationIncrementSec).toBe(5);
    expect(met.loadIncrementLb).toBeNull();
    expect(met.message).toMatch(/5 seconds/);
    expect(met.message).not.toMatch(/lb/);

    const unmet = overloadSuggestion([hang], "dead-hang", { durationTargetSec: 60 });
    expect(unmet.kind).toBe("repeat");

    const noTarget = overloadSuggestion([hang], "dead-hang");
    expect(noTarget.kind).toBe("repeat");
  });
});

describe("trainingFrequency", () => {
  it("uses the span between first and last session, with a one-day minimum", () => {
    const start = "2026-06-01T00:00:00.000Z";
    const oneWeekLater = new Date(Date.parse(start) + 7 * 24 * 60 * 60 * 1000).toISOString();
    const outside = "2026-07-01T00:00:00.000Z";

    const week = trainingFrequency(
      [
        session("a", start, []),
        session("b", oneWeekLater, []),
        session("c", outside, []),
      ],
      start,
      oneWeekLater,
    );
    expect(week).toEqual({ sessions: 2, weeks: 1, sessionsPerWeek: 2 });

    const single = trainingFrequency([session("a", start, [])], start, start);
    expect(single.sessions).toBe(1);
    expect(single.weeks).toBeCloseTo(1 / 7);
    expect(single.sessionsPerWeek).toBeCloseTo(7);

    const none = trainingFrequency([], start, oneWeekLater);
    expect(none).toEqual({ sessions: 0, weeks: 1 / 7, sessionsPerWeek: 0 });
  });
});
