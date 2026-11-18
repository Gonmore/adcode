-- AlterTable Complex: weekday/weekend hours
ALTER TABLE "Complex" ADD COLUMN IF NOT EXISTS "weekendOpenTime" TEXT;
ALTER TABLE "Complex" ADD COLUMN IF NOT EXISTS "weekendCloseTime" TEXT;

-- AlterTable PricingRule: child price/age threshold + block type
ALTER TABLE "PricingRule" ADD COLUMN IF NOT EXISTS "childPrice" DECIMAL(12,2);
ALTER TABLE "PricingRule" ADD COLUMN IF NOT EXISTS "childAgeThreshold" INTEGER DEFAULT 10;
ALTER TABLE "PricingRule" ADD COLUMN IF NOT EXISTS "blockType" TEXT;
