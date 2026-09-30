# Availability API (Phase 5)

`GET /availability?serviceId=<uuid>&date=YYYY-MM-DD&area=Kondapur`

Roles: Customer, Owner, Manager (technicians get 403). `date` is a calendar day in Asia/Kolkata.
`area` is the area of the address being booked (spelling is normalised like address areas).
The mode comes from the caller's **role**, never from a parameter.

Optional `excludeBookingId=<uuid>`: used when rescheduling. That booking's own current time does not block, so
small shifts (10:00 -> 10:30) are offered. The caller must be allowed to see the booking (someone else's is 404),
and it must be for the same `serviceId` (otherwise 400). Its current start time is still returned as free;
the client should not offer it again.

```json
{
  "date": "2026-10-05",
  "timezone": "Asia/Kolkata",
  "durationMinutes": 60,
  "slots": [
    { "startAt": "2026-10-05T03:30:00.000Z", "endAt": "2026-10-05T04:30:00.000Z" }
  ]
}
```

Staff (Owner/Manager) slots also carry `"technicians": [{ "id", "name" }]`: who is free at that start.
The result is the union over all qualified technicians, one entry per start time. Not paginated: it is
one day of slots (at most ~48), not a list resource.

## Rules (per technician; a slot is offered if any technician passes all six)
1. Technician is active (and so is their user account) and has the skill for the service category.
2. Covers the requested area.
3. Slot fits inside that weekday's working hours (a day off, or no row, means not working).
4. No overlap with non-cancelled, non-no-show bookings. Back-to-back is fine.
5. Cutoff. Customer: start >= now + 2 h. Staff: start >= now (never the past). Days beyond 30 ahead are empty for everyone.
6. No overlap with time off.

Slot starts sit on the 30-minute clock grid (09:00, 09:30, ...); length comes from the service.
Settings (interval, cutoff, max days) are read from `BusinessSettings`.

Errors: 400 bad `serviceId`/`date`/`area`, 401, 403, 404 unknown or inactive service.

## Code
- `src/services/availability.compute.ts`: **pure** function `computeSlots` (no DB, `now` passed in). Unit tests: `availability.compute.test.ts`.
- `src/services/availability.service.ts`: loads technicians, bookings and time off for the day, calls the engine, shapes the response by role.

This is advice for a good UX. The database exclusion constraint is still the real double-booking guarantee (Phase 6).

## Time off over bookings
`POST /technicians/:id/time-off` now flags overlapping active bookings `needsReassignment = true` (never deletes or moves
them) and returns `bookingsNeedingReassignment: <count>`. The notification and the "Needs reassignment" queue come with the
notification and dashboard phases.
