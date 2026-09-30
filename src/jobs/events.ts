import { safeEnqueue } from './queue';
import { JOB, REMINDER_HOURS, REVIEW_REQUEST_DELAY_MINUTES, type NotifyJob } from './types';

// What the booking code calls when something happens. Each one only ENQUEUES and returns: the emails and
// in-app rows are made later by the worker. A queue problem is logged, never thrown, because the booking is already saved.

const HOUR = 3_600_000;
const notify = (data: NotifyJob, startAfter?: Date) => safeEnqueue(JOB.notify, data, startAfter ? { startAfter } : undefined);

// 24 h and 2 h before the visit (a reminder whose time has already passed is skipped).
// Each carries the start time it was made for, so if the booking is moved or cancelled the old reminder
// does nothing when it wakes up. A moved booking gets a fresh pair.
function scheduleReminders(bookingId: string, startAt: Date, now: Date) {
  return Promise.all(
    REMINDER_HOURS.map((h) => {
      const at = new Date(startAt.getTime() - h * HOUR);
      if (at <= now) return undefined;
      return safeEnqueue(JOB.reminder, { type: `REMINDER_${h}H`, bookingId, expectStartAt: startAt.toISOString() } satisfies NotifyJob, { startAfter: at });
    }),
  );
}

export const events = {
  // A new booking (customer, staff or follow-up): confirm it, tell the technician holding the slot, set the reminders.
  async bookingCreated(b: { id: string; startAt: Date }, now = new Date()) {
    await notify({ type: 'BOOKING_CONFIRMED', bookingId: b.id });
    await scheduleReminders(b.id, b.startAt, now);
  },

  // The manager gave the booking a technician, or swapped it. The old one is told they are off the job.
  async technicianAssigned(bookingId: string, previousTechnicianId: string | null, newTechnicianId: string) {
    await notify({ type: 'TECHNICIAN_ASSIGNED', bookingId });
    if (previousTechnicianId && previousTechnicianId !== newTechnicianId) {
      await notify({ type: 'JOB_REMOVED', bookingId, technicianId: previousTechnicianId });
    }
  },

  async rescheduled(bookingId: string, p: { previousStartAt: Date; newStartAt: Date; previousTechnicianId: string | null; technicianId: string | null }, now = new Date()) {
    await notify({ type: 'BOOKING_RESCHEDULED', bookingId, previousStartAt: p.previousStartAt.toISOString() });
    if (p.previousTechnicianId && p.technicianId && p.previousTechnicianId !== p.technicianId) {
      await notify({ type: 'JOB_REMOVED', bookingId, technicianId: p.previousTechnicianId });
    }
    await scheduleReminders(bookingId, p.newStartAt, now); // the old reminders will find the start time changed and skip
  },

  async cancelled(bookingId: string) {
    await notify({ type: 'BOOKING_CANCELLED', bookingId });
  },

  async enRoute(bookingId: string) {
    await notify({ type: 'TECHNICIAN_EN_ROUTE', bookingId });
  },

  async extraChargeRequested(bookingId: string, at: Date) {
    await notify({ type: 'EXTRA_CHARGE_REQUESTED', bookingId, at: at.toISOString() });
  },

  async extraChargeDecided(bookingId: string, decision: 'APPROVED' | 'DECLINED', at: Date) {
    await notify({ type: 'EXTRA_CHARGE_DECIDED', bookingId, decision, at: at.toISOString() });
  },

  // The visit is done: tell the customer the total, and ask for a review a little later.
  async visitCompleted(bookingId: string, now = new Date()) {
    await notify({ type: 'VISIT_COMPLETED', bookingId });
    await safeEnqueue(
      JOB.reviewRequest,
      { type: 'REVIEW_REQUEST', bookingId, requireStatus: 'COMPLETED' } satisfies NotifyJob,
      { startAfter: new Date(now.getTime() + REVIEW_REQUEST_DELAY_MINUTES * 60_000) },
    );
  },

  // Time off landed on existing bookings: the managers must find them a new technician.
  async flaggedForReassignment(p: { timeOffId: string; technicianName: string; count: number }) {
    if (p.count > 0) await notify({ type: 'NEEDS_REASSIGNMENT', timeOffId: p.timeOffId, technicianName: p.technicianName, count: p.count });
  },
};
