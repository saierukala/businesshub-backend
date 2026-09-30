import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '../db/prisma';
import { events } from '../jobs/events';
import { queueApi } from '../jobs/queue';
import { mailer } from '../services/email.service';
import { processNotification } from '../services/notification.service';
import { createUser, resetDb } from '../test/db';
import { actor, app, loginAs } from '../test/http';
import { queued, runJobs } from '../test/jobs';
import { at, bookingBody, makeWorld, monday, type World } from '../test/world';

const sendSpy = vi.spyOn(mailer, 'send').mockResolvedValue();

let w: World;
beforeEach(async () => {
  await resetDb();
  sendSpy.mockReset();
  sendSpy.mockResolvedValue();
  w = await makeWorld(2);
});
afterAll(() => prisma.$disconnect());

const rowsFor = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
const types = async (userId: string) => (await rowsFor(userId)).map((r) => r.type);
const emailsTo = (to: string) => sendSpy.mock.calls.filter(([m]) => m.to === to).map(([m]) => m);
async function techAgent(t: { userId: string }) {
  return loginAs((await prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).email!);
}
const book = async (hhmm = '10:00') => (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body as { id: string; technician: { id: string } };

describe('a new booking', () => {
  it('only queues jobs: a confirmation now, reminders 24 h and 2 h before the visit', async () => {
    const b = await book('10:00');
    expect(sendSpy).not.toHaveBeenCalled(); // the API returned without sending anything
    expect(await prisma.notification.count()).toBe(0);

    const jobs = queued();
    expect(jobs.map((j) => j.type)).toEqual(['BOOKING_CONFIRMED', 'REMINDER_24H', 'REMINDER_2H']);
    expect(jobs[1].startAfter).toEqual(new Date(at('10:00').getTime() - 24 * 3600_000));
    expect(jobs[2].startAfter).toEqual(new Date(at('10:00').getTime() - 2 * 3600_000));
    expect(jobs[1].data).toMatchObject({ bookingId: b.id, expectStartAt: at('10:00').toISOString() });
  });

  it('the worker then tells the customer (in-app + email) and the technician', async () => {
    const b = await book();
    const tech = w.techs.find((t) => t.id === b.technician.id)!;
    await runJobs(new Date());

    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED']);
    expect(await types(tech.userId)).toEqual(['JOB_ASSIGNED']);
    expect(emailsTo(w.customer.user.email!)).toHaveLength(1);
    expect(emailsTo(w.customer.user.email!)[0].subject).toMatch(/^Booking BH-\d{4}-00001 confirmed$/);
    const techUser = await prisma.user.findUniqueOrThrow({ where: { id: tech.userId } });
    expect(emailsTo(techUser.email!)).toHaveLength(1);
    expect((await rowsFor(w.customer.user.id))[0].emailedAt).toBeTruthy();
    expect(queued().map((j) => j.type)).toEqual(['REMINDER_24H', 'REMINDER_2H']); // the reminders are still waiting
  });

  it('skips a reminder whose time has already passed', async () => {
    // A visit 90 minutes away: both the 24 h and the 2 h reminder times are behind us.
    await events.bookingCreated({ id: 'any', startAt: new Date(Date.now() + 90 * 60_000) }, new Date());
    expect(queued().map((j) => j.type)).toEqual(['BOOKING_CONFIRMED']);
  });
});

describe('reading your notifications', () => {
  it('a person sees only their own, with an unread count; marking read is theirs alone', async () => {
    const b = await book();
    await runJobs(new Date());
    const tech = await techAgent(w.techs.find((t) => t.id === b.technician.id)!);

    const mine = await w.customer.agent.get('/notifications');
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ total: 1, unread: 1 });
    expect(mine.body.items[0]).toMatchObject({ type: 'BOOKING_CONFIRMED', read: false, bookingId: b.id });
    expect((await tech.get('/notifications')).body.items.map((i: { type: string }) => i.type)).toEqual(['JOB_ASSIGNED']);
    expect((await w.customer.agent.get('/notifications/unread-count')).body).toEqual({ unread: 1 });

    const id = mine.body.items[0].id;
    expect((await tech.post(`/notifications/${id}/read`)).status).toBe(404); // not theirs
    expect((await w.customer.agent.get('/notifications/unread-count')).body.unread).toBe(1);
    expect((await w.customer.agent.post(`/notifications/${id}/read`)).body).toEqual({ unread: 0 });
    expect((await w.customer.agent.get('/notifications?unread=true')).body.total).toBe(0);
  });

  it('read-all, pagination and login are enforced', async () => {
    await book('10:00');
    await book('13:00');
    await runJobs(new Date());
    const page = await w.customer.agent.get('/notifications?pageSize=1');
    expect(page.body).toMatchObject({ total: 2, pageSize: 1, totalPages: 2, unread: 2 });
    expect((await w.customer.agent.post('/notifications/read-all')).body).toEqual({ unread: 0 });
    expect((await request(app).get('/notifications')).status).toBe(401);
  });
});

describe('customers with no email', () => {
  it('get the in-app note only, and the managers get a "call this customer" note', async () => {
    const manager = await actor('MANAGER');
    const owner = await actor('OWNER');
    const phoneOnly = await createUser('CUSTOMER', { email: null, password: false });
    const address = await prisma.address.create({ data: { customerId: phoneOnly.id, label: 'Home', line1: 'Villa 12', area: 'Kondapur', city: 'Hyderabad' } });
    const appliance = await prisma.appliance.create({ data: { customerId: phoneOnly.id, categoryId: w.categoryId, brand: 'LG' } });
    await prisma.user.update({ where: { id: phoneOnly.id }, data: { phone: '9000000011' } });

    const res = await manager.agent.post('/bookings').send({ ...bookingBody(w, '10:00', { applianceId: appliance.id, addressId: address.id }), customerId: phoneOnly.id, source: 'PHONE' });
    expect(res.status).toBe(201);
    await runJobs(new Date());

    expect(await types(phoneOnly.id)).toEqual(['BOOKING_CONFIRMED']);
    expect(emailsTo('')).toHaveLength(0);
    const calls = await prisma.notification.findMany({ where: { type: 'CALL_CUSTOMER' } });
    expect(calls.map((c) => c.userId).sort()).toEqual([manager.user.id, owner.user.id].sort());
    expect(calls[0].message).toMatch(/^Call Test CUSTOMER on 9000000011: Your Fridge Repair is booked for /);
    expect(calls.every((c) => c.emailedAt === null)).toBe(true);
    // The only emails are to the technician: nobody was emailed on behalf of the phone-only customer.
    expect(sendSpy.mock.calls.every(([m]) => m.subject.startsWith('New job'))).toBe(true);
  });
});

describe('changes to a booking', () => {
  it('assigning tells the customer and the new technician; the old one is told they are off the job', async () => {
    const b = await book();
    await runJobs(new Date());
    const oldTech = w.techs.find((t) => t.id === b.technician.id)!;
    const newTech = w.techs.find((t) => t.id !== b.technician.id)!;
    const { agent: manager } = await actor('MANAGER');
    await manager.post(`/bookings/${b.id}/assign`).send({ technicianId: newTech.id });
    await runJobs(new Date());

    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED', 'TECHNICIAN_ASSIGNED']);
    expect(await types(newTech.userId)).toEqual(['JOB_ASSIGNED']);
    expect(await types(oldTech.userId)).toEqual(['JOB_ASSIGNED', 'JOB_REMOVED']);
  });

  it('assigning the technician who was already picked automatically does not tell them twice', async () => {
    const b = await book();
    await runJobs(new Date());
    const { agent: manager } = await actor('MANAGER');
    await manager.post(`/bookings/${b.id}/assign`).send({ technicianId: b.technician.id });
    await runJobs(new Date());
    const tech = w.techs.find((t) => t.id === b.technician.id)!;
    expect(await types(tech.userId)).toEqual(['JOB_ASSIGNED']); // one, not two
    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED', 'TECHNICIAN_ASSIGNED']);
  });

  it('rescheduling tells both, sets new reminders, and the old reminders do nothing when they wake up', async () => {
    const b = await book('10:00');
    await runJobs(new Date());
    const res = await w.customer.agent.post(`/bookings/${b.id}/reschedule`).send({ startAt: at('14:00').toISOString() });
    expect(res.status).toBe(200);

    const q = queued();
    expect(q.map((j) => j.type)).toEqual(['REMINDER_24H', 'REMINDER_2H', 'BOOKING_RESCHEDULED', 'REMINDER_24H', 'REMINDER_2H']);
    expect(q[3].startAfter).toEqual(new Date(at('14:00').getTime() - 24 * 3600_000));

    const results = await runJobs(at('14:00')); // long after every reminder was due
    const outcome = results.map((r) => [r.type, (r.result as { skipped?: string }).skipped ?? 'sent']);
    expect(outcome).toEqual([
      ['REMINDER_24H', 'booking was rescheduled'],
      ['REMINDER_2H', 'booking was rescheduled'],
      ['BOOKING_RESCHEDULED', 'sent'],
      ['REMINDER_24H', 'sent'],
      ['REMINDER_2H', 'sent'],
    ]);
    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'REMINDER_24H', 'REMINDER_2H']);
    const moved = (await rowsFor(w.customer.user.id)).find((r) => r.type === 'BOOKING_RESCHEDULED')!;
    expect(moved.message).toMatch(/^Your Fridge Repair moved from \w{3} \d+ \w{3}, 10:00 am to \w{3} \d+ \w{3}, 2:00 pm\.$/);
  });

  it('cancelling tells both, and the reminders that were waiting do nothing', async () => {
    const b = await book();
    await runJobs(new Date());
    await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({});
    const results = await runJobs(at('10:00'));
    expect(results.map((r) => [r.type, (r.result as { skipped?: string }).skipped ?? 'sent'])).toEqual([
      ['REMINDER_24H', 'booking is CANCELLED'],
      ['REMINDER_2H', 'booking is CANCELLED'],
      ['BOOKING_CANCELLED', 'sent'],
    ]);
    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED', 'BOOKING_CANCELLED']);
  });

  it('time off over bookings tells every manager and owner, by email too', async () => {
    const b = await book('10:00');
    await runJobs(new Date());
    sendSpy.mockClear();
    const manager = await actor('MANAGER');
    const owner = await actor('OWNER');
    const res = await manager.agent.post(`/technicians/${b.technician.id}/time-off`).send({
      startAt: at('00:00').toISOString(),
      endAt: monday.plus({ days: 1 }).toISO(),
      reason: 'SICK',
    });
    expect(res.body.bookingsNeedingReassignment).toBe(1);
    await runJobs(new Date());

    for (const m of [manager, owner]) {
      const row = (await rowsFor(m.user.id)).find((r) => r.type === 'NEEDS_REASSIGNMENT');
      expect(row?.message).toBe('1 booking needs a new technician (Test TECHNICIAN is on leave).');
      expect(emailsTo(m.user.email!)).toHaveLength(1);
    }
    // No bookings flagged, no message.
    await manager.agent.post(`/technicians/${w.techs.find((t) => t.id !== b.technician.id)!.id}/time-off`).send({
      startAt: at('00:00', 7).toISOString(),
      endAt: monday.plus({ days: 8 }).toISO(),
    });
    expect(queued().filter((j) => j.type === 'NEEDS_REASSIGNMENT')).toHaveLength(0);
  });
});

describe('the visit', () => {
  async function inProgress() {
    const b = await book();
    const tech = w.techs.find((t) => t.id === b.technician.id)!;
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'ASSIGNED' } });
    const agent = await techAgent(tech);
    return { id: b.id, tech, agent };
  }

  it('on the way, extra charge asked and answered, completed with the total, review request later', async () => {
    const job = await inProgress();
    await runJobs(new Date());

    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'EN_ROUTE' });
    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'ARRIVED' });
    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'IN_PROGRESS' });
    await job.agent.post(`/bookings/${job.id}/visit/extra-charge`).send({ amount: 250, reason: 'New part' });
    await w.customer.agent.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' });
    await job.agent.post(`/bookings/${job.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Replaced the relay' });
    await runJobs(new Date());

    expect(await types(w.customer.user.id)).toEqual(['BOOKING_CONFIRMED', 'TECHNICIAN_EN_ROUTE', 'EXTRA_CHARGE_REQUESTED', 'VISIT_COMPLETED']);
    const rows = await rowsFor(w.customer.user.id);
    expect(rows.find((r) => r.type === 'EXTRA_CHARGE_REQUESTED')!.message).toContain('₹250');
    expect(rows.find((r) => r.type === 'VISIT_COMPLETED')!.message).toContain('Total to pay: ₹849');
    expect((await types(job.tech.userId)).slice(-1)).toEqual(['EXTRA_CHARGE_DECIDED']);

    // The review request is queued for about 2 hours later, and only fires if the booking is still completed.
    const review = queued().find((j) => j.type === 'REVIEW_REQUEST')!;
    expect(review.data).toMatchObject({ requireStatus: 'COMPLETED' });
    expect(review.startAfter!.getTime() - Date.now()).toBeGreaterThan(119 * 60_000);
    expect(review.startAfter!.getTime() - Date.now()).toBeLessThan(121 * 60_000);
    expect(await types(w.customer.user.id)).not.toContain('REVIEW_REQUEST');

    await runJobs(new Date(Date.now() + 3 * 3600_000));
    expect((await types(w.customer.user.id)).slice(-1)).toEqual(['REVIEW_REQUEST']);
  });

  it('no review request if the booking is no longer completed', async () => {
    const job = await inProgress();
    for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) await job.agent.post(`/bookings/${job.id}/status`).send({ to });
    await job.agent.post(`/bookings/${job.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Replaced the relay' });
    await prisma.booking.update({ where: { id: job.id }, data: { status: 'IN_PROGRESS' } }); // e.g. reopened
    const results = await runJobs(new Date(Date.now() + 3 * 3600_000));
    expect(results.find((r) => r.type === 'REVIEW_REQUEST')!.result).toMatchObject({ skipped: 'booking is IN_PROGRESS' });
  });
});

describe('when things go wrong', () => {
  it('running the same job twice makes one notification and one email', async () => {
    const b = await book();
    const job = queued()[0].data;
    await processNotification(job);
    await processNotification(job);
    expect(await prisma.notification.count({ where: { userId: w.customer.user.id } })).toBe(1);
    expect(emailsTo(w.customer.user.email!)).toHaveLength(1);
    void b;
  });

  it('a failed email is retried: the in-app row is kept, the email is sent once on the retry', async () => {
    await book();
    const job = queued()[0].data;
    sendSpy.mockRejectedValueOnce(new Error('SMTP down'));

    await expect(processNotification(job)).rejects.toThrow(/email\(s\) failed: SMTP down/); // the queue would retry this
    const first = (await rowsFor(w.customer.user.id))[0];
    expect(first).toBeTruthy();
    expect(first.emailedAt).toBeNull();

    await processNotification(job); // the retry
    const rows = await rowsFor(w.customer.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].emailedAt).toBeTruthy();
    expect(emailsTo(w.customer.user.email!)).toHaveLength(2); // one failed attempt + one that worked
  });

  it('a job for a booking that no longer exists is skipped, not retried forever', async () => {
    const result = await processNotification({ type: 'BOOKING_CONFIRMED', bookingId: '7d9f7f2e-7d2b-4a56-9c1e-000000000000' });
    expect(result).toMatchObject({ skipped: 'booking not found' });
  });

  it('if the queue is down the booking is still made', async () => {
    const spy = vi.spyOn(queueApi, 'enqueue').mockRejectedValue(new Error('queue down'));
    const res = await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'));
    expect(res.status).toBe(201);
    expect(await prisma.booking.count()).toBe(1);
    spy.mockRestore();
  });
});
