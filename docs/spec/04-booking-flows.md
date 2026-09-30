<!-- BusinessHub spec part: Customer and staff booking flows -->

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
