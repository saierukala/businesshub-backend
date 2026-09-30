# Notifications and background jobs (Phase 10)

The booking API only **enqueues** jobs and returns. A separate worker (`npm run worker`, `npm run start:worker` after a build)
takes them off a pg-boss queue (PostgreSQL, schema `pgboss`), saves the in-app notification and sends the email.
If the queue is down the booking still succeeds (the problem is logged). If the worker is off, jobs wait.

## Who is told what
| Event | Customer | Technician | Managers/Owner |
| --- | --- | --- | --- |
| Booking made (any path, follow-ups too) | Confirmed | New job | |
| Technician assigned / changed | Who is coming | New job | |
| Technician removed from a job | | Off the job | |
| Rescheduled | Old and new time | New time | |
| Cancelled | Cancelled | Cancelled | |
| Technician on the way | On the way | | |
| Extra charge asked / answered | Approve in the app | The answer | |
| Visit completed | Total to pay | | |
| Review request (2 h after completion) | How was it? | | |
| Reminders 24 h and 2 h before | Yes | Yes | |
| Time off flagged bookings | | | "N bookings need a new technician" (in-app and email) |

Rescheduling/cancelling notices and the extra-charge messages are additions to the spec's event list: without them a customer would
not know staff moved their visit, or that their approval is waiting.

**Customers without an email** get the in-app note only. There is no SMS or WhatsApp in v1, so every manager and owner gets a
`CALL_CUSTOMER` note ("Call Priya on 9000000011: ..."), and the staff booking page shows a "Phone-only customer: call" banner.
This happens for: confirmed, assigned, rescheduled, cancelled, the 2 h reminder and an extra-charge request.

## Reminders that move or vanish
Each reminder job carries the start time it was made for. When it wakes up it checks the booking: if the visit was moved, or is
cancelled/no-show/completed, it does nothing. A moved booking gets a fresh pair. (Same for the review request: it only goes out
if the booking is still `COMPLETED`.) A reminder whose time has already passed is never created.

## Retries and failures
`retryLimit 5`, 30 s delay with exponential backoff (`RETRY` in `src/jobs/types.ts`). Failures are logged with the job id and attempt.
Jobs are safe to run twice: each notification has a `dedupeKey`, and an email is only sent while `emailedAt` is empty, so a retry
never creates a second in-app note or a second email. A job for a booking that no longer exists is skipped.

## API (every logged-in role reads only their own)
| Method | Path | What |
| --- | --- | --- |
| GET | `/notifications?unread=&page=&pageSize=` | Newest first, with `unread` count: `{ id, type, message, bookingId, read, createdAt }` |
| GET | `/notifications/unread-count` | `{ unread }` |
| POST | `/notifications/:id/read` | Someone else's id is 404 |
| POST | `/notifications/read-all` | |

## Code
`src/jobs/events.ts` (what the booking code calls), `src/jobs/queue.ts` (pg-boss in production, an in-memory list in tests),
`src/jobs/pgboss.ts`, `src/worker.ts`, `src/services/notification.build.ts` (pure: who gets what), `src/services/notification.service.ts`
(saves the rows, sends the emails). Migration `20260930130000_notification_links` adds `bookingId`, `dedupeKey` and `emailedAt`.

## Not in v1
SMS/WhatsApp, per-user notification settings, email templates in HTML, unsubscribe links.
