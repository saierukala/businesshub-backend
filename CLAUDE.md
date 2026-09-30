# BusinessHub

Appliance repair booking and field-service app for HomeFix Appliance Services (Hyderabad).
Core: booking + availability engine. Not inventory, not ERP. Separate from PulseOps: never reuse its code or ideas.

Spec is split into small parts in `docs/spec/`. Start from `docs/spec/PHASES.md`: find the current phase, read ONLY the files it lists.
Do NOT open `docs/BusinessHub-Spec.md` (the full combined copy, for humans).
Parts: 00-core, 01-data-model, 02-booking-rules, 03-availability-and-conflicts, 04-booking-flows, 05-visits-payments, 06-notifications, 07-dashboards-reports, 08-api-audit, 09-demo-and-release.

## Current phase
Phase: 8 (Service visits and technician dashboard)   <!-- update this line when a phase is finished -->
Done so far: Phase 1 (Foundation), Phase 2 (Auth and roles), Phase 3 (Catalog, customers and users), Phase 4 (Technicians), Phase 5 (Availability engine), Phase 6 (Bookings, both paths), Phase 7 (Assignment and reassignment)

## Stack (fixed, ask before changing)
- Frontend: Next.js (App Router), TypeScript, Tailwind, TanStack Query, React Hook Form, Zod
- Backend: Node.js, Express, TypeScript, Zod
- DB: PostgreSQL + Prisma (raw SQL migrations for constraints)
- Auth: bcrypt + JWT in httpOnly cookies. Jobs: pg-boss. Email: Nodemailer. Logs: pino
- Tests: Vitest/Jest + Supertest, Playwright (one E2E per path)
- NO Docker, NO Redis, NO BullMQ, NO microservices

## Layout
This repo is the backend only. The frontend lives in a separate repo.
- `src/` Express API (routes → controllers → services → db). Business logic lives in services only.
- `prisma/` schema, migrations, seed
- `docs/` spec and notes (covers the whole app, including frontend phases)
- Frontend (separate repo): Next.js app. API calls go through the `/api/*` rewrite to this backend.

## Non-negotiable rules
1. Backend is the source of truth. The frontend never decides availability.
2. Double booking is prevented by the PostgreSQL exclusion constraint (`btree_gist`), inside a transaction. Catch error `23P01` and return 409.
3. Customers and staff (Owner/Manager) book through the SAME `createBooking` / `rescheduleBooking` / `cancelBooking` services. Customers never pass a `customerId`. Staff must.
4. Staff may override cutoff and cancellation windows only, with a reason in the audit log. Never technician conflicts, skills, hours or time off.
5. All business time logic is server-side in `Asia/Kolkata`. Store `timestamptz` (UTC). Never use the browser timezone.
6. Validate every request with Zod. Check auth, role, and ownership on every endpoint.
7. Every booking status change writes `BookingStatusHistory` and `AuditLog`. Only allowed transitions (spec §5); invalid ones return 409.
8. Error shape: `{ "error": { "code", "message", "details" } }`. Paginate all list endpoints.
9. No secrets in the repo. Keep `.env.example` updated.
10. Do not add features that are not in the spec.

## How to work with me
- I am learning Node, Express, PostgreSQL and Next.js. Explain the key decision in 1-3 sentences, then write the code.
- One phase at a time. Do not jump ahead.
- Ask before adding any library or changing architecture.
- Keep files small and code simple and readable.
- Be concise: no long recaps, no repeating code I can already see. End each task with: what changed, how to run it, how to test it.
- Point out real-world problems (timezones, races, ownership holes) when you see them.

## Token habits
- Read only the files you need. Never read `node_modules`, lockfiles, `.next`, `dist`, or build output.
- Prefer targeted searches (grep/glob) over opening whole files. Read line ranges for big files.
- Edit files in place. Do not rewrite whole files for small changes.
- Show only trimmed test and command output (failures, errors), not full logs.
- Before a new phase, I will run `/clear`. Re-read this file and the relevant spec section only.

## Commands (create these scripts as the project grows)
- Backend: `npm run dev`, `npm run worker`, `npm test`, `npm run lint`, `npm run typecheck`
- DB: `npx prisma migrate dev`, `npm run seed`
- Frontend: `npm run dev`, `npm test`
- E2E: `npx playwright test`

## Definition of done
API, DB model, validation, authorization, business rules, frontend integration, loading and error states, tests, short docs.
For booking or customer features: works for both the customer path and the staff-on-behalf path (unless the spec says otherwise).
