import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '../db/prisma';
import { mailer } from '../services/email.service';
import { createUser, resetDb } from '../test/db';
import { actor, app, loginAs } from '../test/http';

const sendSpy = vi.spyOn(mailer, 'send').mockResolvedValue();

let categoryId: string;
beforeEach(async () => {
  await resetDb();
  sendSpy.mockClear();
  categoryId = (await prisma.serviceCategory.create({ data: { name: 'Refrigerator' } })).id;
});
afterAll(() => prisma.$disconnect());

const service = () => ({ categoryId, name: 'Fridge Repair', durationMinutes: 90, basePrice: 599 });

describe('catalog', () => {
  it('owner creates and edits a service; price comes back as a 2-decimal string', async () => {
    const { agent } = await actor('OWNER');
    const res = await agent.post('/services').send(service());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ basePrice: '599.00', category: { name: 'Refrigerator' } });

    const edit = await agent.patch(`/services/${res.body.id}`).send({ basePrice: 649.5 });
    expect(edit.body.basePrice).toBe('649.50');
  });

  it('validates duration steps and price decimals', async () => {
    const { agent } = await actor('OWNER');
    expect((await agent.post('/services').send({ ...service(), durationMinutes: 50 })).status).toBe(400);
    expect((await agent.post('/services').send({ ...service(), basePrice: 1.234 })).status).toBe(400);
  });

  it('only the owner edits the catalog', async () => {
    const { agent } = await actor('MANAGER');
    expect((await agent.post('/services').send(service())).status).toBe(403);
    expect((await agent.post('/service-categories').send({ name: 'Oven' })).status).toBe(403);
  });

  it('customers never see inactive services; staff can ask for them', async () => {
    const { agent: owner } = await actor('OWNER');
    const s = (await owner.post('/services').send({ ...service(), active: false })).body;

    const { agent: customer } = await actor('CUSTOMER');
    expect((await customer.get('/services?includeInactive=true')).body.total).toBe(0);
    expect((await customer.get(`/services/${s.id}`)).status).toBe(404);
    expect((await owner.get('/services?includeInactive=true')).body.total).toBe(1);
  });

  it('categories are readable by any logged-in user, not anonymous', async () => {
    const { agent } = await actor('TECHNICIAN');
    expect((await agent.get('/service-categories')).body.items[0].name).toBe('Refrigerator');
    expect((await request(app).get('/service-categories')).status).toBe(401);
  });
});

describe('owner user management', () => {
  it('creates a technician with no password, a Technician row, and sends an invite', async () => {
    const { agent } = await actor('OWNER');
    const res = await agent
      .post('/users')
      .send({ name: 'Kiran Rao', email: 'kiran@t.test', phone: '9876500000', role: 'TECHNICIAN' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: 'TECHNICIAN', hasAccount: false, active: true });
    expect(await prisma.technician.findUnique({ where: { userId: res.body.id } })).not.toBeNull();
    expect(sendSpy.mock.calls[0][0].text).toContain('/accept-invite?token=');
  });

  it('cannot create an owner or a customer through /users', async () => {
    const { agent } = await actor('OWNER');
    const res = await agent.post('/users').send({ name: 'X Y', email: 'x@t.test', phone: '9876500000', role: 'OWNER' });
    expect(res.status).toBe(400);
  });

  it('deactivating locks the user out immediately and marks the technician inactive', async () => {
    const { agent: owner } = await actor('OWNER');
    const tech = await createUser('TECHNICIAN');
    await prisma.technician.create({ data: { userId: tech.id, phone: '9000000001' } });
    const techSession = await loginAs(tech.email!);

    const res = await owner.patch(`/users/${tech.id}/active`).send({ active: false });
    expect(res.body.active).toBe(false);
    expect((await techSession.get('/auth/me')).status).toBe(401);
    expect((await prisma.technician.findUnique({ where: { userId: tech.id } }))?.status).toBe('INACTIVE');
    expect(await prisma.auditLog.count({ where: { entityId: tech.id, action: 'USER_DEACTIVATED' } })).toBe(1);
  });

  it('owner cannot deactivate themselves or another owner', async () => {
    const { agent, user } = await actor('OWNER');
    const other = await createUser('OWNER');
    expect((await agent.patch(`/users/${user.id}/active`).send({ active: false })).status).toBe(400);
    expect((await agent.patch(`/users/${other.id}/active`).send({ active: false })).status).toBe(403);
  });

  it('managers cannot manage users', async () => {
    const { agent } = await actor('MANAGER');
    expect((await agent.get('/users')).status).toBe(403);
  });

  it('lists users filtered by role', async () => {
    const { agent } = await actor('OWNER');
    await createUser('TECHNICIAN');
    await createUser('CUSTOMER');
    const res = await agent.get('/users?role=TECHNICIAN');
    expect(res.body.items.every((u: { role: string }) => u.role === 'TECHNICIAN')).toBe(true);
    expect(res.body.total).toBe(1);
  });
});
