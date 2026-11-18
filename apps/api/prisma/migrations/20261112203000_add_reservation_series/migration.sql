-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "seriesId" TEXT;

-- CreateIndex
CREATE INDEX "Reservation_seriesId_idx" ON "Reservation"("seriesId");
