import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db/prisma';
import { mailer } from '../services/email.service';
import { createUser, resetDb } from '../test/db';
import { actor, app } from '../test/http';

vi.spyOn(mailer, 'send').mockResolvedValue();

let categoryId: string;
beforeEach(async () => {
  await resetDb();
  categoryId = (await prisma.serviceCategory.create({ data: { name: 'Washing Machine' } })).id;
});
afterAll(() => prisma.$disconnect());

describe('staff customer management', () => {
  it('manager creates a phone-only customer (phone normalised, audit logged)', async () => {
    const { agent, user: manager } = await actor('MANAGER');
    const res = await agent.post('/customers').send({ name: 'Priya Nair', phone: '+91 98765 43210' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ phone: '9876543210', email: null, hasAccount: false });
    const audit = await prisma.auditLog.findFirst({ where: { entityId: res.body.id } });
    expect(audit).toMatchObject({ action: 'CUSTOMER_CREATED', userId: manager.id });
  });

  it('warns on duplicate phone, then allows it when confirmed', async () => {
    const { agent } = await actor('MANAGER');
    await agent.post('/customers').send({ name: 'Priya', phone: '9876543210' });

    const dup = await agent.post('/customers').send({ name: 'Priya N', phone: '09876543210' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PHONE');
    expect(dup.body.error.details[0]).toMatchObject({ name: 'Priya', phone: '9876543210' });

    const ok = await agent.post('/customers').send({ name: 'Priya N', phone: '9876543210', allowDuplicatePhone: true });
    expect(ok.status).toBe(201);
  });

  it('rejects an email used by another account', async () => {
    const { agent } = await actor('OWNER');
    const existing = await createUser('CUSTOMER');
    const res = await agent.post('/customers').send({ name: 'X Y', phone: '9876543210', email: existing.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('searches by name, phone digits and email, paginated', async () => {
    const { agent } = await actor('MANAGER');
    await agent.post('/customers').send({ name: 'Ravi Kumar', phone: '9000000010' });
    await agent.post('/customers').send({ name: 'Priya Nair', phone: '9876543210', email: 'priya@t.test' });

    const byName = await agent.get('/customers?q=ravi');
    expect(byName.body.items.map((c: { name: string }) => c.name)).toEqual(['Ravi Kumar']);
    const byPhone = await agent.get('/customers?q=98765 43');
    expect(byPhone.body.items[0].name).toBe('Priya Nair');
    const byEmail = await agent.get('/customers?q=PRIYA@');
    expect(byEmail.body.total).toBe(1);

    const page = await agent.get('/customers?pageSize=1&page=2');
    expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
    expect(page.body.items).toHaveLength(1);
  });

  it('updates a customer, audits the diff, and a new email kills old links and verification', async () => {
    const { agent } = await actor('MANAGER');
    const c = (await agent.post('/customers').send({ name: 'Priya', phone: '9876543210', email: 'old@t.test' })).body;
    await agent.post('/auth/invite').send({ customerId: c.id });

    const res = await agent.patch(`/customers/${c.id}`).send({ email: 'new@t.test' });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('new@t.test');

    expect(await prisma.authToken.count({ where: { userId: c.id, usedAt: null } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: c.id, action: 'CUSTOMER_UPDATED' } });
    expect(audit?.metadata).toEqual({ email: { from: 'old@t.test', to: 'new@t.test' } });
  });

  it("can't remove the email of a customer who logs in with it", async () => {
    const { agent } = await actor('MANAGER');
    const registered = await createUser('CUSTOMER');
    const res = await agent.patch(`/customers/${registered.id}`).send({ email: '' });
    expect(res.status).toBe(400);
  });

  it('customers and technicians cannot use /customers', async () => {
    for (const role of ['CUSTOMER', 'TECHNICIAN'] as const) {
      const { agent } = await actor(role);
      expect((await agent.get('/customers')).status).toBe(403);
    }
    expect((await request(app).get('/customers')).status).toBe(401);
  });

  it('GET /customers/:id does not return staff users', async () => {
    const { agent } = await actor('MANAGER');
    const owner = await createUser('OWNER');
    expect((await agent.get(`/customers/${owner.id}`)).status).toBe(404);
  });
});

describe('addresses (both paths)', () => {
  const address = { line1: 'Flat 302, Sunrise Apts', area: '  kondapur ', pincode: '500084' };

  it('customer adds their own; a customerId they send is ignored', async () => {
    const other = await createUser('CUSTOMER');
    const { agent, user } = await actor('CUSTOMER');
    const res = await agent.post('/addresses').send({ ...address, customerId: other.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ customerId: user.id, area: 'Kondapur', city: 'Hyderabad', label: 'Home' });
    expect((await agent.get('/addresses')).body.total).toBe(1);
  });

  it('staff must pass a customerId, and it must be a customer', async () => {
    const { agent } = await actor('MANAGER');
    const missing = await agent.post('/addresses').send(address);
    expect(missing.status).toBe(400);

    const tech = await createUser('TECHNICIAN');
    expect((await agent.post('/addresses').send({ ...address, customerId: tech.id })).status).toBe(404);

    const customer = await createUser('CUSTOMER', { password: false });
    const ok = await agent.post('/addresses').send({ ...address, customerId: customer.id });
    expect(ok.status).toBe(201);
    expect((await agent.get(`/addresses?customerId=${customer.id}`)).body.items).toHaveLength(1);
  });

  it("a customer can't see, edit or delete another customer's address (404)", async () => {
    const { agent: ravi } = await actor('CUSTOMER');
    const { agent: priya } = await actor('CUSTOMER');
    const a = (await ravi.post('/addresses').send(address)).body;

    expect((await priya.patch(`/addresses/${a.id}`).send({ label: 'Mine' })).status).toBe(404);
    expect((await priya.delete(`/addresses/${a.id}`)).status).toBe(404);
    expect((await priya.get('/addresses')).body.total).toBe(0);
  });

  it('validates the PIN code and allows clearing it', async () => {
    const { agent } = await actor('CUSTOMER');
    const bad = await agent.post('/addresses').send({ ...address, pincode: '5000' });
    expect(bad.status).toBe(400);
    const a = (await agent.post('/addresses').send(address)).body;
    const cleared = await agent.patch(`/addresses/${a.id}`).send({ pincode: '' });
    expect(cleared.body.pincode).toBeNull();
  });

  it('technicians have no access', async () => {
    const { agent } = await actor('TECHNICIAN');
    expect((await agent.get('/addresses')).status).toBe(403);
  });
});

describe('appliances (both paths)', () => {
  it('customer adds one; staff see it for that customer', async () => {
    const { agent, user } = await actor('CUSTOMER');
    const res = await agent.post('/appliances').send({ categoryId, brand: 'LG', model: 'FHM1207', purchaseYear: 2021 });
    expect(res.status).toBe(201);
    expect(res.body.category.name).toBe('Washing Machine');

    const { agent: manager } = await actor('MANAGER');
    const list = await manager.get(`/appliances?customerId=${user.id}`);
    expect(list.body.items[0]).toMatchObject({ brand: 'LG', model: 'FHM1207' });
  });

  it('rejects a future purchase year and an unknown category', async () => {
    const { agent } = await actor('CUSTOMER');
    const future = await agent.post('/appliances').send({ categoryId, brand: 'LG', purchaseYear: 2999 });
    expect(future.status).toBe(400);
    const unknown = await agent
      .post('/appliances')
      .send({ categoryId: '00000000-0000-4000-8000-000000000000', brand: 'LG' });
    expect(unknown.status).toBe(400);
  });

  it("another customer's appliance is 404", async () => {
    const { agent: ravi } = await actor('CUSTOMER');
    const { agent: priya } = await actor('CUSTOMER');
    const a = (await ravi.post('/appliances').send({ categoryId, brand: 'LG' })).body;
    expect((await priya.patch(`/appliances/${a.id}`).send({ brand: 'Mine' })).status).toBe(404);
  });

  it('deletes an unused appliance', async () => {
    const { agent } = await actor('CUSTOMER');
    const a = (await agent.post('/appliances').send({ categoryId, brand: 'LG' })).body;
    expect((await agent.delete(`/appliances/${a.id}`)).status).toBe(204);
  });
});
