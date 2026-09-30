import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma';
import { createUser, resetDb } from '../test/db';
import request from 'supertest';
import { actor, app } from '../test/http';

let techId: string;
let categoryId: string;

beforeEach(async () => {
  await resetDb();
  const user = await createUser('TECHNICIAN');
  techId = (await prisma.technician.create({ data: { userId: user.id, phone: '9000000001' } })).id;
  categoryId = (await prisma.serviceCategory.create({ data: { name: 'Refrigerator' } })).id;
});
afterAll(() => prisma.$disconnect());

const week = (over: Record<number, object> = {}) =>
  Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startTime: '09:00',
    endTime: '18:00',
    isOff: dayOfWeek === 0,
    ...over[dayOfWeek],
  }));

describe('technician setup', () => {
  it('manager sets skills and areas; areas are normalised and de-duplicated', async () => {
    const { agent } = await actor('MANAGER');
    const skills = await agent.put(`/technicians/${techId}/skills`).send({ categoryIds: [categoryId] });
    expect(skills.body.skills).toEqual([{ id: categoryId, name: 'Refrigerator' }]);

    const areas = await agent.put(`/technicians/${techId}/areas`).send({ areas: ['  kondapur ', 'Kondapur', 'madhapur'] });
    expect(areas.body.areas).toEqual(['Kondapur', 'Madhapur']);

    // Replaces, not appends.
    const cleared = await agent.put(`/technicians/${techId}/skills`).send({ categoryIds: [] });
    expect(cleared.body.skills).toEqual([]);
  });

  it('rejects unknown categories', async () => {
    const { agent } = await actor('OWNER');
    const res = await agent.put(`/technicians/${techId}/skills`).send({ categoryIds: ['7d9f7f2e-7d2b-4a56-9c1e-000000000000'] });
    expect(res.status).toBe(400);
  });

  it('saves working hours and validates them', async () => {
    const { agent } = await actor('MANAGER');
    const ok = await agent.put(`/technicians/${techId}/working-hours`).send({ days: week({ 6: { endTime: '13:00' } }) });
    expect(ok.status).toBe(200);
    expect(ok.body.workingHours).toHaveLength(7);
    expect(ok.body.workingHours[6].endTime).toBe('13:00');
    expect(ok.body.workingHours[0].isOff).toBe(true);

    const backwards = await agent.put(`/technicians/${techId}/working-hours`).send({ days: week({ 2: { startTime: '18:00', endTime: '09:00' } }) });
    expect(backwards.status).toBe(400);
    const short = await agent.put(`/technicians/${techId}/working-hours`).send({ days: week().slice(0, 6) });
    expect(short.status).toBe(400);
    const badTime = await agent.put(`/technicians/${techId}/working-hours`).send({ days: week({ 1: { startTime: '9am' } }) });
    expect(badTime.status).toBe(400);
  });

  it('lists technicians with pagination and includes their setup', async () => {
    const { agent } = await actor('MANAGER');
    await agent.put(`/technicians/${techId}/areas`).send({ areas: ['Kondapur'] });
    const res = await agent.get('/technicians?pageSize=10');
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(res.body.items[0].areas).toEqual(['Kondapur']);
  });

  it('writes audit rows for every change', async () => {
    const { agent } = await actor('OWNER');
    await agent.put(`/technicians/${techId}/skills`).send({ categoryIds: [categoryId] });
    await agent.put(`/technicians/${techId}/areas`).send({ areas: ['Kondapur'] });
    await agent.put(`/technicians/${techId}/working-hours`).send({ days: week() });
    const actions = (await prisma.auditLog.findMany({ where: { entityId: techId } })).map((a) => a.action).sort();
    expect(actions).toEqual(['TECHNICIAN_AREAS_SET', 'TECHNICIAN_HOURS_SET', 'TECHNICIAN_SKILLS_SET']);
  });
});

describe('time off', () => {
  const day = (d: number, h = 9) => `2099-01-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+05:30`;

  it('adds, lists and removes time off, storing IST input as UTC', async () => {
    const { agent } = await actor('MANAGER');
    const res = await agent.post(`/technicians/${techId}/time-off`).send({ startAt: day(5), endAt: day(6), reason: 'SICK' });
    expect(res.status).toBe(201);
    expect(res.body.startAt).toBe('2099-01-05T03:30:00.000Z');

    const list = await agent.get(`/technicians/${techId}/time-off`);
    expect(list.body.total).toBe(1);

    expect((await agent.delete(`/technicians/${techId}/time-off/${res.body.id}`)).status).toBe(204);
    expect((await agent.get(`/technicians/${techId}/time-off`)).body.total).toBe(0);
  });

  it('rejects end before start and overlapping time off', async () => {
    const { agent } = await actor('MANAGER');
    expect((await agent.post(`/technicians/${techId}/time-off`).send({ startAt: day(6), endAt: day(5) })).status).toBe(400);
    expect((await agent.post(`/technicians/${techId}/time-off`).send({ startAt: '2099-01-05T09:00:00' , endAt: day(6) })).status).toBe(400); // no offset

    await agent.post(`/technicians/${techId}/time-off`).send({ startAt: day(5), endAt: day(7) });
    const overlap = await agent.post(`/technicians/${techId}/time-off`).send({ startAt: day(6), endAt: day(8) });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('TIME_OFF_OVERLAP');
    // Back-to-back is fine.
    expect((await agent.post(`/technicians/${techId}/time-off`).send({ startAt: day(7), endAt: day(8) })).status).toBe(201);
  });

  it("cannot delete another technician's time off through this technician's URL", async () => {
    const { agent } = await actor('MANAGER');
    const other = await createUser('TECHNICIAN');
    const otherTech = await prisma.technician.create({ data: { userId: other.id, phone: '9000000002' } });
    const row = (await agent.post(`/technicians/${otherTech.id}/time-off`).send({ startAt: day(5), endAt: day(6) })).body;
    expect((await agent.delete(`/technicians/${techId}/time-off/${row.id}`)).status).toBe(404);
  });
});

describe('access', () => {
  it('only Owner and Manager can use technician endpoints', async () => {
    for (const role of ['TECHNICIAN', 'CUSTOMER'] as const) {
      const { agent } = await actor(role);
      expect((await agent.get('/technicians')).status).toBe(403);
      expect((await agent.put(`/technicians/${techId}/areas`).send({ areas: [] })).status).toBe(403);
    }
    expect((await request(app).get('/technicians')).status).toBe(401);
  });

  it('returns 404 for unknown technicians', async () => {
    const { agent } = await actor('OWNER');
    expect((await agent.get('/technicians/7d9f7f2e-7d2b-4a56-9c1e-000000000000')).status).toBe(404);
  });
});
