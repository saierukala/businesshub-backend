<!-- BusinessHub spec part: Dashboards, reports, UI requirements -->

## 12. Dashboards and Reports

Everything comes from real database queries (SQL aggregation, not browser-side calculation). No fake numbers once data exists.

- **Customer:** upcoming appointment and status, my appliances, recent history, payments, reviews.
- **Technician:** today's appointments with status buttons (En Route, Arrived, Start, Complete) and a notes form.
- **Owner/Manager:** today's bookings by status, pending assignments, bookings needing reassignment, available technicians, revenue today and this month, popular services, booking trend, bookings by source, technician workload.
- **UI requirements:** technician screens are designed **mobile-first** (large buttons, one-hand use). Customer and manager screens are responsive. Staff screens include user management (owner creates managers/technicians, deactivates users) and service catalog editing.
- **Reports:** booking report (total, completed, cancelled, no-show, rescheduled), revenue (daily/weekly/monthly), service report, technician report. Date range filters and pagination.
