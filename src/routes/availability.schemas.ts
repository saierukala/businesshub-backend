import { DateTime } from 'luxon';
import { z } from 'zod';
import { area, uuid } from '../validation/common';

// date is a calendar day in Asia/Kolkata, e.g. 2026-10-05. Not a timestamp: no timezone to get wrong.
export const availabilityQuery = z.object({
  serviceId: uuid,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((v) => DateTime.fromISO(v).isValid, 'Not a real date'),
  area, // the area of the customer's address, e.g. Kondapur
});

export type AvailabilityQuery = z.infer<typeof availabilityQuery>;
