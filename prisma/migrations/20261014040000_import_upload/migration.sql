ALTER TYPE "ImportStatus" ADD VALUE 'queued';

ALTER TABLE "import_batches" ADD COLUMN "object_key" TEXT;
ALTER TABLE "import_batches" ADD COLUMN "byte_size" INTEGER;
ALTER TABLE "import_batches" ADD COLUMN "content_hash" TEXT;
ALTER TABLE "import_batches" ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "import_batches" ADD COLUMN "locked_at" TIMESTAMP(3);
ALTER TABLE "import_batches" ADD COLUMN "last_error" TEXT;
ALTER TABLE "import_batches" ADD COLUMN "progress" JSONB;

CREATE INDEX "import_batches_status_locked_at_idx" ON "import_batches"("status", "locked_at");
