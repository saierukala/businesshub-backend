import { z } from 'zod';
import { email, name, pagination, phone } from '../validation/common';

// q matches name, email or phone (any part).
export const listCustomersQuery = pagination.extend({ q: z.string().trim().max(100).optional() });

// Email is optional (phone/walk-in customers). "" means no email.
const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(email.nullable())
  .nullish();

export const createCustomerBody = z.object({
  name,
  phone,
  email: optionalEmail,
  // Spec: warn on duplicate phone. First try returns 409 DUPLICATE_PHONE with the matches;
  // staff confirm by sending the request again with this set to true.
  allowDuplicatePhone: z.boolean().default(false),
});

export const updateCustomerBody = z.object({
  name: name.optional(),
  phone: phone.optional(),
  email: optionalEmail,
  allowDuplicatePhone: z.boolean().default(false),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;
export type CreateCustomerBody = z.infer<typeof createCustomerBody>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerBody>;
