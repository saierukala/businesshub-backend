# Bookings API (Phase 6)

Customers, Owner and Manager use the same endpoints (technicians get 403 until Phase 8). One service
(`booking.service.ts`) handles both paths: the customer is worked out from the caller's role.

| Method | Path | Who | What |
| --- | --- | --- | --- |
| GET | `/bookings` | all | Paginated. Customers see only their own. Staff filters: `status`, `customerId`, `technicianId`, `needsReassignment`, `from`, `to` (IST days, inclusive) |
| GET | `/bookings/:id` | owner of booking, staff | Detail + status `history` (`changedBy` shown to staff only) |
| POST | `/bookings` | customer, staff | Create |
| POST | `/bookings/:id/reschedule` | customer (own), staff | `{ startAt, overrideReason? }` |
| POST | `/bookings/:id/cancel` | customer (own), staff | `{ reason?, overrideReason? }` |
| POST | `/bookings/:id/no-show` | staff | `{ note? }` from ASSIGNED / EN_ROUTE / ARRIVED |

## Create
```json
{ "applianceId": "", "serviceId": "", "addressId": "", "problemDescription": "Not cooling",
  "startAt": "2026-10-05T10:00:00+05:30" }
```
`startAt` must be exactly a start time returned by `GET /availability` for that service and address area.

Staff add: `customerId` (required), `source` (`PHONE|WHATSAPP|WALK_IN`, required), `technicianId` (optional), `overrideReason`.
A customer's `customerId` is ignored; `technicianId`, `source` or `overrideReason` from a customer is 403.

- Auto-picked technician (fewest bookings that day) -> status `CONFIRMED`. A technician chosen by staff -> `ASSIGNED`.
- The appliance and address must belong to that customer, and the service must match the appliance's category.
- `bookingNumber` is `BH-<year>-00001`, per IST year.

## Rules
- **Double booking:** the availability check gives a friendly error; the database `EXCLUDE` constraint is the guarantee.
  If it rejects our pick (`23P01`) the next free technician is tried; if none is left: `409 SLOT_UNAVAILABLE`.
- **Overrides (staff only, reason required, audit-logged):** booking inside the 2-hour cutoff; cancelling or rescheduling inside
  4 hours; rescheduling past 2 times. Staff can **never** override technician conflicts, skills, hours, time off or the past.
- **Customers:** cancel/reschedule own bookings only (someone else's is 404). Refused with `CANCELLATION_WINDOW_CLOSED`,
  `RESCHEDULE_WINDOW_CLOSED` or `RESCHEDULE_LIMIT_REACHED` (409).
- **Reschedule** keeps the same booking, increments `rescheduleCount`, writes old and new time to history and audit, and clears
  `needsReassignment`. A manager-assigned technician is kept or the move fails (409).
- **Transitions** live in one map (`booking.status.ts`); invalid moves are `409 INVALID_TRANSITION`. Every change writes
  `BookingStatusHistory` and `AuditLog`.

## Errors
400 validation / `OVERRIDE_REASON_REQUIRED`; 403 staff-only field or role; 404 not found or not yours;
409 `SLOT_UNAVAILABLE`, `INVALID_TRANSITION`, `CANCELLATION_WINDOW_CLOSED`, `RESCHEDULE_WINDOW_CLOSED`, `RESCHEDULE_LIMIT_REACHED`.

## Not in this phase
Confirming PENDING bookings and assigning/reassigning technicians (Phase 7), technician status buttons (Phase 8),
notifications (customer email / manager "contact by phone" note).
