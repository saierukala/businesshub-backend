import { z } from 'zod';
import { pagination, uuid } from '../validation/common';

// "  kondapur " -> "Kondapur". Areas are matched against technician service areas later,
// so one spelling per area matters.
const area = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .transform((v) => v.replace(/\s+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()));

const fields = {
  label: z.string().trim().min(1).max(40),
  line1: z.string().trim().min(3).max(200),
  area,
  city: z.string().trim().min(2).max(60),
  // Optional; "" clears it.
  pincode: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .pipe(z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code').nullable())
    .nullish(),
};

// customerId: required for staff, ignored for customers (taken from the session).
export const listAddressesQuery = pagination.extend({ customerId: uuid.optional() });
export const createAddressBody = z.object({
  customerId: uuid.optional(),
  ...fields,
  label: fields.label.default('Home'),
  city: fields.city.default('Hyderabad'),
});
export const updateAddressBody = z.object(fields).partial();

export type ListAddressesQuery = z.infer<typeof listAddressesQuery>;
export type CreateAddressBody = z.infer<typeof createAddressBody>;
export type UpdateAddressBody = z.infer<typeof updateAddressBody>;
