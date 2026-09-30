import { z } from 'zod';
import { instant, pagination, queryBool, uuid } from '../validation/common';

const reason = z.string().trim().min(3, 'Give a short reason').max(300);

// One body for both paths. Customers send the first block only; the extra fields are staff-only
// and the service rejects them from a customer. A customer's customerId is ignored (spec rule 3).
export const createBookingBody = z.object({
  applianceId: uuid,
  serviceId: uuid,
  addressId: uuid,
  problemDescription: z.string().trim().min(3, 'Describe the problem').max(1000),
  startAt: instant, // must be exactly a start time returned by GET /availability
  // staff only
  customerId: uuid.optional(),
  source: z.enum(['PHONE', 'WHATSAPP', 'WALK_IN']).optional(),
  technicianId: uuid.optional(), // omit to let the system pick a free one
  overrideReason: reason.optional(), // needed when staff book inside the 2-hour cutoff
});

export const rescheduleBookingBody = z.object({
  startAt: instant,
  overrideReason: reason.optional(), // staff only: inside the 4-hour window, past the limit, or inside the cutoff
});

export const cancelBookingBody = z.object({
  reason: z.string().trim().max(300).optional(), // why (anyone)
  overrideReason: reason.optional(), // staff only: cancelling inside the 4-hour window
});

export const noShowBody = z.object({ note: z.string().trim().max(300).optional() });

// Staff: give a booking a technician, or change it. Must be one from GET /bookings/:id/technicians.
export const assignBookingBody = z.object({ technicianId: uuid, note: z.string().trim().max(300).optional() });

export const listBookingsQuery = pagination.extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  // staff filters (ignored for customers, who only ever see their own)
  customerId: uuid.optional(),
  technicianId: uuid.optional(),
  needsReassignment: queryBool.optional(),
  hideCancelled: queryBool.optional(), // leaves out CANCELLED and NO_SHOW, so counts match what a screen shows
  sort: z.enum(['newest', 'soonest']).default('newest'), // soonest = earliest visit first (the reassignment queue)
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // IST calendar days, inclusive
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateBookingBody = z.infer<typeof createBookingBody>;
export type RescheduleBookingBody = z.infer<typeof rescheduleBookingBody>;
export type CancelBookingBody = z.infer<typeof cancelBookingBody>;
export type NoShowBody = z.infer<typeof noShowBody>;
export type AssignBookingBody = z.infer<typeof assignBookingBody>;
export type ListBookingsQuery = z.infer<typeof listBookingsQuery>;
