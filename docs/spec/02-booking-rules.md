<!-- BusinessHub spec part: Booking status lifecycle and scheduling rules -->

## 5. Booking Status Lifecycle

`PENDING → CONFIRMED → ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED`

Side exits: `CANCELLED` (from PENDING, CONFIRMED, ASSIGNED) and `NO_SHOW` (from ASSIGNED, EN_ROUTE, ARRIVED).

- Enforce allowed transitions in one place (a transition map in the booking service). Invalid transitions return 409.
- Technicians can only move their own booking forward: EN_ROUTE, ARRIVED, IN_PROGRESS, COMPLETED.
- Every change writes a `BookingStatusHistory` row and an `AuditLog` row.
- A customer booking starts as PENDING. It becomes CONFIRMED automatically if a technician is auto-suggested and accepted, or when a manager confirms. **Simple default:** customer books, a slot with an available qualified technician is required, booking is CONFIRMED immediately, and the manager assigns (or changes) the technician, which moves it to ASSIGNED.

## 6. Scheduling Rules (defaults — store in BusinessSettings)

- Timezone: `Asia/Kolkata`. All business rules computed on the server with a timezone library (Luxon or date-fns-tz). Never use the browser's timezone for rules.
- Working days: Mon–Sat, 09:00–18:00 (per-technician override via WorkingHours).
- Slot start interval: 30 minutes.
- Service duration comes from the Service.
- Booking cutoff: at least 2 hours before start. Maximum 30 days ahead.
- Cancellation: free until 4 hours before start.
- Rescheduling: until 4 hours before start, maximum 2 times.
- Technician **time off** (sick/leave) is in v1 via `TimeOff`. Out of scope: breaks, public-holiday calendar, travel time between jobs (documented as future work).
- **Staff overrides (Owner/Manager only, always audit-logged with a reason):** book inside the 2-hour cutoff (e.g. urgent same-day), and cancel or reschedule inside the 4-hour window or past the reschedule limit. Staff can **never** override technician conflicts, skills, working hours or time off. The database constraint still applies.
