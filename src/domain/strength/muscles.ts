import type { ExercisePerformance, MuscleCredit } from "./types";

/**
 * Default muscle credits keyed by exerciseId.
 * Configurable heuristic for exposure tracking — not a lab measurement of muscle activation.
 * When an exercise performance supplies muscleCredits, those values replace this map.
 */
export const MUSCLE_CREDITS: Record<string, MuscleCredit[]> = {
  "pull-up": [
    { muscle: "Back", role: "direct", credit: 1 },
    { muscle: "Biceps", role: "secondary", credit: 0.5 },
    { muscle: "Forearms/Grip", role: "secondary", credit: 0.3 },
    { muscle: "Core", role: "secondary", credit: 0.15 },
  ],
  "dumbbell-shoulder-press": [
    { muscle: "Delts", role: "direct", credit: 1 },
    { muscle: "Triceps", role: "secondary", credit: 0.5 },
    { muscle: "Chest", role: "secondary", credit: 0.2 },
    { muscle: "Core", role: "secondary", credit: 0.15 },
  ],
  "eccentric-calf-raise": [{ muscle: "Calves", role: "direct", credit: 1 }],
  deadlift: [
    { muscle: "Glutes", role: "direct", credit: 0.5 },
    { muscle: "Hamstrings", role: "direct", credit: 0.5 },
    { muscle: "Back", role: "secondary", credit: 0.3 },
    { muscle: "Forearms/Grip", role: "secondary", credit: 0.25 },
    { muscle: "Core", role: "secondary", credit: 0.25 },
    { muscle: "Quads", role: "secondary", credit: 0.2 },
  ],
  "dead-hang": [
    { muscle: "Forearms/Grip", role: "direct", credit: 0.5 },
    { muscle: "Back", role: "secondary", credit: 0.25 },
    { muscle: "Delts", role: "secondary", credit: 0.15 },
  ],
};

export function resolveMuscleCredits(exercise: ExercisePerformance): MuscleCredit[] {
  if (exercise.muscleCredits) return exercise.muscleCredits;
  return MUSCLE_CREDITS[exercise.exerciseId] ?? [];
}
