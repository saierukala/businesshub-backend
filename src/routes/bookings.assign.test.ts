import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma';
import { createUser, resetDb } from '../test/db';
import { actor } from '../test/http';
import { at, bookingBody, makeWorld, monday, type World } from '../test/world';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await makeWorld(3);
});
afterAll(() => prisma.$disconnect());

const audit = (action: string) => prisma.auditLog.findMany({ where: { action } });

// A booking made by the customer, auto-assigned to whoever the system picks (status CONFIRMED).
async function book(hhmm = '10:00') {
  return (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body as { id: string; technician: { id: string } };
}

describe('who can take a booking', () => {
  it('lists the free qualified technicians, marking the current one', async () => {
    const b = await book();
    const { agent } = await actor('MANAGER');
    const res = await agent.get(`/bookings/${b.id}/technicians`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3); // the current one plus two others
    expect(res.body.items.filter((t: { isCurrent: boolean }) => t.isCurrent)).toHaveLength(1);
    expect(res.body.items.find((t: { isCurrent: boolean }) => t.isCurrent).id).toBe(b.technician.id);
  });

  it('leaves out technicians who are busy, on time off, or without the skill', async () => {
    const b = await book('10:00');
    const [a, away] = w.techs.filter((t) => t.id !== b.technician.id);
    // `a` gets an overlapping booking, `away` is on time off; a fourth technician has no skill at all.
    await prisma.booking.create({
      data: {
        bookingNumber: 'BH-T-1', customerId: w.customer.user.id, applianceId: w.customer.applianceId, serviceId: w.serviceId,
        addressId: w.customer.addressId, technicianId: a.id, problemDescription: 'x', startAt: at('10:30'), endAt: at('11:30'),
        createdByUserId: w.customer.user.id, status: 'CONFIRMED',
      },
    });
    await prisma.timeOff.create({ data: { technicianId: away.id, startAt: at('00:00'), endAt: at('23:59'), createdByUserId: away.userId } });
    const noSkillUser = await createUser('TECHNICIAN');
    await prisma.technician.create({
      data: {
        userId: noSkillUser.id, phone: '9000000099', areas: { create: [{ area: 'Kondapur' }] },
        workingHours: { create: Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startTime: '09:00', endTime: '18:00', isOff: d === 0 })) },
      },
    });

    const { agent } = await actor('OWNER');
    const ids = (await agent.get(`/bookings/${b.id}/technicians`)).body.items.map((t: { id: string }) => t.id);
    expect(ids).toEqual([b.technician.id]); // `a` is busy, `away` is on time off, the fourth has no skill
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(away.id);
  });
});

describe('assign and reassign', () => {
  it('assigning moves CONFIRMED to ASSIGNED, writes history and audit, and clears the flag', async () => {
    const b = await book();
    await prisma.booking.update({ where: { id: b.id }, data: { needsReassignment: true } });
    const target = w.techs.find((t) => t.id !== b.technician.id)!;
    const { user, agent } = await actor('MANAGER');

    const res = await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: target.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ASSIGNED', technician: { id: target.id }, needsReassignment: false });

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'CONFIRMED'], ['CONFIRMED', 'ASSIGNED']]);
    expect(history[1].changedByUserId).toBe(user.id);
    expect((await audit('TECHNICIAN_ASSIGNED'))[0].metadata).toMatchObject({ technicianId: target.id, previousTechnicianId: b.technician.id, wasFlagged: true });
  });

  it('reassigning keeps ASSIGNED, writes a history row and frees the old technician', async () => {
    const b = await book();
    const [first, second] = w.techs.filter((t) => t.id !== b.technician.id);
    const { agent } = await actor('MANAGER');
    await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: first.id });

    const res = await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: second.id });
    expect(res.body).toMatchObject({ status: 'ASSIGNED', technician: { id: second.id } });

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(history.at(-1)).toMatchObject({ fromStatus: 'ASSIGNED', toStatus: 'ASSIGNED' });
    expect(history.at(-1)!.note).toMatch(/^Reassigned from Test TECHNICIAN to Test TECHNICIAN$/);
    expect(await audit('TECHNICIAN_REASSIGNED')).toHaveLength(1);
    // The old technician can be booked for that time again.
    const again = await prisma.booking.count({ where: { technicianId: first.id, status: { not: 'CANCELLED' } } });
    expect(again).toBe(0);
  });

  it('refuses the same technician again, and a technician who is not in the free list', async () => {
    const b = await book();
    const { agent } = await actor('MANAGER');
    const other = w.techs.find((t) => t.id !== b.technician.id)!;
    await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: other.id });
    expect((await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: other.id })).status).toBe(400);

    const stranger = await prisma.technician.create({ data: { userId: (await createUser('TECHNICIAN')).id, phone: '9000000098' } }); // no skill, no area
    const res = await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: stranger.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('only CONFIRMED or ASSIGNED bookings can be given a technician', async () => {
    const { agent } = await actor('MANAGER');
    for (const status of ['EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      const b = await book(status === 'EN_ROUTE' ? '10:00' : '13:00');
      await prisma.booking.update({ where: { id: b.id }, data: { status } });
      const target = w.techs.find((t) => t.id !== b.technician.id)!;
      const res = await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: target.id });
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      await prisma.booking.delete({ where: { id: b.id } });
    }
  });

  it('is for Owner and Manager only', async () => {
    const b = await book();
    const target = w.techs.find((t) => t.id !== b.technician.id)!;
    expect((await w.customer.agent.post(`/bookings/${b.id}/assign`).send({ technicianId: target.id })).status).toBe(403);
    expect((await w.customer.agent.get(`/bookings/${b.id}/technicians`)).status).toBe(403);
    const tech = await actor('TECHNICIAN');
    expect((await tech.agent.post(`/bookings/${b.id}/assign`).send({ technicianId: target.id })).status).toBe(403);
    const { agent } = await actor('OWNER');
    expect((await agent.post('/bookings/7d9f7f2e-7d2b-4a56-9c1e-000000000000/assign').send({ technicianId: target.id })).status).toBe(404);
  });
});

describe('the "needs reassignment" queue', () => {
  it('time off flags the booking; assigning another technician clears it', async () => {
    const b = await book('10:00');
    const { agent } = await actor('MANAGER');

    const off = await agent.post(`/technicians/${b.technician.id}/time-off`).send({
      startAt: at('00:00').toISOString(),
      endAt: monday.plus({ days: 1 }).toISO(),
      reason: 'SICK',
    });
    expect(off.body.bookingsNeedingReassignment).toBe(1);
    expect(await audit('BOOKING_FLAGGED_REASSIGNMENT')).toHaveLength(1);

    const queue = await agent.get('/bookings?needsReassignment=true&sort=soonest');
    expect(queue.body.items.map((i: { id: string }) => i.id)).toEqual([b.id]);

    // The sick technician is no longer offered; the others are.
    const options = (await agent.get(`/bookings/${b.id}/technicians`)).body.items.map((t: { id: string }) => t.id);
    expect(options).not.toContain(b.technician.id);
    expect(options).toHaveLength(2);

    const res = await agent.post(`/bookings/${b.id}/assign`).send({ technicianId: options[0] });
    expect(res.body).toMatchObject({ status: 'ASSIGNED', needsReassignment: false });
    expect((await agent.get('/bookings?needsReassignment=true')).body.total).toBe(0);
  });

  it('the queue is soonest first, and a cancelled booking leaves it', async () => {
    const later = await book('15:00');
    const sooner = await book('09:00');
    await prisma.booking.updateMany({ data: { needsReassignment: true } });
    const { agent } = await actor('MANAGER');
    const q = await agent.get('/bookings?needsReassignment=true&sort=soonest');
    expect(q.body.items.map((i: { id: string }) => i.id)).toEqual([sooner.id, later.id]);

    await w.customer.agent.post(`/bookings/${sooner.id}/cancel`).send({});
    const after = await agent.get('/bookings?needsReassignment=true');
    expect(after.body.items.map((i: { id: string }) => i.id)).toEqual([later.id]); // the flag went with the cancellation
  });

  it('two managers assigning the same free technician to two bookings: exactly one wins', async () => {
    const b1 = await book('10:00');
    const b2 = await book('10:00'); // a different technician (the first is busy)
    const third = w.techs.find((t) => t.id !== b1.technician.id && t.id !== b2.technician.id)!;
    const m1 = await actor('MANAGER');
    const m2 = await actor('OWNER');
    const [r1, r2] = await Promise.all([
      m1.agent.post(`/bookings/${b1.id}/assign`).send({ technicianId: third.id }),
      m2.agent.post(`/bookings/${b2.id}/assign`).send({ technicianId: third.id }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.booking.count({ where: { technicianId: third.id } })).toBe(1);
  });
});
