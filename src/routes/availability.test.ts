import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma';
import { createUser, resetDb } from '../test/db';
import { actor, app } from '../test/http';

// A Monday at least 3 days ahead (and within 30), so the cutoff never interferes.
const monday = (() => {
  let d = DateTime.now().setZone('Asia/Kolkata').startOf('day').plus({ days: 3 });
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d;
})();
const date = monday.toFormat('yyyy-MM-dd');
const at = (hhmm: string) => DateTime.fromFormat(`${date} ${hhmm}`, 'yyyy-MM-dd HH:mm', { zone: 'Asia/Kolkata' }).toJSDate();

let serviceId: string;
let categoryId: string;
let techId: string;
let bookingFixture: { customerId: string; applianceId: string; addressId: string; createdByUserId: string };

beforeEach(async () => {
  await resetDb();
  categoryId = (await prisma.serviceCategory.create({ data: { name: 'Refrigerator' } })).id;
  serviceId = (await prisma.service.create({ data: { categoryId, name: 'Fridge Repair', durationMinutes: 60, basePrice: 599 } })).id;

  const techUser = await createUser('TECHNICIAN');
  const tech = await prisma.technician.create({
    data: {
      userId: techUser.id,
      phone: '9000000001',
      skills: { create: [{ categoryId }] },
      areas: { create: [{ area: 'Kondapur' }] },
      workingHours: {
        create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: '09:00', endTime: '18:00', isOff: dayOfWeek === 0 })),
      },
    },
  });
  techId = tech.id;

  const customer = await createUser('CUSTOMER');
  const address = await prisma.address.create({
    data: { customerId: customer.id, label: 'Home', line1: 'Flat 1', area: 'Kondapur', city: 'Hyderabad' },
  });
  const appliance = await prisma.appliance.create({ data: { customerId: customer.id, categoryId, brand: 'LG' } });
  bookingFixture = { customerId: customer.id, applianceId: appliance.id, addressId: address.id, createdByUserId: customer.id };
});
afterAll(() => prisma.$disconnect());

const book = (from: string, to: string, over: Record<string, unknown> = {}) =>
  prisma.booking.create({
    data: {
      ...bookingFixture,
      bookingNumber: `BH-TEST-${Math.random().toString(36).slice(2, 8)}`,
      serviceId,
      technicianId: techId,
      problemDescription: 'Not cooling',
      startAt: at(from),
      endAt: at(to),
      status: 'CONFIRMED',
      ...over,
    },
  });

const query = (over: Record<string, string> = {}) => `/availability?serviceId=${serviceId}&date=${date}&area=Kondapur${Object.entries(over).map(([k, v]) => `&${k}=${v}`).join('')}`;
const startsIST = (slots: { startAt: string }[]) => slots.map((s) => DateTime.fromISO(s.startAt, { zone: 'Asia/Kolkata' }).toFormat('HH:mm'));

describe('GET /availability', () => {
  it('customers get times only; staff also see which technicians are free', async () => {
    const { agent: customer } = await actor('CUSTOMER');
    const c = await customer.get(query());
    expect(c.status).toBe(200);
    expect(c.body.slots[0]).toEqual({ startAt: at('09:00').toISOString(), endAt: at('10:00').toISOString() });
    expect(c.body.slots).toHaveLength(17);

    const { agent: manager } = await actor('MANAGER');
    const m = await manager.get(query());
    expect(m.body.slots[0].technicians).toEqual([{ id: techId, name: 'Test TECHNICIAN' }]);
  });

  it('a customer cannot switch on staff mode with a query parameter', async () => {
    const { agent } = await actor('CUSTOMER');
    const res = await agent.get(query({ mode: 'staff' }));
    expect(res.body.slots[0].technicians).toBeUndefined();
  });

  it('blocks booked slots, but cancelled and no-show bookings free them', async () => {
    const { agent } = await actor('CUSTOMER');
    await book('09:00', '10:00');
    expect(startsIST((await agent.get(query())).body.slots)[0]).toBe('10:00');

    await prisma.booking.updateMany({ data: { status: 'CANCELLED' } });
    expect(startsIST((await agent.get(query())).body.slots)[0]).toBe('09:00');
    await prisma.booking.updateMany({ data: { status: 'NO_SHOW' } });
    expect(startsIST((await agent.get(query())).body.slots)[0]).toBe('09:00');
  });

  it('respects time off', async () => {
    const { agent } = await actor('CUSTOMER');
    const owner = await createUser('OWNER');
    await prisma.timeOff.create({ data: { technicianId: techId, startAt: at('00:00'), endAt: monday.plus({ days: 1 }).toJSDate(), createdByUserId: owner.id } });
    expect((await agent.get(query())).body.slots).toEqual([]);
  });

  it('skips technicians without the skill, area, or an active account', async () => {
    const { agent } = await actor('CUSTOMER');
    expect((await agent.get(query()).then((r) => r.body.slots.length))).toBeGreaterThan(0);
    expect((await agent.get(`/availability?serviceId=${serviceId}&date=${date}&area=Madhapur`)).body.slots).toEqual([]);

    await prisma.technicianSkill.deleteMany({});
    expect((await agent.get(query())).body.slots).toEqual([]);
    await prisma.technicianSkill.create({ data: { technicianId: techId, categoryId } });

    await prisma.technician.update({ where: { id: techId }, data: { status: 'INACTIVE' } });
    expect((await agent.get(query())).body.slots).toEqual([]);
  });

  it('normalises the area spelling', async () => {
    const { agent } = await actor('CUSTOMER');
    const res = await agent.get(`/availability?serviceId=${serviceId}&date=${date}&area=%20kondapur%20`);
    expect(res.body.slots.length).toBeGreaterThan(0);
  });

  it('validates input and hides inactive services', async () => {
    const { agent } = await actor('CUSTOMER');
    expect((await agent.get(`/availability?serviceId=${serviceId}&date=2026-13-45&area=Kondapur`)).status).toBe(400);
    expect((await agent.get(`/availability?serviceId=${serviceId}&date=${date}`)).status).toBe(400);
    expect((await agent.get(`/availability?serviceId=nope&date=${date}&area=Kondapur`)).status).toBe(400);

    await prisma.service.update({ where: { id: serviceId }, data: { active: false } });
    expect((await agent.get(query())).status).toBe(404);
  });

  it('is closed to anonymous users and technicians', async () => {
    expect((await request(app).get(query())).status).toBe(401);
    const { agent } = await actor('TECHNICIAN');
    expect((await agent.get(query())).status).toBe(403);
  });
});

describe('time off over existing bookings', () => {
  it('flags overlapping bookings for reassignment and leaves the rest alone', async () => {
    const { agent } = await actor('MANAGER');
    const inside = await book('10:00', '11:00');
    const cancelled = await book('12:00', '13:00', { status: 'CANCELLED' });
    const nextWeek = await book('10:00', '11:00', { startAt: monday.plus({ days: 7, hours: 10 }).toJSDate(), endAt: monday.plus({ days: 7, hours: 11 }).toJSDate() });

    const res = await agent.post(`/technicians/${techId}/time-off`).send({
      startAt: monday.toISO(),
      endAt: monday.plus({ days: 1 }).toISO(),
      reason: 'SICK',
    });
    expect(res.status).toBe(201);
    expect(res.body.bookingsNeedingReassignment).toBe(1);

    const flags = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id } })).needsReassignment;
    expect(await flags(inside.id)).toBe(true);
    expect(await flags(cancelled.id)).toBe(false);
    expect(await flags(nextWeek.id)).toBe(false);
    // The booking itself is untouched: same time, same technician, same status.
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: inside.id } })).toMatchObject({ technicianId: techId, status: 'CONFIRMED' });
  });
});
