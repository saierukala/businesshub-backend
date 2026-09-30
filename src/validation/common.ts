import { z } from 'zod';

// Shared field rules, so every endpoint validates the same way.

// Emails are trimmed and lower-cased so "Ravi@X.com" and "ravi@x.com" are one account.
export const email = z.string().trim().toLowerCase().email().max(254);

// Indian mobile number stored as 10 digits. Accepts "+91 98765 43210", "098765-43210", etc.
export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'));

export const name = z.string().trim().min(2).max(100);
export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

// Optional text: "" becomes null, so clearing a field in a form works.
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish();

// ?page=1&pageSize=20 on every list endpoint.
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// Query strings are text: accept "true"/"false".
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

// "  kondapur " -> "Kondapur". Address areas are matched against technician service areas,
// so there must be one spelling per area.
export const area = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .transform((v) => v.replace(/\s+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()));

// An exact moment: ISO timestamp WITH an offset, e.g. 2026-10-05T09:00:00+05:30. Becomes a Date (UTC inside).
export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((v) => new Date(v));
