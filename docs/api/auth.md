# Auth API (Phase 2)

Session = JWT in the httpOnly cookie `bh_session` (7 days, `SameSite=Lax`, `Secure` in production).
The frontend never reads it; it calls `/api/auth/*` through the Next.js rewrite and the browser sends the cookie.
Errors use the standard shape `{ "error": { "code", "message", "details" } }`.

| Method | Path | Auth | Body | Success |
|---|---|---|---|---|
| POST | `/auth/register` | public | `name, email, password, phone?` | 201 `{ user }` + cookie. Always role CUSTOMER. Sends verify email. 409 `EMAIL_TAKEN` |
| POST | `/auth/login` | public | `email, password` | 200 `{ user }` + cookie. 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_DISABLED` |
| POST | `/auth/logout` | public | – | 204, cookie cleared |
| GET | `/auth/me` | any role | – | 200 `{ user }`. 401 if no/invalid session |
| POST | `/auth/forgot-password` | public | `email` | 200 always (no account probing). Emails `/reset-password?token=` (1 h) |
| POST | `/auth/reset-password` | public | `token, password` | 200. Logs out all existing sessions, marks email verified |
| POST | `/auth/verify-email` | public | `token` | 200. Link from email `/verify-email?token=` (24 h) |
| POST | `/auth/resend-verification` | any role | – | 200. 409 `ALREADY_VERIFIED` |
| POST | `/auth/invite` | OWNER, MANAGER | `customerId` | 200. Emails `/accept-invite?token=` (7 days). Only for customers with email and no password |
| POST | `/auth/accept-invite` | public | `token, password` | 200. Then the customer logs in; all earlier bookings are already theirs |

`user` = `{ id, name, email, phone, role, emailVerified }`.

Rules: one-time links are single-use, only the newest link of a type works, and only a hash is stored.
Staff-created customers claim their account via invite **or** forgot password (both prove they own the inbox); registering over an existing email is refused.

Middleware for later phases: `requireAuth`, `requireRole(...roles)`, `assertCustomerAccess(req.user, customerId)` in `src/middleware/auth.ts`.
