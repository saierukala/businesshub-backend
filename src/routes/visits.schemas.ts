import { z } from 'zod';
import { instant, money, uuid } from '../validation/common';

const text = (max: number) => z.string().trim().max(max);
const required = (what: string) => z.string().trim().min(3, `Write the ${what}`).max(2000);

// The technician's forward moves. COMPLETED is not here: it goes through "complete visit", which needs the notes.
export const advanceBody = z.object({ to: z.enum(['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) });

// Notes while the work is going on. Send only what changed.
export const saveVisitBody = z.object({
  diagnosis: text(2000).optional(),
  workPerformed: text(2000).optional(),
  partsNote: text(1000).optional(),
  notes: text(2000).optional(),
  result: text(500).optional(),
});

// Completing needs the diagnosis and the work performed (spec §10).
export const completeVisitBody = z.object({
  diagnosis: required('diagnosis'),
  workPerformed: required('work performed'),
  partsNote: text(1000).optional(),
  notes: text(2000).optional(),
  result: text(500).optional(),
});

export const proposeExtraChargeBody = z.object({
  amount: money.refine((v) => v > 0, 'Enter the extra amount'),
  reason: z.string().trim().min(3, 'Say what the extra work is').max(500),
});

export const extraChargeDecisionBody = z.object({ decision: z.enum(['APPROVED', 'DECLINED']) });

// A follow-up reuses the customer, appliance and address of the original booking.
export const followUpBody = z.object({
  startAt: instant,
  serviceId: uuid.optional(), // default: the same service
  problemDescription: z.string().trim().min(3).max(1000).optional(), // default: "Follow-up to BH-..."
  // staff only
  technicianId: uuid.optional(),
  overrideReason: z.string().trim().min(3).max(300).optional(),
});

export type AdvanceBody = z.infer<typeof advanceBody>;
export type SaveVisitBody = z.infer<typeof saveVisitBody>;
export type CompleteVisitBody = z.infer<typeof completeVisitBody>;
export type ProposeExtraChargeBody = z.infer<typeof proposeExtraChargeBody>;
export type ExtraChargeDecisionBody = z.infer<typeof extraChargeDecisionBody>;
export type FollowUpBody = z.infer<typeof followUpBody>;
