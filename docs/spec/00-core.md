<!-- BusinessHub spec part: Core: identity, stack, roles, exclusions, done -->

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

## 15. Not Included

Warehouse, inventory, stock ledger, purchase orders, suppliers, product catalog, sales orders, procurement, multi-tenancy, manufacturing, accounting, Docker, Redis. If a technician replaces a part, it is just text in the service visit (`partsNote`).

**Deliberately skipped in v1:** photo uploads, WebSockets (polling is fine), GST invoices, travel-time optimization, SMS/WhatsApp sending, multi-language, native mobile apps, refunds and cancellation fees (added with Razorpay).

## 17. Definition of Done (per feature)

Backend endpoint, DB model, validation, authorization, business rules, frontend integration, loading and error states, tests, short docs, and the end-to-end flow works. For anything about bookings or customers, it must work **both** for the customer path and the staff-on-behalf path (or be explicitly marked as staff-only or customer-only in the spec).
