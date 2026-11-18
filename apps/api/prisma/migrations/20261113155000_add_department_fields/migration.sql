-- AlterTable
ALTER TABLE "Complex" ADD COLUMN "department" TEXT NOT NULL DEFAULT 'Santa Cruz';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastDepartment" TEXT;

-- CreateIndex
CREATE INDEX "Complex_department_idx" ON "Complex"("department");
