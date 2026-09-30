import { z } from 'zod';
import { optionalText, pagination, queryBool, uuid } from '../validation/common';

export const categoryBody = z.object({ name: z.string().trim().min(2).max(60) });

export const listServicesQuery = pagination.extend({
  categoryId: uuid.optional(),
  // Staff only: include deactivated services. Ignored for other roles.
  includeInactive: queryBool.optional(),
});

// Price in rupees with at most 2 decimals (sent as a number, e.g. 499 or 499.5).
const price = z
  .number()
  .min(0)
  .max(1_000_000)
  // v * 100 must be a whole number of paise (tolerance for float noise like 0.1 + 0.2)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals');

export const createServiceBody = z.object({
  categoryId: uuid,
  name: z.string().trim().min(2).max(100),
  description: optionalText(1000),
  // Whole 15-minute blocks, 15 min to 8 h, so bookings line up with the slot grid.
  durationMinutes: z.number().int().min(15).max(480).multipleOf(15, 'Use 15-minute steps'),
  basePrice: price,
  active: z.boolean().default(true),
});
export const updateServiceBody = createServiceBody.partial();

export type CreateServiceBody = z.infer<typeof createServiceBody>;
export type UpdateServiceBody = z.infer<typeof updateServiceBody>;
export type ListServicesQuery = z.infer<typeof listServicesQuery>;
