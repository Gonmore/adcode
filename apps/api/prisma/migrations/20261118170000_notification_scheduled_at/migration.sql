-- AlterTable Notification: add scheduledAt
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Notification_userId_scheduledAt_idx" ON "Notification"("userId", "scheduledAt");
