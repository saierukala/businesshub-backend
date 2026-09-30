<!-- BusinessHub spec part: API rules and audit logs -->

## 13. API Rules

- Validate every request body, query and param with Zod.
- Consistent error shape: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "...", "details": [] } }`.
- Pagination on all list endpoints (`page`, `pageSize`).
- Thin controllers, business logic in service files, database access in one layer.
- Security basics: helmet, CORS limited to the frontend origin, rate limiting on auth routes, bcrypt, no secrets in the repo, no stack traces in production responses.
- Route groups: `/auth`, `/users`, `/business`, `/service-categories`, `/services`, `/customers`, `/addresses`, `/appliances`, `/technicians`, `/availability`, `/bookings`, `/service-visits`, `/payments`, `/notifications`, `/reviews`, `/reports`, `/audit-logs`, `/technicians/:id/time-off`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/health`.
- `POST /bookings` accepts `customerId` only from Owner/Manager. For customers it is ignored and taken from the session.
- Write the OpenAPI contract for a module before building its frontend.

## 14. Audit Logs

Log: booking created (with source and who created it), staff overrides (with reason), time off added, booking flagged for reassignment, confirmed, cancelled, rescheduled, technician assigned or changed, status changed, payment recorded, service completed, customer updated. Store who did it, what, which entity and when. Owner can view and filter them.
