# BusinessHub — Appliance Repair Booking & Field-Service App

## 1. Identity

- **Project:** BusinessHub (separate from PulseOps — never reuse PulseOps modules, inventory, multi-tenancy or roadmap)
- **Type:** Single-business appliance repair booking and field-service management web app
- **Demo business:** HomeFix Appliance Services, Hyderabad, India
- **Core idea:** booking + availability engine. Not inventory, not ERP.
- **Goals:** fully working portfolio project (resume + LinkedIn) and a way to learn Node.js, Express, PostgreSQL and Next.js properly.

**Guiding rules**
1. Keep it simple. Prefer the boring, well-known solution.
2. Correctness of the booking lifecycle beats number of features.
3. Backend is the source of truth. The frontend never decides availability.
4. No Docker, no Redis, no microservices. Everything runs locally with Node + PostgreSQL.

---

## 2. Tech Stack (final — do not change without asking)

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS, TanStack Query, React Hook Form, Zod |
| Backend | Node.js, Express, TypeScript, Zod validation |
| Database | PostgreSQL |
| ORM / migrations | Prisma for normal CRUD and migrations, plus raw SQL migrations for constraints Prisma can't express |
| Auth | Email + password (bcrypt), JWT in httpOnly cookies, role-based middleware, forgot-password and email verification via one-time tokens |
| Background jobs | **pg-boss** (queue stored in PostgreSQL, no Redis) |
| Email | Nodemailer (Ethereal/console in dev, Resend or Gmail SMTP optional later) |
| Logging | pino (structured logs) plus a `GET /health` endpoint |
| Payments | Cash/UPI recorded manually first; Razorpay Test Mode as a later phase |
| API docs | OpenAPI/Swagger (swagger-ui-express) |
| Testing | Vitest/Jest + Supertest (backend), React Testing Library (frontend), Playwright (one E2E happy path) |
| CI | GitHub Actions (lint, typecheck, test) |
| Deploy (for the live link) | Frontend on Vercel, backend on Render or Railway, database on Neon or Supabase. Frontend and backend are on different domains, so proxy API calls through Next.js `rewrites` (`/api/*` → backend) to keep cookies same-domain |

**Repo layout:** one repo, two folders: `/backend` and `/frontend`, plus `/docs`. No Docker files anywhere. Setup must be: install Node, install PostgreSQL (or create a free Neon DB), copy `.env.example` to `.env`, then `npm install`, `npx prisma migrate dev`, `npm run seed`, `npm run dev`.

---

## 3. Roles

- **Owner:** everything, including business settings, creating staff/technician accounts, deactivating users, services, reports, audit logs, and creating or managing bookings for any customer.
- **Service Manager:** dashboard, technician assignment, technicians, schedules, service visits, reports, and full booking management including **creating, rescheduling and cancelling bookings on behalf of customers** (phone, WhatsApp, walk-in). Creates and edits customer records. No owner-only settings.
- **Technician:** only their own assigned bookings. Sees the customer name, phone, address and appliance needed for the job. Updates status, records diagnosis, work performed and notes.
- **Customer:** own profile, addresses, appliances, bookings, payments, history and reviews only. Reschedules and cancels eligible bookings.

Every endpoint checks authentication, role and (for customers/technicians) ownership.

**Two ways to book (both are first-class):**
- **Customer self-service:** the customer books online for themselves.
- **Staff booking (Owner/Manager):** staff search or create the customer, pick their appliance and address, and book for them. Needed because real customers call or WhatsApp.

Both paths use the **same booking service function, same validation, same availability engine and same database constraint**. Only the "acting user", the source and a few permitted overrides differ (see sections 6 and 9).

**Customers created by staff** may have no email and no password (phone-only). They are real customer records with appliances, addresses, bookings and history. If an email is added later, the customer can claim the account through the forgot-password / invite email flow, and all earlier history is already attached.

---

## 4. Data Model (PostgreSQL)

Use UUID or serial ids, `createdAt`/`updatedAt` on everything, and store all timestamps as `timestamptz` in UTC.

- **User:** id, name, email (unique, nullable for phone-only customers), phone, passwordHash (nullable for customers created by staff), role, active, emailVerifiedAt, createdByUserId
- **Address:** id, customerId, label, line1, area (e.g. Kondapur), city, pincode
- **ServiceCategory:** id, name (Washing Machine, Refrigerator, AC, Microwave, Dishwasher, Water Purifier, TV)
- **Service:** id, categoryId, name, description, durationMinutes, basePrice, active
- **Appliance:** id, customerId, categoryId, brand, model, serialNumber, purchaseYear, description
- **Technician:** id, userId, phone, status
- **TechnicianSkill:** technicianId, categoryId (unique pair)
- **TechnicianServiceArea:** technicianId, area
- **WorkingHours:** technicianId, dayOfWeek (0–6), startTime, endTime, isOff
- **TimeOff:** id, technicianId, startAt, endAt, reason (sick, leave, other), createdByUserId
- **Booking:** id, bookingNumber (BH-YYYY-00001), customerId, applianceId, serviceId, addressId, technicianId (nullable until assigned), problemDescription, startAt, endAt, status, source (ONLINE, PHONE, WHATSAPP, WALK_IN), createdByUserId (customer or staff who made it), followUpOfBookingId (nullable), rescheduleCount, needsReassignment (boolean), createdAt
- **BookingStatusHistory:** bookingId, fromStatus, toStatus, changedByUserId, note, createdAt
- **ServiceVisit:** id, bookingId (unique), technicianId, diagnosis, workPerformed, partsNote, notes, result, extraChargeAmount, extraChargeReason, extraChargeStatus (NONE, PROPOSED, APPROVED, DECLINED), extraChargeDecidedByUserId, extraChargeDecidedAt, startedAt, completedAt
- **Payment:** id, bookingId, amount, method (CASH/UPI/CARD/ONLINE), status, providerRef, paidAt
- **Review:** id, bookingId (unique), customerId, rating (1–5), comment
- **Notification:** id, userId, type, message, readAt, createdAt
- **AuthToken:** id, userId, type (PASSWORD_RESET, EMAIL_VERIFY, ACCOUNT_INVITE), tokenHash, expiresAt, usedAt
- **AuditLog:** id, userId, action, entityType, entityId, metadata (JSON), createdAt
- **BusinessSettings:** single row with the scheduling rules below

Rescheduling: keep the same booking, record old and new times in `BookingStatusHistory` and `AuditLog`, and increment a `rescheduleCount`. Never silently overwrite history.

---

## 5. Booking Status Lifecycle

`PENDING → CONFIRMED → ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED`

Side exits: `CANCELLED` (from PENDING, CONFIRMED, ASSIGNED) and `NO_SHOW` (from ASSIGNED, EN_ROUTE, ARRIVED).

- Enforce allowed transitions in one place (a transition map in the booking service). Invalid transitions return 409.
- Technicians can only move their own booking forward: EN_ROUTE, ARRIVED, IN_PROGRESS, COMPLETED.
- Every change writes a `BookingStatusHistory` row and an `AuditLog` row.
- A customer booking starts as PENDING. It becomes CONFIRMED automatically if a technician is auto-suggested and accepted, or when a manager confirms. **Simple default:** customer books, a slot with an available qualified technician is required, booking is CONFIRMED immediately, and the manager assigns (or changes) the technician, which moves it to ASSIGNED.

---

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

---

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

---

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

---

## 9. Booking Flows (Customer and Staff)

### 9a. Customer self-service

1. Choose appliance category, then an existing appliance or add a new one.
2. Describe the problem.
3. Choose the service (name, base price, duration).
4. Choose an existing address or add one.
5. Choose a date, then a slot returned by the backend.
6. Review the summary and confirm.
7. Backend re-validates everything (ownership, service active, availability, rules) and creates the booking in a transaction.

The customer must never re-enter appliance details for later bookings.

### 9b. Staff booking on behalf of a customer (Owner/Manager)

1. Search customer by name or phone. If none exists, create one (name and phone required, email optional). Warn on duplicate phone.
2. Choose the customer's existing appliance or add a new one for them.
3. Describe the problem, choose the service, choose or add the customer's address.
4. Choose date and slot (staff availability mode), optionally choose a specific technician from those free for that slot.
5. Choose the source (PHONE, WHATSAPP, WALK_IN) and confirm.
6. The backend runs the **same** `createBooking` service as the customer flow. It records `createdByUserId` = the staff user, the source, and an audit log entry.

Staff can also reschedule, cancel and mark no-show for any booking. Customers can only act on their own.

### 9c. Shared rules
- One `createBooking` / `rescheduleBooking` / `cancelBooking` service. Controllers only pass the acting user and the target customer.
- Customers can never pass another `customerId`. Staff must.
- Notifications go to the customer by email if they have one. Otherwise an in-app record is created and the manager sees "contact customer by phone" on the booking.

---

## 10. Service Visit, History and Payment

- The **booking** is the appointment. The **service visit** records what happened (diagnosis, work performed, result).
- Completing a visit requires diagnosis and work performed. Completion sets the booking to COMPLETED.
- **Service history** for an appliance = its completed visits with date, service, amount, technician.
- **Payment:** technician or manager records the final amount (base price + additional charge) and method. Store the payment, generate a simple receipt (HTML or PDF) and mark it paid. Payment state is only ever changed server-side.
- **Extra charge approval:** if the technician finds extra work, they record an amount and reason (status PROPOSED). The customer approves or declines in the app, or the manager records the customer's decision taken by phone (APPROVED/DECLINED, with who decided). Work beyond the base service proceeds only when APPROVED. The final payment amount = base price + approved extra charge.
- **Follow-up visit:** if a repair needs a second visit, the manager (or technician) creates a new booking linked with `followUpOfBookingId`. It reuses the same customer, appliance and address, and shows in the appliance history as connected.
- **Razorpay (later phase):** create order on the backend, verify the payment signature on the backend, and verify webhook signatures. Never trust the client.

---

## 11. Notifications and Background Jobs (pg-boss)

Events: booking confirmed, technician assigned, reminder (e.g. 24h and 2h before), technician en route, service completed, review request after completion.

- Store in-app notifications in the `Notification` table and send emails through jobs.
- The booking API only enqueues jobs, then returns immediately.
- Scheduled reminder jobs are cancelled or re-scheduled when a booking is cancelled or rescheduled.
- Failed jobs retry with backoff. Failures are logged.
- The worker runs as a separate npm script (`npm run worker`) in the same backend codebase.
- Customers without email get in-app notifications only. There is no SMS or WhatsApp sending in v1 (future work), so the manager sees a "call customer" flag instead.

---

## 12. Dashboards and Reports

Everything comes from real database queries (SQL aggregation, not browser-side calculation). No fake numbers once data exists.

- **Customer:** upcoming appointment and status, my appliances, recent history, payments, reviews.
- **Technician:** today's appointments with status buttons (En Route, Arrived, Start, Complete) and a notes form.
- **Owner/Manager:** today's bookings by status, pending assignments, bookings needing reassignment, available technicians, revenue today and this month, popular services, booking trend, bookings by source, technician workload.
- **UI requirements:** technician screens are designed **mobile-first** (large buttons, one-hand use). Customer and manager screens are responsive. Staff screens include user management (owner creates managers/technicians, deactivates users) and service catalog editing.
- **Reports:** booking report (total, completed, cancelled, no-show, rescheduled), revenue (daily/weekly/monthly), service report, technician report. Date range filters and pagination.

---

## 13. API Rules

- Validate every request body, query and param with Zod.
- Consistent error shape: `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "...", "details": [] } }`.
- Pagination on all list endpoints (`page`, `pageSize`).
- Thin controllers, business logic in service files, database access in one layer.
- Security basics: helmet, CORS limited to the frontend origin, rate limiting on auth routes, bcrypt, no secrets in the repo, no stack traces in production responses.
- Route groups: `/auth`, `/users`, `/business`, `/service-categories`, `/services`, `/customers`, `/addresses`, `/appliances`, `/technicians`, `/availability`, `/bookings`, `/service-visits`, `/payments`, `/notifications`, `/reviews`, `/reports`, `/audit-logs`, `/technicians/:id/time-off`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/health`.
- `POST /bookings` accepts `customerId` only from Owner/Manager. For customers it is ignored and taken from the session.
- Write the OpenAPI contract for a module before building its frontend.

---

## 14. Audit Logs

Log: booking created (with source and who created it), staff overrides (with reason), time off added, booking flagged for reassignment, confirmed, cancelled, rescheduled, technician assigned or changed, status changed, payment recorded, service completed, customer updated. Store who did it, what, which entity and when. Owner can view and filter them.

---

## 15. Not Included

Warehouse, inventory, stock ledger, purchase orders, suppliers, product catalog, sales orders, procurement, multi-tenancy, manufacturing, accounting, Docker, Redis. If a technician replaces a part, it is just text in the service visit (`partsNote`).

**Deliberately skipped in v1:** photo uploads, WebSockets (polling is fine), GST invoices, travel-time optimization, SMS/WhatsApp sending, multi-language, native mobile apps, refunds and cancellation fees (added with Razorpay).

---

## 16. Build Phases (one at a time, each ends with a working, tested result)

1. **Foundation:** repo, TypeScript setup, Express app, Prisma schema, first migration (including `btree_gist` and the exclusion constraint), env handling, pino logging, `/health`, error handler, seed data (HomeFix, categories, services, technicians with skills/areas/hours, demo customer, one login per role).
2. **Auth and roles:** register/login/logout, cookie JWT, role and ownership middleware, forgot/reset password, email verification, account invite for staff-created customers, tests.
3. **Catalog, customers and users:** categories, services (owner edits), addresses, appliances, **staff can create/search/edit customers with addresses and appliances (duplicate phone check)**, owner user management (create manager/technician, deactivate).
4. **Technicians:** skills, service areas, working hours, **time off**. Manager screens.
5. **Availability engine:** pure function including time off, customer mode and staff mode, thorough unit tests, endpoint.
6. **Bookings (both paths):** one `createBooking` service used by customer and staff, source and createdBy, transaction + exclusion constraint, status transitions, cancel, reschedule, staff overrides with reason, history, audit log, concurrency tests (customer vs customer, customer vs staff).
7. **Assignment and reassignment:** manager sees qualified free technicians, assigns or reassigns, "Needs reassignment" queue when time off overlaps bookings.
8. **Service visits and technician dashboard (mobile-first):** status buttons, diagnosis, work, notes, **extra-charge proposal and approval**, **follow-up booking**.
9. **Payments and receipts** (cash/UPI first).
10. **pg-boss:** notifications, reminders (re-scheduled on reschedule/cancel), review requests, in-app notifications for phone-only customers.
11. **Dashboards and reports** from SQL aggregation.
12. **Reviews and hardening:** review flow, rate limiting, security headers, error states, loading states.
13. **Release:** Swagger docs, Playwright E2E for both the customer path and the staff path, GitHub Actions, deployment (Vercel + Render/Railway + Neon/Supabase) with the Next.js rewrite proxy, README with architecture diagram and screenshots, short demo video, seeded demo logins for each role, live link.
14. *(Optional)* Razorpay test mode, refunds and cancellation fees.

Frontend pages for a phase are built after that phase's API is finished and documented.

---

## 17. Definition of Done (per feature)

Backend endpoint, DB model, validation, authorization, business rules, frontend integration, loading and error states, tests, short docs, and the end-to-end flow works. For anything about bookings or customers, it must work **both** for the customer path and the staff-on-behalf path (or be explicitly marked as staff-only or customer-only in the spec).

---

## 18. Demo Scenarios (both must run end-to-end)

**Scenario A: customer self-service.** Customer **Ravi Kumar** with an **LG Washing Machine** (FHM1207, serial LG123456789) books **Washing Machine Repair** (60 min, ₹499) at his Kondapur address for **tomorrow at 10:00 AM** (the seed script uses a relative date). Problem: "Machine is not draining water."

Flow: booking confirmed, **Rahul Sharma** assigned, notification queued, Rahul sees it on his mobile dashboard, moves through EN_ROUTE, ARRIVED, IN_PROGRESS, proposes ₹300 extra for a drain pump clean, Ravi approves in the app, Rahul completes the visit (diagnosis: drain pump blockage; work: pump cleaned, hose checked, machine tested), payment ₹499 + ₹300 = **₹799** recorded, receipt generated, appliance history updated, review request queued. A second customer trying the same slot with Rahul is rejected.

**Scenario B: staff booking for a phone customer.** **Priya** calls to book an **AC Repair** in Gachibowli. The manager searches by phone, finds no record, creates Priya (phone only, no email), adds her AC and address, books the slot with source PHONE, and the audit log shows the manager as the creator. Priya later sees the same booking after claiming her account by email invite. Then Rahul is marked sick for that day (time off): the booking is flagged **needs reassignment**, the manager reassigns it to another qualified free technician, and the history shows every change.

---

## 19. How Claude Should Work With Me

- I'm learning Node.js, Express, PostgreSQL and Next.js. Explain the *why* of each key decision briefly, then write the code.
- Work on **one phase at a time**. Don't jump ahead or add features not in this spec.
- Keep files small and code readable. Prefer simple code over clever code.
- Ask before adding any new tool, library or architectural change.
- Point out mistakes, edge cases and real-world problems (timezones, race conditions, ownership checks) as we hit them.
- End each phase with: what was built, how to run it, how to test it, and what comes next.

---

## 20. Interview Positioning

> BusinessHub is a full-stack appliance repair booking and field-service management platform covering service requests, appliance registration, technician availability, conflict-free booking, assignment, service visits, payments, notifications and service history.

> I designed the booking system around technician availability and service duration, with the backend and a PostgreSQL exclusion constraint acting as the source of truth to prevent double bookings under concurrent requests, and background jobs for reminders and notifications.
