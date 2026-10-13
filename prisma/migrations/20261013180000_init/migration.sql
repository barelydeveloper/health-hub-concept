-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ValueOrigin" AS ENUM ('measured', 'user_entered', 'imported', 'estimated', 'hydration_normalized', 'forecast', 'fixture');

-- CreateEnum
CREATE TYPE "SourceSystem" AS ENUM ('manual', 'samsung_health', 'fixture', 'api', 'calculation');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('female', 'male', 'unspecified');

-- CreateEnum
CREATE TYPE "SetModality" AS ENUM ('conventional', 'eccentric_only', 'isometric', 'assisted', 'bodyweight', 'weighted_bodyweight');

-- CreateEnum
CREATE TYPE "LoadModel" AS ENUM ('external', 'bodyweight', 'weighted_bodyweight', 'assisted', 'isometric_duration', 'eccentric_only');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('left', 'right', 'both');

-- CreateEnum
CREATE TYPE "BodyMetricKind" AS ENUM ('weight', 'body_fat_percent', 'fat_mass', 'fat_free_mass', 'skeletal_muscle');

-- CreateEnum
CREATE TYPE "CircumferenceSite" AS ENUM ('neck', 'chest', 'waist', 'hips', 'thigh_left', 'thigh_right', 'upper_arm_left', 'upper_arm_right', 'other');

-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('weight', 'body_fat_percent', 'fat_mass', 'circumference', 'pull_up_reps', 'hold_duration', 'dumbbell_press_weight', 'deadlift_weight', 'training_frequency', 'calories', 'protein', 'custom');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('active', 'achieved', 'paused', 'abandoned');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending', 'running', 'completed', 'completed_with_errors', 'failed');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'correct', 'delete', 'import', 'login', 'token_create', 'token_revoke');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "height_inches" DECIMAL(6,2),
    "sex" "Sex" NOT NULL DEFAULT 'unspecified',
    "birth_date" DATE,
    "max_heart_rate" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "notes" TEXT,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "actor_token_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "idempotency_key" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_system" "SourceSystem" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "label" TEXT,
    "summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_files" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supported" BOOLEAN NOT NULL,
    "dataset" TEXT,
    "byte_size" INTEGER,
    "content_hash" TEXT,
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_accepted" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_errors" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "row" INTEGER,
    "message" TEXT NOT NULL,

    CONSTRAINT "import_row_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_system" "SourceSystem" NOT NULL,
    "cursor" TEXT,
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_payloads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_payloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_metrics" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "BodyMetricKind" NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "canonical_unit" TEXT NOT NULL,
    "original_value" DECIMAL(12,4),
    "original_unit" TEXT,
    "value_origin" "ValueOrigin" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "reading_group_id" TEXT,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "source_payload_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_water_readings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value_lb" DECIMAL(10,3) NOT NULL,
    "original_value" DECIMAL(12,4),
    "original_unit" TEXT,
    "value_origin" "ValueOrigin" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "reading_group_id" TEXT,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "source_payload_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "body_water_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circumference_readings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "site" "CircumferenceSite" NOT NULL,
    "site_label" TEXT,
    "value_inches" DECIMAL(8,3) NOT NULL,
    "original_value" DECIMAL(10,4),
    "original_unit" TEXT,
    "value_origin" "ValueOrigin" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "reading_group_id" TEXT,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circumference_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modality" "SetModality" NOT NULL,
    "load_model" "LoadModel" NOT NULL,
    "muscle_credits" JSONB NOT NULL,
    "allow_e1rm" BOOLEAN NOT NULL DEFAULT false,
    "equipment" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_aliases" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "exercise_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "name" TEXT,
    "notes" TEXT,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "value_origin" "ValueOrigin" NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_exercises" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "workout_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sets" (
    "id" TEXT NOT NULL,
    "workout_exercise_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "modality" "SetModality" NOT NULL,
    "reps" INTEGER,
    "duration_sec" DECIMAL(8,2),
    "external_load_lb" DECIMAL(8,2),
    "added_load_lb" DECIMAL(8,2),
    "assistance_lb" DECIMAL(8,2),
    "body_weight_lb" DECIMAL(8,2),
    "rpe" DECIMAL(4,2),
    "rir" DECIMAL(4,2),
    "side" "Side",
    "is_warmup" BOOLEAN NOT NULL DEFAULT false,
    "tempo" TEXT,
    "effort" TEXT,
    "notes" TEXT,
    "source_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "serving_grams" DECIMAL(8,2),
    "calories" DECIMAL(8,2),
    "protein_g" DECIMAL(8,2),
    "carb_g" DECIMAL(8,2),
    "fat_g" DECIMAL(8,2),
    "fiber_g" DECIMAL(8,2),
    "source_system" "SourceSystem" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "food_id" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "calories" DECIMAL(8,2),
    "protein_g" DECIMAL(8,2),
    "carb_g" DECIMAL(8,2),
    "fat_g" DECIMAL(8,2),
    "fiber_g" DECIMAL(8,2),
    "sodium_mg" DECIMAL(8,2),
    "quantity" DECIMAL(8,3),
    "meal" TEXT,
    "value_origin" "ValueOrigin" NOT NULL,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_nutrition_summaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "calories" DECIMAL(8,2) NOT NULL,
    "protein_g" DECIMAL(8,2) NOT NULL,
    "carb_g" DECIMAL(8,2) NOT NULL,
    "fat_g" DECIMAL(8,2) NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_nutrition_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_days" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recorded_on" DATE NOT NULL,
    "steps" INTEGER,
    "active_calories" DECIMAL(8,2),
    "workout_minutes" DECIMAL(8,2),
    "distance_mi" DECIMAL(8,3),
    "heart_rate_avg" DECIMAL(6,2),
    "value_origin" "ValueOrigin" NOT NULL,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_hours" DECIMAL(6,3) NOT NULL,
    "stages" JSONB,
    "value_origin" "ValueOrigin" NOT NULL,
    "source_system" "SourceSystem" NOT NULL,
    "source_id" TEXT,
    "supersedes_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sleep_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "GoalType" NOT NULL,
    "name" TEXT NOT NULL,
    "target_value" DECIMAL(10,3) NOT NULL,
    "target_high" DECIMAL(10,3),
    "target_unit" TEXT NOT NULL,
    "target_date" TIMESTAMP(3),
    "direction" TEXT,
    "circumference_site" "CircumferenceSite",
    "exercise_slug" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'active',
    "source_system" "SourceSystem" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_checkpoints" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "goal_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_versions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "achieved_at" TIMESTAMP(3) NOT NULL,
    "set_id" TEXT,
    "calculation_version" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_scenarios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assumptions" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_key_key" ON "idempotency_keys"("user_id", "key");

-- CreateIndex
CREATE INDEX "import_batches_user_id_started_at_idx" ON "import_batches"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "import_files_batch_id_idx" ON "import_files"("batch_id");

-- CreateIndex
CREATE INDEX "import_row_errors_batch_id_idx" ON "import_row_errors"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoints_user_id_source_system_key" ON "sync_checkpoints"("user_id", "source_system");

-- CreateIndex
CREATE INDEX "source_payloads_user_id_source_system_source_id_idx" ON "source_payloads"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "body_metrics_user_id_kind_recorded_at_idx" ON "body_metrics"("user_id", "kind", "recorded_at");

-- CreateIndex
CREATE INDEX "body_metrics_user_id_source_system_source_id_idx" ON "body_metrics"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "body_water_readings_user_id_recorded_at_idx" ON "body_water_readings"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "body_water_readings_user_id_source_system_source_id_idx" ON "body_water_readings"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "circumference_readings_user_id_site_recorded_at_idx" ON "circumference_readings"("user_id", "site", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_user_id_slug_key" ON "exercises"("user_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_aliases_exercise_id_alias_key" ON "exercise_aliases"("exercise_id", "alias");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_started_at_idx" ON "workout_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "workout_sessions_user_id_source_system_source_id_idx" ON "workout_sessions"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "workout_exercises_session_id_idx" ON "workout_exercises"("session_id");

-- CreateIndex
CREATE INDEX "workout_exercises_exercise_id_idx" ON "workout_exercises"("exercise_id");

-- CreateIndex
CREATE INDEX "workout_sets_workout_exercise_id_position_idx" ON "workout_sets"("workout_exercise_id", "position");

-- CreateIndex
CREATE INDEX "foods_user_id_name_idx" ON "foods"("user_id", "name");

-- CreateIndex
CREATE INDEX "nutrition_entries_user_id_recorded_at_idx" ON "nutrition_entries"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "nutrition_entries_user_id_source_system_source_id_idx" ON "nutrition_entries"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_nutrition_summaries_user_id_date_calculation_version_key" ON "daily_nutrition_summaries"("user_id", "date", "calculation_version");

-- CreateIndex
CREATE INDEX "activity_days_user_id_recorded_on_idx" ON "activity_days"("user_id", "recorded_on");

-- CreateIndex
CREATE INDEX "activity_days_user_id_source_system_source_id_idx" ON "activity_days"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "sleep_sessions_user_id_started_at_idx" ON "sleep_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "sleep_sessions_user_id_source_system_source_id_idx" ON "sleep_sessions"("user_id", "source_system", "source_id");

-- CreateIndex
CREATE INDEX "goals_user_id_status_idx" ON "goals"("user_id", "status");

-- CreateIndex
CREATE INDEX "goal_checkpoints_goal_id_recorded_at_idx" ON "goal_checkpoints"("goal_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "calculation_versions_key_version_key" ON "calculation_versions"("key", "version");

-- CreateIndex
CREATE INDEX "metric_snapshots_user_id_calculation_version_computed_at_idx" ON "metric_snapshots"("user_id", "calculation_version", "computed_at");

-- CreateIndex
CREATE INDEX "personal_records_user_id_exercise_id_kind_idx" ON "personal_records"("user_id", "exercise_id", "kind");

-- CreateIndex
CREATE INDEX "forecast_scenarios_user_id_calculated_at_idx" ON "forecast_scenarios"("user_id", "calculated_at");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_errors" ADD CONSTRAINT "import_row_errors_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_payloads" ADD CONSTRAINT "source_payloads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_payloads" ADD CONSTRAINT "source_payloads_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_water_readings" ADD CONSTRAINT "body_water_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "circumference_readings" ADD CONSTRAINT "circumference_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "workout_exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foods" ADD CONSTRAINT "foods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_entries" ADD CONSTRAINT "nutrition_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_entries" ADD CONSTRAINT "nutrition_entries_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_nutrition_summaries" ADD CONSTRAINT "daily_nutrition_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_days" ADD CONSTRAINT "activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_sessions" ADD CONSTRAINT "sleep_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_checkpoints" ADD CONSTRAINT "goal_checkpoints_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calculation_versions" ADD CONSTRAINT "calculation_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_records" ADD CONSTRAINT "personal_records_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_scenarios" ADD CONSTRAINT "forecast_scenarios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Active source identity. Corrections supersede the prior row instead of overwriting it.
CREATE UNIQUE INDEX "body_metrics_active_source" ON "body_metrics" ("user_id", "source_system", "source_id", "kind")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "body_water_active_source" ON "body_water_readings" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "circumference_active_source" ON "circumference_readings" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "workout_sessions_active_source" ON "workout_sessions" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "nutrition_active_source" ON "nutrition_entries" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "activity_active_source" ON "activity_days" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "sleep_active_source" ON "sleep_sessions" ("user_id", "source_system", "source_id")
WHERE "source_id" IS NOT NULL AND "superseded_at" IS NULL AND "deleted_at" IS NULL;
