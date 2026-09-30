import { describe, expect, it } from 'vitest';
import { buildMessages, when, type BuildCtx } from './notification.build';

// 14 Oct 2026, 10:00 IST = 04:30 UTC
const startAt = new Date('2026-10-14T04:30:00Z');

const ctx = (over: Partial<BuildCtx> = {}): BuildCtx => ({
  frontendUrl: 'https://app.test',
  booking: { id: 'b1', bookingNumber: 'BH-2026-00005', startAt, serviceName: 'Washing Machine Repair', applianceName: 'LG Washing Machine', area: 'Kondapur' },
  customer: { id: 'c1', name: 'Ravi', email: 'ravi@x.test', phone: '9000000010' },
  technician: { id: 't1', name: 'Rahul', email: 'rahul@x.test' },
  managers: [
    { id: 'm1', name: 'Vikram', email: 'vikram@x.test' },
    { id: 'o1', name: 'Anita', email: 'anita@x.test' },
  ],
  ...over,
});

const to = (msgs: ReturnType<typeof buildMessages>, userId: string) => msgs.filter((m) => m.userId === userId);

describe('time text', () => {
  it('is India time, readable', () => {
    expect(when(startAt)).toBe('Wed 14 Oct, 10:00 am');
    expect(when(new Date('2026-10-14T12:30:00Z'))).toBe('Wed 14 Oct, 6:00 pm');
  });
});

describe('who is told what', () => {
  it('a new booking: the customer is confirmed and the technician gets the job', () => {
    const msgs = buildMessages('BOOKING_CONFIRMED', ctx());
    expect(msgs.map((m) => [m.userId, m.type])).toEqual([['c1', 'BOOKING_CONFIRMED'], ['t1', 'JOB_ASSIGNED']]);
    expect(msgs[0].message).toBe('Your Washing Machine Repair is booked for Wed 14 Oct, 10:00 am.');
    expect(msgs[0].email).toBe('ravi@x.test');
    expect(msgs[0].body).toContain('https://app.test/bookings/b1');
    expect(msgs[1].body).toContain('https://app.test/tech/jobs/b1');
    expect(msgs[1].message).toContain('Kondapur');
  });

  it('assigned: the customer learns the name, the new technician gets the job', () => {
    const msgs = buildMessages('TECHNICIAN_ASSIGNED', ctx());
    expect(to(msgs, 'c1')[0].message).toContain('Rahul will visit you');
    expect(to(msgs, 't1')[0].type).toBe('JOB_ASSIGNED');
  });

  it('removed from a job: only that technician is told', () => {
    const msgs = buildMessages('JOB_REMOVED', ctx());
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ userId: 't1', type: 'JOB_REMOVED' });
  });

  it('rescheduled: customer and technician, with the old and new time', () => {
    const msgs = buildMessages('BOOKING_RESCHEDULED', ctx({ previousStartAt: new Date('2026-10-13T04:30:00Z') }));
    expect(msgs.map((m) => m.userId)).toEqual(['c1', 't1']);
    expect(msgs[0].message).toBe('Your Washing Machine Repair moved from Tue 13 Oct, 10:00 am to Wed 14 Oct, 10:00 am.');
  });

  it('cancelled, on the way, reminders and completion go to the right people', () => {
    expect(buildMessages('BOOKING_CANCELLED', ctx()).map((m) => m.userId)).toEqual(['c1', 't1']);
    expect(buildMessages('TECHNICIAN_EN_ROUTE', ctx()).map((m) => m.userId)).toEqual(['c1']);
    expect(buildMessages('REMINDER_24H', ctx()).map((m) => [m.userId, m.message.includes('tomorrow')])).toEqual([['c1', true], ['t1', true]]);
    expect(buildMessages('REMINDER_2H', ctx()).map((m) => m.userId)).toEqual(['c1', 't1']);
    expect(buildMessages('REVIEW_REQUEST', ctx()).map((m) => m.userId)).toEqual(['c1']);
    const done = buildMessages('VISIT_COMPLETED', ctx({ total: '749.00' }));
    expect(done[0].message).toBe('Your Washing Machine Repair visit is complete. Total to pay: ₹749, in cash or UPI to the technician.');
  });

  it('extra charge: the customer is asked, the technician hears the answer', () => {
    const asked = buildMessages('EXTRA_CHARGE_REQUESTED', ctx({ extra: { amount: '250.00', reason: 'Replace the drain pump' }, at: 't1' }));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ userId: 'c1', type: 'EXTRA_CHARGE_REQUESTED' });
    expect(asked[0].message).toContain('₹250');
    expect(asked[0].message).toContain('Replace the drain pump');

    const answer = buildMessages('EXTRA_CHARGE_DECIDED', ctx({ extra: { amount: '250.00', reason: null }, decision: 'DECLINED', at: 't2' }));
    expect(answer).toHaveLength(1);
    expect(answer[0]).toMatchObject({ userId: 't1' });
    expect(answer[0].message).toContain('declined');
  });

  it('time off over bookings: every manager and owner is told, by email too', () => {
    const msgs = buildMessages('NEEDS_REASSIGNMENT', ctx({ count: 2, technicianName: 'Rahul', timeOffId: 'to1' }));
    expect(msgs.map((m) => m.userId)).toEqual(['m1', 'o1']);
    expect(msgs[0].message).toBe('2 bookings need a new technician (Rahul is on leave).');
    expect(msgs[0].email).toBe('vikram@x.test');
    expect(msgs[0].body).toContain('https://app.test/staff/reassignments');
    expect(buildMessages('NEEDS_REASSIGNMENT', ctx({ count: 1 }))[0].message).toBe('1 booking needs a new technician.');
  });

  it('a job with no technician just leaves out the technician messages', () => {
    const msgs = buildMessages('BOOKING_CONFIRMED', ctx({ technician: null }));
    expect(msgs.map((m) => m.userId)).toEqual(['c1']);
  });
});

describe('customers without an email', () => {
  const phoneOnly = ctx({ customer: { id: 'c1', name: 'Priya', email: null, phone: '9000000011' } });

  it('get the in-app note only, and each manager gets a "call this customer" note', () => {
    const msgs = buildMessages('BOOKING_CONFIRMED', phoneOnly);
    const forCustomer = to(msgs, 'c1');
    expect(forCustomer).toHaveLength(1);
    expect(forCustomer[0].email).toBeNull();

    const calls = msgs.filter((m) => m.type === 'CALL_CUSTOMER');
    expect(calls.map((m) => m.userId)).toEqual(['m1', 'o1']);
    expect(calls[0].message).toBe('Call Priya on 9000000011: Your Washing Machine Repair is booked for Wed 14 Oct, 10:00 am.');
    expect(calls[0].email).toBeNull(); // in-app only: managers are not emailed for this
  });

  it('only for events where a phone call helps (not the 24 h reminder or the review request)', () => {
    for (const type of ['BOOKING_CONFIRMED', 'TECHNICIAN_ASSIGNED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'REMINDER_2H'] as const) {
      expect(buildMessages(type, phoneOnly).some((m) => m.type === 'CALL_CUSTOMER'), type).toBe(true);
    }
    for (const type of ['REMINDER_24H', 'REVIEW_REQUEST', 'TECHNICIAN_EN_ROUTE', 'VISIT_COMPLETED'] as const) {
      expect(buildMessages(type, phoneOnly).some((m) => m.type === 'CALL_CUSTOMER'), type).toBe(false);
    }
  });

  it('a customer with an email never triggers a call note', () => {
    expect(buildMessages('BOOKING_CONFIRMED', ctx()).some((m) => m.type === 'CALL_CUSTOMER')).toBe(false);
  });
});

describe('de-dupe keys', () => {
  it('are unique per person and stable, so a retried job cannot add a copy', () => {
    const a = buildMessages('BOOKING_CONFIRMED', ctx());
    const b = buildMessages('BOOKING_CONFIRMED', ctx());
    expect(a.map((m) => m.dedupeKey)).toEqual(b.map((m) => m.dedupeKey));
    expect(new Set(a.map((m) => m.dedupeKey)).size).toBe(a.length);
  });

  it('change when the visit time changes (a second reminder after a reschedule is a new message)', () => {
    const before = buildMessages('REMINDER_2H', ctx());
    const after = buildMessages('REMINDER_2H', ctx({ booking: { ...ctx().booking, startAt: new Date('2026-10-15T04:30:00Z') } }));
    expect(after[0].dedupeKey).not.toBe(before[0].dedupeKey);
  });

  it('extra charge asked twice gives two different messages', () => {
    const e = { amount: '250.00', reason: 'x' };
    expect(buildMessages('EXTRA_CHARGE_REQUESTED', ctx({ extra: e, at: 'a' }))[0].dedupeKey).not.toBe(
      buildMessages('EXTRA_CHARGE_REQUESTED', ctx({ extra: e, at: 'b' }))[0].dedupeKey,
    );
  });
});
