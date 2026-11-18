-- AlterTable Complex: add weeklySchedule JSON
ALTER TABLE "Complex" ADD COLUMN IF NOT EXISTS "weeklySchedule" JSONB;
