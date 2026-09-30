# Payments and receipts API (Phase 9)

Cash and UPI first. Card / online (Razorpay) comes in a later phase and must verify signatures on the backend.
Payment state is only ever changed on the server.

## Record a payment
`POST /bookings/:id/payment` (assigned technician, Owner or Manager)
```json
{ "method": "CASH" }
{ "method": "UPI", "reference": "UPI-778899" }
```
- **No amount is accepted.** The server works it out: service base price + the extra charge **only if approved**
  (`amountDue`, the same figure as the visit report's `finalAmount`). Sending an `amount` or `status` is ignored.
- The booking must be `COMPLETED` (else `409 NOT_COMPLETED`).
- A booking is paid **once**: a second attempt is `409 ALREADY_PAID`. This is guaranteed by the database
  (unique index on `Payment(bookingId) WHERE status = 'PAID'`), so two simultaneous requests cannot both succeed.
- Other technicians get 404; customers 403. A failed or refunded row would not block a later PAID one.
- Response `201`: `{ id, amount: "849.00", method, status: "PAID", reference, receiptNumber: "RC-2026-00001", paidAt, recordedBy }`.
- Audit: `PAYMENT_RECORDED` (amount, method, receipt number, reference). Receipt numbers are per IST year and taken under an advisory lock.
- `amount > 0` is also a database check.

## Where it shows
- `GET /bookings/:id` has `payment` (the PAID payment or `null`); bookings in lists have `paid: true|false`.

## Receipt
`GET /bookings/:id/receipt` (the customer of the booking, its technician, Owner/Manager; others 404). `404` until paid.
```json
{ "receiptNumber": "RC-2026-00001", "paidAt": "...", "business": "HomeFix Appliance Services",
  "bookingNumber": "BH-2026-00005", "visitDate": "...", "customer": { "name", "phone" }, "address": "...",
  "technician": "Rahul Sharma",
  "lines": [ { "label": "Washing Machine Repair", "amount": "499.00" }, { "label": "Extra: Replace the drain pump", "amount": "250.00" } ],
  "total": "749.00", "method": "UPI", "reference": "TXN123" }
```
The frontend renders this as a printable page (Print / Save as PDF from the browser). Lines add up to `total`.

## Not yet
Refunds and voiding a payment, partial payments, card/online payments, payment reports (Phase for dashboards and reports).
