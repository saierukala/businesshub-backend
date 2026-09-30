import { DateTime } from 'luxon';
import type { NotifyType } from '../jobs/types';
import { BUSINESS_TZ } from './availability.compute';

// PURE: given the facts about an event, decide WHO is told WHAT. No database, no email, no clock.
// The worker loads the facts, calls this, then saves the in-app rows and sends the emails.

export type Person = { id: string; name: string; email: string | null };

export type BuildCtx = {
  frontendUrl: string;
  booking: { id: string; bookingNumber: string; startAt: Date; serviceName: string; applianceName: string; area: string };
  customer: Person & { phone: string | null };
  technician: Person | null; // the technician this event is about (may be the one who just lost the job)
  managers: Person[]; // active owners and managers
  previousStartAt?: Date; // BOOKING_RESCHEDULED
  decision?: 'APPROVED' | 'DECLINED'; // EXTRA_CHARGE_DECIDED
  extra?: { amount: string; reason: string | null }; // EXTRA_CHARGE_*
  total?: string; // VISIT_COMPLETED
  at?: string; // part of the de-dupe key for things that can repeat
  count?: number; // NEEDS_REASSIGNMENT
  technicianName?: string; // NEEDS_REASSIGNMENT
  timeOffId?: string; // NEEDS_REASSIGNMENT
};

export type Message = {
  userId: string;
  email: string | null; // null = in-app only
  type: string;
  message: string; // the in-app text
  subject: string;
  body: string; // the email text
  dedupeKey: string;
  bookingId: string | null;
};

// "Wed 14 Oct, 10:00 am" in India time.
export const when = (d: Date) =>
  DateTime.fromJSDate(d, { zone: BUSINESS_TZ }).toFormat('ccc d LLL, h:mm a').replace(/AM|PM/, (m) => m.toLowerCase());

const rupees = (amount: string) => `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Events the phone-only customer cannot see by email: the manager gets a "call this customer" note instead
// (there is no SMS or WhatsApp sending in v1).
const CALLABLE: NotifyType[] = ['BOOKING_CONFIRMED', 'TECHNICIAN_ASSIGNED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'REMINDER_2H', 'EXTRA_CHARGE_REQUESTED'];

export function buildMessages(type: NotifyType, ctx: BuildCtx): Message[] {
  const { booking: b, customer, technician, managers } = ctx;
  const start = when(b.startAt);
  const startMs = b.startAt.getTime();
  const service = b.serviceName;
  const out: Message[] = [];

  const link = {
    customer: `${ctx.frontendUrl}/bookings/${b.id}`,
    technician: `${ctx.frontendUrl}/tech/jobs/${b.id}`,
    manager: `${ctx.frontendUrl}/staff/bookings/${b.id}`,
  };

  const say = (p: Person, audience: keyof typeof link, msgType: string, message: string, subject: string, key: string, email = true) =>
    out.push({
      userId: p.id,
      email: email ? p.email : null,
      type: msgType,
      message,
      subject,
      body: `Hi ${p.name},\n\n${message}\n\nOpen: ${link[audience]}\n\nHomeFix Appliance Services`,
      dedupeKey: key,
      bookingId: b.id,
    });

  const toCustomer = (msgType: string, message: string, subject: string, detail = '') =>
    say(customer, 'customer', msgType, message, subject, `${msgType}:${b.id}:${customer.id}${detail}`);
  const toTech = (msgType: string, message: string, subject: string, detail = '') => {
    if (technician) say(technician, 'technician', msgType, message, subject, `${msgType}:${b.id}:${technician.id}${detail}`);
  };
  const jobAssigned = () =>
    toTech('JOB_ASSIGNED', `New job ${b.bookingNumber}: ${service} at ${b.area}, ${start}.`, `New job ${b.bookingNumber}`);

  switch (type) {
    case 'BOOKING_CONFIRMED':
      toCustomer(type, `Your ${service} is booked for ${start}.`, `Booking ${b.bookingNumber} confirmed`);
      jobAssigned();
      break;
    case 'TECHNICIAN_ASSIGNED':
      if (technician) {
        toCustomer(type, `${technician.name} will visit you for your ${service} on ${start}.`, `Technician assigned to ${b.bookingNumber}`, `:${technician.id}`);
      }
      jobAssigned();
      break;
    case 'JOB_REMOVED':
      toTech(type, `You are no longer assigned to ${b.bookingNumber} (${service}, ${start}).`, `${b.bookingNumber} reassigned`, `:${startMs}`);
      break;
    case 'BOOKING_RESCHEDULED':
      toCustomer(type, `Your ${service} moved${ctx.previousStartAt ? ` from ${when(ctx.previousStartAt)}` : ''} to ${start}.`, `${b.bookingNumber} rescheduled`, `:${startMs}`);
      toTech(type, `${b.bookingNumber} moved to ${start} (${service} at ${b.area}).`, `${b.bookingNumber} rescheduled`, `:${startMs}`);
      break;
    case 'BOOKING_CANCELLED':
      toCustomer(type, `Your ${service} booking ${b.bookingNumber} for ${start} was cancelled.`, `${b.bookingNumber} cancelled`);
      toTech(type, `${b.bookingNumber} (${service}, ${start}) was cancelled.`, `${b.bookingNumber} cancelled`);
      break;
    case 'TECHNICIAN_EN_ROUTE':
      if (technician) toCustomer(type, `${technician.name} is on the way for your ${service}.`, `Your technician is on the way`, `:${technician.id}`);
      break;
    case 'EXTRA_CHARGE_REQUESTED':
      if (ctx.extra) {
        toCustomer(
          type,
          `${technician?.name ?? 'The technician'} needs your approval for an extra ${rupees(ctx.extra.amount)}: ${ctx.extra.reason ?? 'additional work'}. Approve or decline in the app.`,
          `Approval needed for ${b.bookingNumber}`,
          `:${ctx.at ?? ''}`,
        );
      }
      break;
    case 'EXTRA_CHARGE_DECIDED':
      if (ctx.extra && ctx.decision) {
        toTech(type, `The customer ${ctx.decision === 'APPROVED' ? 'approved' : 'declined'} the extra ${rupees(ctx.extra.amount)} for ${b.bookingNumber}.`, `Extra charge ${ctx.decision.toLowerCase()}`, `:${ctx.at ?? ''}`);
      }
      break;
    case 'VISIT_COMPLETED':
      toCustomer(type, `Your ${service} visit is complete.${ctx.total ? ` Total to pay: ${rupees(ctx.total)}, in cash or UPI to the technician.` : ''}`, `${b.bookingNumber} completed`);
      break;
    case 'REVIEW_REQUEST':
      toCustomer(type, `How was your ${service} visit? Tell us in a minute.`, `How did we do? (${b.bookingNumber})`);
      break;
    case 'REMINDER_24H':
      toCustomer(type, `Reminder: your ${service} visit is tomorrow, ${start}.`, `Reminder: ${b.bookingNumber} tomorrow`, `:${startMs}`);
      toTech(type, `Reminder: ${b.bookingNumber} is tomorrow, ${start} at ${b.area}.`, `Reminder: ${b.bookingNumber} tomorrow`, `:${startMs}`);
      break;
    case 'REMINDER_2H':
      toCustomer(type, `Reminder: your ${service} visit is in about 2 hours, ${start}.`, `Reminder: ${b.bookingNumber} in 2 hours`, `:${startMs}`);
      toTech(type, `Reminder: ${b.bookingNumber} starts in about 2 hours, ${start} at ${b.area}.`, `Reminder: ${b.bookingNumber} in 2 hours`, `:${startMs}`);
      break;
    case 'NEEDS_REASSIGNMENT':
      for (const m of managers) {
        out.push({
          userId: m.id,
          email: m.email,
          type,
          message: `${ctx.count ?? 0} booking${ctx.count === 1 ? ' needs' : 's need'} a new technician${ctx.technicianName ? ` (${ctx.technicianName} is on leave)` : ''}.`,
          subject: 'Bookings need a new technician',
          body: `Hi ${m.name},\n\n${ctx.count ?? 0} booking${ctx.count === 1 ? ' needs' : 's need'} a new technician${ctx.technicianName ? ` because ${ctx.technicianName} is on leave` : ''}.\n\nOpen: ${ctx.frontendUrl}/staff/reassignments\n\nHomeFix Appliance Services`,
          dedupeKey: `NEEDS_REASSIGNMENT:${ctx.timeOffId ?? ctx.at}:${m.id}`,
          bookingId: null,
        });
      }
      break;
  }

  // A customer with no email gets the in-app note only, so the manager is told to phone them.
  if (!customer.email && CALLABLE.includes(type)) {
    const forCustomer = out.find((m) => m.userId === customer.id);
    if (forCustomer) {
      for (const m of managers) {
        out.push({
          userId: m.id,
          email: null,
          type: 'CALL_CUSTOMER',
          message: `Call ${customer.name}${customer.phone ? ` on ${customer.phone}` : ''}: ${forCustomer.message}`,
          subject: '',
          body: '',
          dedupeKey: `CALL:${forCustomer.dedupeKey}:${m.id}`,
          bookingId: b.id,
        });
      }
    }
  }
  return out;
}
