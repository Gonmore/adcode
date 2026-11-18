-- CreateEnum
CREATE TYPE "ReservationSeriesStatus" AS ENUM ('ACTIVE', 'IN_ARREARS', 'CANCELLED');

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';

-- CreateTable
CREATE TABLE "ReservationSeries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "complexId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "membershipId" TEXT,
    "clientName" TEXT,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "status" "ReservationSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "debtCount" INTEGER NOT NULL DEFAULT 0,
    "currentReservationId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationSeries_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "reservationSeriesId" TEXT,
ADD COLUMN "seriesDueAt" TIMESTAMP(3),
ADD COLUMN "seriesPaidAt" TIMESTAMP(3),
ADD COLUMN "isSeriesCurrent" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ReservationSeries_code_key" ON "ReservationSeries"("code");
CREATE INDEX "ReservationSeries_complexId_status_idx" ON "ReservationSeries"("complexId", "status");
CREATE INDEX "ReservationSeries_scenarioId_status_idx" ON "ReservationSeries"("scenarioId", "status");
CREATE UNIQUE INDEX "ReservationSeries_currentReservationId_key" ON "ReservationSeries"("currentReservationId");
CREATE INDEX "Reservation_reservationSeriesId_startAt_idx" ON "Reservation"("reservationSeriesId", "startAt");

-- AddForeignKey
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_complexId_fkey" FOREIGN KEY ("complexId") REFERENCES "Complex"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReservationSeries" ADD CONSTRAINT "ReservationSeries_currentReservationId_fkey" FOREIGN KEY ("currentReservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_reservationSeriesId_fkey" FOREIGN KEY ("reservationSeriesId") REFERENCES "ReservationSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
