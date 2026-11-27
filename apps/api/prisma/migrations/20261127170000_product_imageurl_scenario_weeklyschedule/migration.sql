-- Add Product.imageUrl and Scenario.weeklySchedule (idempotent for production deploy)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Scenario" ADD COLUMN IF NOT EXISTS "weeklySchedule" JSONB;
