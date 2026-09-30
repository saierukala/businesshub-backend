# Catalog, customers and users API (Phase 3)

All endpoints need a session cookie. Errors: `{ "error": { "code", "message", "details" } }`.
Lists take `?page=1&pageSize=20` (max 100) and return `{ items, page, pageSize, total, totalPages }`.

## Catalog
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/service-categories` | any role | `{ id, name }` |
| POST / PATCH | `/service-categories[/:id]` | OWNER | `{ name }` |
| GET | `/services?categoryId&includeInactive` | any role | Customers/technicians only ever get active ones |
| GET | `/services/:id` | any role | Inactive = 404 for non-staff |
| POST | `/services` | OWNER | `{ categoryId, name, description?, durationMinutes (15-480, steps of 15), basePrice (number, ≤2 decimals), active? }` |
| PATCH | `/services/:id` | OWNER | Any subset. Deactivate with `{ active: false }` (never deleted) |

Service: `{ id, name, description, durationMinutes, basePrice: "599.00", active, category: { id, name } }`.

## Customers (OWNER, MANAGER)
| Method | Path | Notes |
|---|---|---|
| GET | `/customers?q=` | `q` matches name, email or phone digits |
| POST | `/customers` | `{ name, phone, email?, allowDuplicatePhone? }`. 409 `DUPLICATE_PHONE` (details = matching customers) → resend with `allowDuplicatePhone: true`. 409 `EMAIL_TAKEN` |
| GET | `/customers/:id` | |
| PATCH | `/customers/:id` | Same fields. Changing the email un-verifies it and cancels links sent to the old one. Audited as `CUSTOMER_UPDATED` with a from/to diff |

Customer: `{ id, name, phone, email, emailVerified, hasAccount, active, createdAt }`.
To let a phone-only customer log in online: add an email, then `POST /auth/invite { customerId }`.

## Addresses and appliances (CUSTOMER, OWNER, MANAGER)
Same endpoints for both paths. **Customers:** `customerId` is ignored and taken from the session.
**Staff:** `customerId` is required (query for GET, body for POST). Another customer's record → 404.

| Method | Path | Body |
|---|---|---|
| GET | `/addresses?customerId` | |
| POST | `/addresses` | `{ customerId?, label="Home", line1, area, city="Hyderabad", pincode? (6 digits) }`. Area is normalised ("kondapur" → "Kondapur") |
| PATCH / DELETE | `/addresses/:id` | Delete → 409 `IN_USE` if a booking uses it |
| GET | `/appliances?customerId` | |
| POST | `/appliances` | `{ customerId?, categoryId, brand, model?, serialNumber?, purchaseYear?, description? }` |
| PATCH / DELETE | `/appliances/:id` | Delete → 409 `IN_USE` if it has bookings |

## Users (OWNER)
| Method | Path | Notes |
|---|---|---|
| GET | `/users?role&active&q` | |
| POST | `/users` | `{ name, email, phone, role: MANAGER \| TECHNICIAN }`. No password: an invite email is sent. Technicians also get a Technician record (skills etc. in Phase 4) |
| PATCH | `/users/:id/active` | `{ active }`. Not yourself, not an owner. Takes effect on the user's next request |
| POST | `/users/:id/invite` | Resend the invite to a staff member who hasn't set a password |

User: `{ id, name, email, phone, role, active, hasAccount, createdAt }`.
