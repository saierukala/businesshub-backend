import { z } from 'zod';
import { optionalText, pagination, uuid } from '../validation/common';

const fields = {
  categoryId: uuid,
  brand: z.string().trim().min(1).max(60),
  model: optionalText(60),
  serialNumber: optionalText(60),
  // Upper bound is checked in the service (current year in Asia/Kolkata).
  purchaseYear: z.number().int().min(1980).nullish(),
  description: optionalText(500),
};

// customerId: required for staff, ignored for customers (taken from the session).
export const listAppliancesQuery = pagination.extend({ customerId: uuid.optional() });
export const createApplianceBody = z.object({ customerId: uuid.optional(), ...fields });
export const updateApplianceBody = z.object(fields).partial();

export type ListAppliancesQuery = z.infer<typeof listAppliancesQuery>;
export type CreateApplianceBody = z.infer<typeof createApplianceBody>;
export type UpdateApplianceBody = z.infer<typeof updateApplianceBody>;
