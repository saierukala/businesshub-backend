<!-- BusinessHub spec part: Availability engine and double-booking prevention -->

## 7. Availability Engine

`GET /availability?serviceId=&date=&area=` returns slots for that day.

For each technician a slot is valid only if:
1. The technician is active and has the skill for the service's category.
2. The technician covers the requested service area.
3. The slot fits inside their working hours for that weekday.
4. The slot does not overlap any of their existing non-cancelled bookings.
5. The slot respects the cutoff rule (not in the past, not less than 2 hours away).
6. The slot does not overlap the technician's `TimeOff`.

**Two modes:** customer mode applies the normal cutoff. Staff mode relaxes only the cutoff (never the past) and can show which technicians are free per slot so the manager can pick one.

**When time off is added** over existing bookings, do not delete or silently move them. Set `needsReassignment = true`, notify the manager, and show them in a "Needs reassignment" queue. The manager reassigns to another qualified free technician or reschedules with the customer.

Return the union of open slots (start/end) and the technicians available for each. The customer sees times only. The manager sees which technicians are free.

Example: hours 09:00–18:00, busy 09:00–10:00, 11:30–12:30, 15:00–16:00, 60-min service → first free start is 10:00, then 12:30, 13:00, 13:30 and so on at 30-minute steps while the slot fits.

Write this as a pure function (inputs: working hours, bookings, duration, rules → slots) so it can be unit tested heavily.

## 8. Double Booking Prevention (the key interview topic)

Layered defence:
1. The availability check before creating (for good UX).
2. **The database constraint, which is the real guarantee.** A PostgreSQL exclusion constraint on Booking using `btree_gist`:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
ADD CONSTRAINT no_technician_overlap
EXCLUDE USING gist (
  "technicianId" WITH =,
  tstzrange("startAt", "endAt") WITH &&
) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND "technicianId" IS NOT NULL);
```

3. Create the booking and assign the technician inside one transaction. If the constraint fails, catch the error (code `23P01`) and return `409 Slot no longer available`.
4. Write a concurrency test that fires two simultaneous booking requests for the same technician and slot and asserts exactly one succeeds.
5. Test the mixed case too: a customer request and a staff request for the same slot at the same time. Exactly one succeeds.

Because customers book before a technician is manually assigned, the booking flow picks an available qualified technician at creation time (the first free one, or the least loaded that day), so the constraint always applies. The manager may reassign, and reassigning goes through the same check.
