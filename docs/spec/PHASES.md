# BusinessHub Build Phases

Work on ONE phase at a time. Read only the spec parts listed for that phase (all in `docs/spec/`), plus `CLAUDE.md`.
Frontend pages for a phase are built after that phase's API is finished and documented.
Each phase ends with: what changed, how to run it, how to test it. Then update "Current phase" in `CLAUDE.md`.

## Phase 1

**Foundation:** repo, TypeScript setup, Express app, Prisma schema, first migration (including `btree_gist` and the exclusion constraint), env handling, pino logging, `/health`, error handler, seed data (HomeFix, categories, services, technicians with skills/areas/hours, demo customer, one login per role).

**Read:** `01-data-model`, `03-availability-and-conflicts` (§8 only), `08-api-audit`

## Phase 2

**Auth and roles:** register/login/logout, cookie JWT, role and ownership middleware, forgot/reset password, email verification, account invite for staff-created customers, tests.

**Read:** `00-core` (§2, §3), `08-api-audit`

## Phase 3

**Catalog, customers and users:** categories, services (owner edits), addresses, appliances, **staff can create/search/edit customers with addresses and appliances (duplicate phone check)**, owner user management (create manager/technician, deactivate).

**Read:** `00-core` (§3), `01-data-model`, `04-booking-flows` (§9b step 1-3)

## Phase 4

**Technicians:** skills, service areas, working hours, **time off**. Manager screens.

**Read:** `01-data-model`, `02-booking-rules`

## Phase 5

**Availability engine:** pure function including time off, customer mode and staff mode, thorough unit tests, endpoint.

**Read:** `02-booking-rules`, `03-availability-and-conflicts` (§7)

## Phase 6

**Bookings (both paths):** one `createBooking` service used by customer and staff, source and createdBy, transaction + exclusion constraint, status transitions, cancel, reschedule, staff overrides with reason, history, audit log, concurrency tests (customer vs customer, customer vs staff).

**Read:** `01-data-model`, `02-booking-rules`, `03-availability-and-conflicts`, `04-booking-flows`

## Phase 7

**Assignment and reassignment:** manager sees qualified free technicians, assigns or reassigns, "Needs reassignment" queue when time off overlaps bookings.

**Read:** `02-booking-rules`, `03-availability-and-conflicts` (§7)

## Phase 8

**Service visits and technician dashboard (mobile-first):** status buttons, diagnosis, work, notes, **extra-charge proposal and approval**, **follow-up booking**.

**Read:** `05-visits-payments`, `02-booking-rules` (§5)

## Phase 9

**Payments and receipts** (cash/UPI first).

**Read:** `05-visits-payments`

## Phase 10

**pg-boss:** notifications, reminders (re-scheduled on reschedule/cancel), review requests, in-app notifications for phone-only customers.

**Read:** `06-notifications`

## Phase 11

**Dashboards and reports** from SQL aggregation.

**Read:** `07-dashboards-reports`

## Phase 12

**Reviews and hardening:** review flow, rate limiting, security headers, error states, loading states.

**Read:** `07-dashboards-reports`, `08-api-audit`

## Phase 13

**Release:** Swagger docs, Playwright E2E for both the customer path and the staff path, GitHub Actions, deployment (Vercel + Render/Railway + Neon/Supabase) with the Next.js rewrite proxy, README with architecture diagram and screenshots, short demo video, seeded demo logins for each role, live link.

**Read:** `09-demo-and-release`, `08-api-audit`

## Phase 14

*(Optional)* Razorpay test mode, refunds and cancellation fees.

**Read:** `05-visits-payments`

**Done means (every phase):** API, DB model, validation, authorization, business rules, frontend integration, loading and error states, tests, short docs. Booking/customer features work for both the customer path and the staff path.
