ALTER TABLE "workout_exercises" DROP CONSTRAINT "workout_exercises_exercise_id_fkey";
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
