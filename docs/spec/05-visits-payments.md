<!-- BusinessHub spec part: Service visits, extra charges, payments -->

## 10. Service Visit, History and Payment

- The **booking** is the appointment. The **service visit** records what happened (diagnosis, work performed, result).
- Completing a visit requires diagnosis and work performed. Completion sets the booking to COMPLETED.
- **Service history** for an appliance = its completed visits with date, service, amount, technician.
- **Payment:** technician or manager records the final amount (base price + additional charge) and method. Store the payment, generate a simple receipt (HTML or PDF) and mark it paid. Payment state is only ever changed server-side.
- **Extra charge approval:** if the technician finds extra work, they record an amount and reason (status PROPOSED). The customer approves or declines in the app, or the manager records the customer's decision taken by phone (APPROVED/DECLINED, with who decided). Work beyond the base service proceeds only when APPROVED. The final payment amount = base price + approved extra charge.
- **Follow-up visit:** if a repair needs a second visit, the manager (or technician) creates a new booking linked with `followUpOfBookingId`. It reuses the same customer, appliance and address, and shows in the appliance history as connected.
- **Razorpay (later phase):** create order on the backend, verify the payment signature on the backend, and verify webhook signatures. Never trust the client.
