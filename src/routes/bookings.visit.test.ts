import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma';
import { resetDb } from '../test/db';
import { actor, loginAs } from '../test/http';
import { at, bookingBody, makeWorld, type World } from '../test/world';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await makeWorld(2);
});
afterAll(() => prisma.$disconnect());

const audit = (action: string) => prisma.auditLog.findMany({ where: { action } });

async function techAgent(t: { userId: string }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
  return loginAs(user.email!);
}

// A customer booking, given to the first technician (status ASSIGNED, as the manager would do).
async function assignedJob(hhmm = '10:00') {
  const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body;
  const tech = w.techs.find((t) => t.id === b.technician.id)!;
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'ASSIGNED' } });
  return { id: b.id as string, tech, agent: await techAgent(tech) };
}

// ...and taken through to IN_PROGRESS.
async function inProgressJob(hhmm = '10:00') {
  const job = await assignedJob(hhmm);
  for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) {
    expect((await job.agent.post(`/bookings/${job.id}/status`).send({ to })).status).toBe(200);
  }
  return job;
}

describe('a technician sees only their own jobs', () => {
  it('lists and opens assigned bookings; another technician gets 404', async () => {
    const job = await assignedJob();
    const list = await job.agent.get('/bookings?sort=soonest');
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([job.id]);

    const detail = await job.agent.get(`/bookings/${job.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.customer.name).toBeTruthy(); // they need the customer's name and phone
    expect(detail.body.history[0].changedBy).toBeUndefined();

    const other = w.techs.find((t) => t.id !== job.tech.id)!;
    const otherAgent = await techAgent(other);
    expect((await otherAgent.get(`/bookings/${job.id}`)).status).toBe(404);
    expect((await otherAgent.get('/bookings')).body.total).toBe(0);
  });

  it('hideCancelled leaves out cancelled and no-show jobs, and the total matches', async () => {
    const live = await assignedJob('10:00');
    const gone = await assignedJob('13:00');
    await prisma.booking.update({ where: { id: gone.id }, data: { status: 'NO_SHOW' } });
    const all = await live.agent.get('/bookings');
    expect(all.body.total).toBe(1 + (gone.tech.id === live.tech.id ? 1 : 0));
    const open = await live.agent.get('/bookings?hideCancelled=true');
    expect(open.body.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
    expect(open.body.total).toBe(1);
  });

  it('cannot book, move, cancel, assign or no-show', async () => {
    const job = await assignedJob();
    expect((await job.agent.post('/bookings').send(bookingBody(w, '12:00'))).status).toBe(403);
    expect((await job.agent.post(`/bookings/${job.id}/cancel`).send({})).status).toBe(403);
    expect((await job.agent.post(`/bookings/${job.id}/reschedule`).send({ startAt: at('14:00').toISOString() })).status).toBe(403);
    expect((await job.agent.post(`/bookings/${job.id}/assign`).send({ technicianId: job.tech.id })).status).toBe(403);
    expect((await job.agent.post(`/bookings/${job.id}/no-show`).send({})).status).toBe(403);
  });

  it('can look up free times (customer mode) for a follow-up', async () => {
    const job = await assignedJob();
    const res = await job.agent.get(`/availability?serviceId=${w.serviceId}&date=${at('10:00').toISOString().slice(0, 10)}&area=Kondapur`);
    expect(res.status).toBe(200);
    expect(res.body.slots[0].technicians).toBeUndefined();
  });
});

describe('status buttons', () => {
  it('moves forward one step at a time and opens the visit at IN_PROGRESS', async () => {
    const job = await assignedJob();
    const step = (to: string) => job.agent.post(`/bookings/${job.id}/status`).send({ to });

    expect((await step('ARRIVED')).status).toBe(409); // cannot skip "on the way"
    expect((await step('EN_ROUTE')).body.status).toBe('EN_ROUTE');
    expect((await step('EN_ROUTE')).status).toBe(409); // cannot repeat
    expect((await step('ARRIVED')).body.status).toBe('ARRIVED');
    expect(await prisma.serviceVisit.count()).toBe(0);
    expect((await step('IN_PROGRESS')).body.status).toBe('IN_PROGRESS');

    const visit = await prisma.serviceVisit.findUniqueOrThrow({ where: { bookingId: job.id } });
    expect(visit).toMatchObject({ technicianId: job.tech.id, completedAt: null });
    expect(visit.startedAt).toBeTruthy();

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: job.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']);
    expect(history.at(-1)!.changedByUserId).toBe(job.tech.userId);
    expect(await audit('BOOKING_IN_PROGRESS')).toHaveLength(1);
  });

  it('only COMPLETED is not a button: it goes through "complete visit"', async () => {
    const job = await inProgressJob();
    expect((await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'COMPLETED' })).status).toBe(400);
  });

  it("is for the assigned technician only: another technician 404, customer and staff 403", async () => {
    const job = await assignedJob();
    const other = await techAgent(w.techs.find((t) => t.id !== job.tech.id)!);
    expect((await other.post(`/bookings/${job.id}/status`).send({ to: 'EN_ROUTE' })).status).toBe(404);
    expect((await w.customer.agent.post(`/bookings/${job.id}/status`).send({ to: 'EN_ROUTE' })).status).toBe(403);
    const { agent: manager } = await actor('MANAGER');
    expect((await manager.post(`/bookings/${job.id}/status`).send({ to: 'EN_ROUTE' })).status).toBe(403);
  });
});

describe('the visit', () => {
  it('saves notes while the work is in progress, and not before', async () => {
    const job = await assignedJob();
    expect((await job.agent.patch(`/bookings/${job.id}/visit`).send({ diagnosis: 'Compressor' })).status).toBe(409);

    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'EN_ROUTE' });
    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'ARRIVED' });
    await job.agent.post(`/bookings/${job.id}/status`).send({ to: 'IN_PROGRESS' });
    const res = await job.agent.patch(`/bookings/${job.id}/visit`).send({ diagnosis: 'Faulty start relay', partsNote: 'Relay 250V' });
    expect(res.status).toBe(200);
    const visit = (await job.agent.get(`/bookings/${job.id}`)).body.visit;
    expect(visit).toMatchObject({ diagnosis: 'Faulty start relay', partsNote: 'Relay 250V', workPerformed: null });
  });

  it('completing needs the diagnosis and the work performed', async () => {
    const job = await inProgressJob();
    const complete = (b: object) => job.agent.post(`/bookings/${job.id}/visit/complete`).send(b);
    expect((await complete({})).status).toBe(400);
    expect((await complete({ diagnosis: 'Faulty relay' })).status).toBe(400);
    expect((await complete({ diagnosis: 'ok', workPerformed: 'Replaced' })).status).toBe(400); // too short to mean anything

    const res = await complete({ diagnosis: 'Faulty start relay', workPerformed: 'Replaced the relay and tested', result: 'Cooling again' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');

    const detail = (await job.agent.get(`/bookings/${job.id}`)).body;
    expect(detail.visit).toMatchObject({ diagnosis: 'Faulty start relay', result: 'Cooling again', finalAmount: '599.00' });
    expect(detail.visit.completedAt).toBeTruthy();
    expect((await audit('VISIT_COMPLETED'))).toHaveLength(1);
    // Done: no more edits, and it cannot be completed twice.
    expect((await job.agent.patch(`/bookings/${job.id}/visit`).send({ notes: 'late' })).status).toBe(409);
    expect((await complete({ diagnosis: 'Faulty start relay', workPerformed: 'Again' })).status).toBe(409);
  });
});

describe('extra charge', () => {
  const propose = (job: { id: string; agent: Awaited<ReturnType<typeof techAgent>> }, amount = 250) =>
    job.agent.post(`/bookings/${job.id}/visit/extra-charge`).send({ amount, reason: 'Gas refill needed' });
  const done = { diagnosis: 'Low gas', workPerformed: 'Refilled the gas and checked for leaks' };

  it('proposed, blocks completion, approved by the customer, and the final amount adds it', async () => {
    const job = await inProgressJob();
    const res = await propose(job, 250);
    expect(res.status).toBe(200);
    expect((await job.agent.get(`/bookings/${job.id}`)).body.visit.extraCharge).toMatchObject({ status: 'PROPOSED', amount: '250.00', reason: 'Gas refill needed' });

    expect((await propose(job)).status).toBe(409); // one waiting already
    const blocked = await job.agent.post(`/bookings/${job.id}/visit/complete`).send(done);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EXTRA_CHARGE_PENDING');

    const approve = await w.customer.agent.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' });
    expect(approve.status).toBe(200);
    const visit = await prisma.serviceVisit.findUniqueOrThrow({ where: { bookingId: job.id } });
    expect(visit).toMatchObject({ extraChargeStatus: 'APPROVED', extraChargeDecidedByUserId: w.customer.user.id });
    expect(visit.extraChargeDecidedAt).toBeTruthy();
    expect((await audit('EXTRA_CHARGE_APPROVED'))[0].metadata).toMatchObject({ decidedByRole: 'CUSTOMER', onBehalfOfCustomer: false });

    await job.agent.post(`/bookings/${job.id}/visit/complete`).send(done);
    const final = (await w.customer.agent.get(`/bookings/${job.id}`)).body.visit;
    expect(final.finalAmount).toBe('849.00'); // 599 base + 250 approved
    expect((await propose(job)).status).toBe(409); // visit is finished
  });

  it('a declined charge is not added, and a new one can be proposed', async () => {
    const job = await inProgressJob();
    await propose(job, 300);
    await w.customer.agent.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'DECLINED' });
    expect((await propose(job, 200)).status).toBe(200); // a smaller offer
    await w.customer.agent.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'DECLINED' });
    await job.agent.post(`/bookings/${job.id}/visit/complete`).send(done);
    expect((await w.customer.agent.get(`/bookings/${job.id}`)).body.visit).toMatchObject({ finalAmount: '599.00', extraCharge: { status: 'DECLINED' } });
    expect(await audit('EXTRA_CHARGE_DECLINED')).toHaveLength(2);
  });

  it('the manager can record the customer\'s phone answer, and it is marked as on behalf', async () => {
    const job = await inProgressJob();
    await propose(job);
    const { user, agent: manager } = await actor('MANAGER');
    expect((await manager.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' })).status).toBe(200);
    const visit = await prisma.serviceVisit.findUniqueOrThrow({ where: { bookingId: job.id } });
    expect(visit.extraChargeDecidedByUserId).toBe(user.id);
    expect((await audit('EXTRA_CHARGE_APPROVED'))[0].metadata).toMatchObject({ decidedByRole: 'MANAGER', onBehalfOfCustomer: true });
  });

  it('only the right people decide, and only when something is waiting', async () => {
    const job = await inProgressJob();
    const decide = (agent: typeof w.customer.agent) => agent.post(`/bookings/${job.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' });
    expect((await decide(w.customer.agent)).status).toBe(409); // nothing proposed yet

    await propose(job);
    expect((await decide(job.agent)).status).toBe(403); // the technician cannot approve their own charge
    const stranger = await w.addCustomer();
    expect((await decide(stranger.agent)).status).toBe(404);
    expect((await decide(w.customer.agent)).status).toBe(200);
    expect((await decide(w.customer.agent)).status).toBe(409); // already decided
  });

  it('validates the amount and reason', async () => {
    const job = await inProgressJob();
    const send = (b: object) => job.agent.post(`/bookings/${job.id}/visit/extra-charge`).send(b);
    expect((await send({ amount: 0, reason: 'Gas refill' })).status).toBe(400);
    expect((await send({ amount: -50, reason: 'Gas refill' })).status).toBe(400);
    expect((await send({ amount: 10.123, reason: 'Gas refill' })).status).toBe(400);
    expect((await send({ amount: 100, reason: '' })).status).toBe(400);
  });
});

describe('follow-up visit', () => {
  it('the technician books a second visit linked to the first, for the same customer, appliance and address', async () => {
    const job = await inProgressJob('10:00');
    const res = await job.agent.post(`/bookings/${job.id}/follow-up`).send({ startAt: at('10:00', 7).toISOString() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      customer: { id: w.customer.user.id },
      appliance: { id: w.customer.applianceId },
      address: { id: w.customer.addressId },
      createdByUserId: job.tech.userId,
      problemDescription: expect.stringContaining('Follow-up to'),
    });

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.followUpOfBookingId).toBe(job.id);
    const detail = (await w.customer.agent.get(`/bookings/${res.body.id}`)).body;
    expect(detail.followUpOf).toMatchObject({ id: job.id });
    expect(detail.history[0].note).toBe('Follow-up visit');
    expect((await audit('BOOKING_FOLLOW_UP_CREATED'))[0].metadata).toMatchObject({ followUpOfBookingId: job.id });
  });

  it('a manager can create one, choosing the technician, and it can follow a completed visit', async () => {
    const job = await inProgressJob('10:00');
    await job.agent.post(`/bookings/${job.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Ordered a new part' });
    const { agent: manager } = await actor('MANAGER');
    const other = w.techs.find((t) => t.id !== job.tech.id)!;
    const res = await manager.post(`/bookings/${job.id}/follow-up`).send({ startAt: at('11:00', 7).toISOString(), technicianId: other.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'ASSIGNED', technician: { id: other.id } });
  });

  it('is refused before the visit starts, for customers, and for another technician', async () => {
    const early = await assignedJob('10:00');
    const body = { startAt: at('10:00', 7).toISOString() };
    expect((await early.agent.post(`/bookings/${early.id}/follow-up`).send(body)).status).toBe(409);

    const job = await inProgressJob('13:00');
    expect((await w.customer.agent.post(`/bookings/${job.id}/follow-up`).send(body)).status).toBe(403);
    const other = await techAgent(w.techs.find((t) => t.id !== job.tech.id)!);
    expect((await other.post(`/bookings/${job.id}/follow-up`).send(body)).status).toBe(404);
    expect((await job.agent.post(`/bookings/${job.id}/follow-up`).send({ ...body, technicianId: job.tech.id })).status).toBe(403); // staff-only field
  });

  it('must be a real slot from the availability engine', async () => {
    const job = await inProgressJob('10:00');
    expect((await job.agent.post(`/bookings/${job.id}/follow-up`).send({ startAt: at('10:15').toISOString() })).status).toBe(409); // not on the grid
  });
});

describe('appliance service history', () => {
  it('lists completed visits with the amount, technician and the follow-up link', async () => {
    const first = await inProgressJob('10:00');
    await first.agent.post(`/bookings/${first.id}/visit/extra-charge`).send({ amount: 400, reason: 'New part' });
    await w.customer.agent.post(`/bookings/${first.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' });
    await first.agent.post(`/bookings/${first.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Replaced the relay' });

    const fu = (await first.agent.post(`/bookings/${first.id}/follow-up`).send({ startAt: at('10:00', 7).toISOString() })).body;
    await prisma.booking.update({ where: { id: fu.id }, data: { status: 'COMPLETED' } });

    const res = await w.customer.agent.get(`/appliances/${w.customer.applianceId}/history`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const byId = Object.fromEntries(res.body.items.map((i: { bookingId: string }) => [i.bookingId, i]));
    expect(byId[first.id]).toMatchObject({ service: { name: 'Fridge Repair' }, amount: '999.00', diagnosis: 'Faulty relay', followUpOf: null });
    expect(byId[fu.id].followUpOf).toMatchObject({ id: first.id });
  });

  it('shows only completed visits, only to the owner or staff', async () => {
    const job = await assignedJob(); // not completed
    void job;
    const url = `/appliances/${w.customer.applianceId}/history`;
    expect((await w.customer.agent.get(url)).body.total).toBe(0);
    const stranger = await w.addCustomer();
    expect((await stranger.agent.get(url)).status).toBe(404);
    const { agent: manager } = await actor('MANAGER');
    expect((await manager.get(url)).status).toBe(200);
  });
});
