import { z } from 'zod';

// The technician or manager records how the customer paid. There is NO amount here on purpose: the server
// works it out (base price + approved extra charge), so a client can never change what was paid.
// CARD and ONLINE (Razorpay) come in a later phase.
export const recordPaymentBody = z.object({
  method: z.enum(['CASH', 'UPI']),
  reference: z.string().trim().max(100).optional(), // e.g. the UPI transaction id
});

export type RecordPaymentBody = z.infer<typeof recordPaymentBody>;
