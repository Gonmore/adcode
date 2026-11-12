-- Manual PostgreSQL constraints/extensions for AdCoDe (apply after initial Prisma migration)
-- Requires PostgreSQL with btree_gist available.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Prevent overlapping reservations for exclusive scenarios in active/held states.
-- Adjust enum values/type names to match the generated Prisma schema if needed.
-- Example (uncomment/adapt after verifying table/column names and status enum):
-- ALTER TABLE "Reservation"
--   ADD CONSTRAINT "reservation_no_overlap_exclusive"
--   EXCLUDE USING gist (
--     "scenarioId" WITH =,
--     tstzrange("startAt", "endAt", '[)') WITH &&
--   )
--   WHERE (
--     status IN ('PENDING_PAYMENT','PENDING_CONFIRMATION','CONFIRMED')
--   );

-- NOTE:
-- 1. The WHERE clause should include only blocking statuses and may need to join/check scenario exclusivity
--    via trigger or denormalized flag depending on final schema design.
-- 2. Add supporting indexes for availability queries:
--    CREATE INDEX IF NOT EXISTS idx_reservation_scenario_time ON "Reservation" ("scenarioId", "startAt", "endAt");
--    CREATE INDEX IF NOT EXISTS idx_reservation_status_hold ON "Reservation" ("status", "holdExpiresAt");
-- 3. Capacity-based (non-exclusive) scenarios must be validated transactionally with advisory locks.
