# Service visits API (Phase 8)

The technician works a booking assigned to them; the customer approves any extra charge; a manager or the technician
can book a follow-up. All changes write `BookingStatusHistory` / `AuditLog`, and money is only computed on the server.

## Technician (role TECHNICIAN, own assigned bookings only; someone else's is 404)
| Method | Path | What |
| --- | --- | --- |
| GET | `/bookings?sort=soonest&from=&to=&status=` | Their jobs (paginated). Filters for other people are ignored |
| GET | `/bookings/:id` | The job: customer name/phone, address, problem, `visit`, history |
| POST | `/bookings/:id/status` | `{ to: "EN_ROUTE" \| "ARRIVED" \| "IN_PROGRESS" }`: one step forward, from `ASSIGNED`. `IN_PROGRESS` opens the visit (`startedAt`) |
| PATCH | `/bookings/:id/visit` | Notes while in progress: `diagnosis, workPerformed, partsNote, notes, result` (send what changed) |
| POST | `/bookings/:id/visit/complete` | Needs `diagnosis` and `workPerformed` (3+ chars). Sets the booking `COMPLETED` and `completedAt` |
| POST | `/bookings/:id/visit/extra-charge` | `{ amount, reason }` (max 2 decimals, > 0). Status `PROPOSED` |
| POST | `/bookings/:id/follow-up` | `{ startAt, serviceId?, problemDescription? }` |
| GET | `/availability?...` | Same as customers (times only), to pick a follow-up slot |

Technicians cannot book, move, cancel, assign or mark no-show (403).

## Extra charge decision (customer for their own booking, or Owner/Manager)
`POST /bookings/:id/visit/extra-charge/decision` `{ decision: "APPROVED" | "DECLINED" }`
- Only while the charge is `PROPOSED` and the work is `IN_PROGRESS` (else 409 `NO_EXTRA_CHARGE_PENDING` / `INVALID_TRANSITION`).
- Stores who decided and when. A manager recording a phone answer is flagged `onBehalfOfCustomer` in the audit log.
- A technician cannot decide (403). A pending charge blocks completing the visit (409 `EXTRA_CHARGE_PENDING`).
- After a decline the technician may propose a new amount. An approved charge cannot be replaced.

## What the booking shows
`GET /bookings/:id` includes `followUpOf: { id, bookingNumber } | null` and
```json
"visit": { "startedAt", "completedAt", "diagnosis", "workPerformed", "partsNote", "notes", "result",
           "extraCharge": { "status": "NONE|PROPOSED|APPROVED|DECLINED", "amount": "250.00", "reason", "decidedAt" },
           "finalAmount": "849.00" }
```
`finalAmount` = service base price + the extra charge **only if approved**. It is the amount to collect (payments: Phase 9).

## Follow-up visit
Owner/Manager or the assigned technician, while the visit is in progress or completed (else 409). Creates a NEW booking with
`followUpOfBookingId`, reusing the customer, appliance, address and source, through the same slot engine and database constraint.
Staff may add `technicianId` (makes it `ASSIGNED`) and `overrideReason` (inside the cutoff). A technician books normal slots.

## Appliance service history
`GET /appliances/:id/history` (customer for their own appliance, or Owner/Manager; paginated): completed visits, newest first, with
date, service, technician, diagnosis, work, `amount` (base + approved extra) and `followUpOf` so connected visits are linked.
