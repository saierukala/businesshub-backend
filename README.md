# BusinessHub (backend)

Appliance repair booking and field-service app (HomeFix Appliance Services). See `docs/spec/PHASES.md` for the build plan.

## Setup

Requirements: Node.js 20+ and PostgreSQL 14+ (local install, or a free Neon/Supabase database). No Docker.

```bash
# 1. Install dependencies (versions are pinned in package.json)
npm install

# 2. Configure
cp .env.example .env        # then edit DATABASE_URL and JWT_SECRET
#    (Windows PowerShell: copy .env.example .env)

# 3. Apply migrations (creates the database if needed, generates the Prisma client).
#    The init migration already includes the no-overlap constraint from prisma/sql/booking_no_overlap.sql.
npx prisma migrate dev

# 4. Seed demo data
npm run seed

# 5. Run
npm run dev
```

## Check it works

- http://localhost:4000/health returns `{"status":"ok",...}`
- http://localhost:4000/health/ready returns `{"status":"ready","database":"up"}`
- `npm run typecheck`, `npm run lint` and `npm test` pass
- The constraint exists. Run in psql or pgAdmin:
  ```sql
  SELECT conname FROM pg_constraint
  WHERE conname IN ('booking_no_technician_overlap', 'booking_time_valid');
  ```
  You should see both rows.
- `npx prisma studio` shows seeded categories, services, 3 technicians, and the demo customers.

## Demo logins (dev only)

Password for all: `Password@123`
owner@homefix.test, manager@homefix.test, rahul@homefix.test, arjun@homefix.test, suresh@homefix.test, ravi@example.test.
Priya Nair is a phone-only customer created by staff (no login), used for the phone-booking demo.

## Frontend

The Next.js frontend lives in a separate repo. It calls this API through its `/api/*` rewrite, and `FRONTEND_URL` in `.env` must match its origin (CORS).
