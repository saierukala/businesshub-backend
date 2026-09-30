// The background jobs and what they carry. Kept small on purpose: a job holds ids and a few facts,
// never a copy of the booking. The worker loads the current booking when the job runs.

export type NotifyType =
  | 'BOOKING_CONFIRMED'
  | 'TECHNICIAN_ASSIGNED'
  | 'JOB_REMOVED'
  | 'BOOKING_RESCHEDULED'
  | 'BOOKING_CANCELLED'
  | 'TECHNICIAN_EN_ROUTE'
  | 'EXTRA_CHARGE_REQUESTED'
  | 'EXTRA_CHARGE_DECIDED'
  | 'VISIT_COMPLETED'
  | 'REVIEW_REQUEST'
  | 'REMINDER_24H'
  | 'REMINDER_2H'
  | 'NEEDS_REASSIGNMENT';

export type NotifyJob = {
  type: NotifyType;
  bookingId?: string;
  technicianId?: string; // JOB_REMOVED: the technician who lost the job
  previousStartAt?: string; // BOOKING_RESCHEDULED
  decision?: 'APPROVED' | 'DECLINED'; // EXTRA_CHARGE_DECIDED
  at?: string; // when it happened; part of the de-dupe key for things that can repeat (extra charge asked twice)
  timeOffId?: string; // NEEDS_REASSIGNMENT
  technicianName?: string; // NEEDS_REASSIGNMENT
  count?: number; // NEEDS_REASSIGNMENT
  // Reminders and review requests are scheduled for later. If the booking moved or ended meanwhile the
  // job does nothing when it wakes up (this is how "cancelled or re-scheduled" reminders are dropped):
  expectStartAt?: string;
  requireStatus?: 'COMPLETED';
};

export const JOB = { notify: 'notify', reminder: 'reminder', reviewRequest: 'review-request' } as const;
export type JobName = (typeof JOB)[keyof typeof JOB];

// Reminders before the visit, and how long after completion the review request goes out.
export const REMINDER_HOURS = [24, 2] as const;
export const REVIEW_REQUEST_DELAY_MINUTES = 120;

// Failed jobs are retried with growing waits: 30 s, 1 min, 2 min, ... up to 5 tries after the first.
export const RETRY = { retryLimit: 5, retryDelay: 30, retryBackoff: true } as const;
