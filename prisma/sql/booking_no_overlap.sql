-- Already included at the end of prisma/migrations/*_init/migration.sql. Kept here for reference.
-- It makes the DATABASE reject overlapping bookings for the same technician,
-- even when two requests arrive at the same instant.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_time_valid" CHECK ("endAt" > "startAt");

-- tstzrange is half-open [start, end), so back-to-back bookings (10:00-11:00 then 11:00-12:00) are allowed.
ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_technician_overlap"
  EXCLUDE USING gist (
    "technicianId" WITH =,
    tstzrange("startAt", "endAt") WITH &&
  )
  WHERE ("technicianId" IS NOT NULL AND "status" NOT IN ('CANCELLED', 'NO_SHOW'));
