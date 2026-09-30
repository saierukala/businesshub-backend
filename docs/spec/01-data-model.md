<!-- BusinessHub spec part: Data model -->

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
