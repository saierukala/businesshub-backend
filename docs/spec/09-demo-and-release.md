<!-- BusinessHub spec part: Demo scenarios and interview positioning -->

## 18. Demo Scenarios (both must run end-to-end)

**Scenario A: customer self-service.** Customer **Ravi Kumar** with an **LG Washing Machine** (FHM1207, serial LG123456789) books **Washing Machine Repair** (60 min, ₹499) at his Kondapur address for **tomorrow at 10:00 AM** (the seed script uses a relative date). Problem: "Machine is not draining water."

Flow: booking confirmed, **Rahul Sharma** assigned, notification queued, Rahul sees it on his mobile dashboard, moves through EN_ROUTE, ARRIVED, IN_PROGRESS, proposes ₹300 extra for a drain pump clean, Ravi approves in the app, Rahul completes the visit (diagnosis: drain pump blockage; work: pump cleaned, hose checked, machine tested), payment ₹499 + ₹300 = **₹799** recorded, receipt generated, appliance history updated, review request queued. A second customer trying the same slot with Rahul is rejected.

**Scenario B: staff booking for a phone customer.** **Priya** calls to book an **AC Repair** in Gachibowli. The manager searches by phone, finds no record, creates Priya (phone only, no email), adds her AC and address, books the slot with source PHONE, and the audit log shows the manager as the creator. Priya later sees the same booking after claiming her account by email invite. Then Rahul is marked sick for that day (time off): the booking is flagged **needs reassignment**, the manager reassigns it to another qualified free technician, and the history shows every change.

## 20. Interview Positioning

> BusinessHub is a full-stack appliance repair booking and field-service management platform covering service requests, appliance registration, technician availability, conflict-free booking, assignment, service visits, payments, notifications and service history.

> I designed the booking system around technician availability and service duration, with the backend and a PostgreSQL exclusion constraint acting as the source of truth to prevent double bookings under concurrent requests, and background jobs for reminders and notifications.
