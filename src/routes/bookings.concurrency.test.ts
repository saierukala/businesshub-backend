import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma';
import { isExclusionViolation } from '../db/pgErrors';
import { resetDb } from '../test/db';
import { actor } from '../test/http';
import { at, bookingBody, makeWorld, type World } from '../test/world';

// These fire requests at the same instant. The availability check passes for all of them, so only the
// database EXCLUDE constraint can stop a double booking (spec §8 layers 2-5).

let w: World;
afterAll(() => prisma.$disconnect());

const ROUNDS = 5; // repeat: a race that passes once can still be a race

describe('one technician, one slot', () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld(1);
  });

  it('customer vs customer: exactly one of two simultaneous bookings succeeds', async () => {
    const other = await w.addCustomer();
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.booking.deleteMany({});
      const [a, b] = await Promise.all([
        w.customer.agent.post('/bookings').send(bookingBody(w, '10:00')),
        other.agent.post('/bookings').send(bookingBody(w, '10:00', other)),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe('SLOT_UNAVAILABLE');
      expect(await prisma.booking.count()).toBe(1);
    }
  });

  it('customer vs staff: exactly one succeeds', async () => {
    const { agent: staff } = await actor('MANAGER');
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.booking.deleteMany({});
      const [c, s] = await Promise.all([
        w.customer.agent.post('/bookings').send(bookingBody(w, '10:00')),
        staff.post('/bookings').send({ ...bookingBody(w, '10:00'), customerId: w.customer.user.id, source: 'PHONE', technicianId: w.techs[0].id }),
      ]);
      expect([c.status, s.status].sort()).toEqual([201, 409]);
      expect(await prisma.booking.count()).toBe(1);
    }
  });

  it('many at once: still exactly one', async () => {
    const customers = await Promise.all([w.addCustomer(), w.addCustomer(), w.addCustomer(), w.addCustomer()]);
    const results = await Promise.all(customers.map((c) => c.agent.post('/bookings').send(bookingBody(w, '11:00', c))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('a reschedule racing a new booking for the same slot: exactly one gets it', async () => {
    const mine = (await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).body;
    const other = await w.addCustomer();
    const [move, book] = await Promise.all([
      w.customer.agent.post(`/bookings/${mine.id}/reschedule`).send({ startAt: at('14:00').toISOString() }),
      other.agent.post('/bookings').send(bookingBody(w, '14:00', other)),
    ]);
    // Either may win the slot: the reschedule (200) or the new booking (201). Never both.
    expect([move.status, book.status].filter((s) => s === 409)).toHaveLength(1);
    expect([move.status, book.status].filter((s) => s < 300)).toHaveLength(1);
    const overlapping = await prisma.booking.count({ where: { startAt: at('14:00') } });
    expect(overlapping).toBe(1);
  });
});

describe('two technicians, one slot', () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld(2);
  });

  it('two simultaneous bookings both succeed, each on a different technician (the loser retries the other)', async () => {
    const other = await w.addCustomer();
    for (let round = 0; round < ROUNDS; round++) {
      await prisma.booking.deleteMany({});
      const [a, b] = await Promise.all([
        w.customer.agent.post('/bookings').send(bookingBody(w, '10:00')),
        other.agent.post('/bookings').send(bookingBody(w, '10:00', other)),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.technician.id).not.toBe(b.body.technician.id);
    }
  });

  it('three at once for two technicians: two win, one gets 409', async () => {
    const customers = await Promise.all([w.addCustomer(), w.addCustomer(), w.addCustomer()]);
    const results = await Promise.all(customers.map((c) => c.agent.post('/bookings').send(bookingBody(w, '10:00', c))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await prisma.booking.count()).toBe(2);
  });

  it('auto-assignment spreads the day: the second booking goes to the less loaded technician', async () => {
    const a = (await w.customer.agent.post('/bookings').send(bookingBody(w, '09:00'))).body;
    const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, '13:00'))).body;
    expect(a.technician.id).not.toBe(b.technician.id);
  });
});

describe('the database constraint on its own (no application code)', () => {
  beforeEach(async () => {
    await resetDb();
    w = await makeWorld(1);
  });

  const row = (n: number, from: string, to: string, status: 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED') => ({
    bookingNumber: `BH-DB-${n}`,
    customerId: w.customer.user.id,
    applianceId: w.customer.applianceId,
    serviceId: w.serviceId,
    addressId: w.customer.addressId,
    technicianId: w.techs[0].id,
    problemDescription: 'x',
    startAt: at(from),
    endAt: at(to),
    createdByUserId: w.customer.user.id,
    status,
  });

  it('rejects an overlapping booking for the same technician with 23P01', async () => {
    await prisma.booking.create({ data: row(1, '10:00', '11:00') });
    const err = await prisma.booking.create({ data: row(2, '10:30', '11:30') }).catch((e) => e);
    expect(isExclusionViolation(err)).toBe(true);
  });

  it('allows back-to-back bookings, and a cancelled booking does not block', async () => {
    await prisma.booking.create({ data: row(1, '10:00', '11:00') });
    await expect(prisma.booking.create({ data: row(2, '11:00', '12:00') })).resolves.toBeTruthy(); // touching
    await prisma.booking.create({ data: row(3, '14:00', '15:00', 'CANCELLED') });
    await expect(prisma.booking.create({ data: row(4, '14:00', '15:00') })).resolves.toBeTruthy();
  });

  it('rejects an end time that is not after the start', async () => {
    await expect(prisma.booking.create({ data: row(1, '11:00', '10:00') })).rejects.toThrow();
  });
});
