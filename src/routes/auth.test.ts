import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { prisma } from '../db/prisma';
import { mailer } from '../services/email.service';
import { assertCustomerAccess } from '../middleware/auth';
import { TEST_PASSWORD, createUser, resetDb } from '../test/db';

const app = createApp();
const sendSpy = vi.spyOn(mailer, 'send').mockResolvedValue();

// Pulls the one-time token out of the last email "sent".
function lastEmailToken(): string {
  const text = sendSpy.mock.calls.at(-1)![0].text;
  return decodeURIComponent(/token=([^\s]+)/.exec(text)![1]);
}

async function loginAs(email: string) {
  const agent = request.agent(app); // keeps cookies between requests, like a browser
  const res = await agent.post('/auth/login').send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await resetDb();
  sendSpy.mockClear();
});
afterAll(() => prisma.$disconnect());

describe('register / login / logout', () => {
  it('registers a customer, sets an httpOnly cookie, and sends a verification email', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/register')
      .send({ name: 'Ravi', email: ' Ravi@Example.TEST ', password: 'secret123', phone: '9876543210' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ravi@example.test', role: 'CUSTOMER', emailVerified: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.headers['set-cookie'][0]).toMatch(/bh_session=.*HttpOnly/i);
    expect(sendSpy).toHaveBeenCalledOnce();

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('ravi@example.test');
  });

  it('ignores a role in the register body (cannot self-register as owner)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Evil', email: 'evil@t.test', password: 'secret123', role: 'OWNER' });
    expect(res.body.user.role).toBe('CUSTOMER');
  });

  it('rejects a duplicate email, including a staff-created customer', async () => {
    await createUser('CUSTOMER', { email: 'priya@t.test', password: false });
    const res = await request(app)
      .post('/auth/register')
      .send({ name: 'Priya', email: 'priya@t.test', password: 'secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates input with the standard error shape', async () => {
    const res = await request(app).post('/auth/register').send({ name: 'X', email: 'bad', password: '1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('returns the same 401 for a wrong password and an unknown email', async () => {
    const u = await createUser('CUSTOMER');
    const wrong = await request(app).post('/auth/login').send({ email: u.email, password: 'nope-nope' });
    const unknown = await request(app).post('/auth/login').send({ email: 'x@t.test', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it('a phone-only / passwordless customer cannot log in', async () => {
    const u = await createUser('CUSTOMER', { password: false });
    const res = await request(app).post('/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('a deactivated user cannot log in, and an existing session stops working', async () => {
    const u = await createUser('MANAGER');
    const agent = await loginAs(u.email!);
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });

    expect((await agent.get('/auth/me')).status).toBe(401);
    const res = await request(app).post('/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('logout clears the cookie', async () => {
    const u = await createUser('CUSTOMER');
    const agent = await loginAs(u.email!);
    expect((await agent.post('/auth/logout')).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
  });

  it('rejects a missing or tampered cookie', async () => {
    expect((await request(app).get('/auth/me')).status).toBe(401);
    const res = await request(app).get('/auth/me').set('Cookie', 'bh_session=not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('forgot / reset password', () => {
  it('does not reveal whether an email exists', async () => {
    const res = await request(app).post('/auth/forgot-password').send({ email: 'nobody@t.test' });
    expect(res.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('resets the password, logs out old sessions, and the link works only once', async () => {
    const u = await createUser('CUSTOMER');
    const oldSession = await loginAs(u.email!);

    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const token = lastEmailToken();
    // JWT iat is in whole seconds; wait so the reset is clearly after the old login.
    await new Promise((r) => setTimeout(r, 1100));

    const reset = await request(app).post('/auth/reset-password').send({ token, password: 'brand-new-pass' });
    expect(reset.status).toBe(200);

    expect((await oldSession.get('/auth/me')).status).toBe(401);
    const login = await request(app).post('/auth/login').send({ email: u.email, password: 'brand-new-pass' });
    expect(login.status).toBe(200);

    const again = await request(app).post('/auth/reset-password').send({ token, password: 'another-pass' });
    expect(again.status).toBe(400);
  });

  it('rejects an expired token', async () => {
    const u = await createUser('CUSTOMER');
    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const token = lastEmailToken();
    await prisma.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post('/auth/reset-password').send({ token, password: 'brand-new-pass' });
    expect(res.status).toBe(400);
  });

  it('only the newest reset link works', async () => {
    const u = await createUser('CUSTOMER');
    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const first = lastEmailToken();
    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const res = await request(app).post('/auth/reset-password').send({ token: first, password: 'brand-new-pass' });
    expect(res.status).toBe(400);
  });

  it('a verify-email token cannot be used to reset a password', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ name: 'Ravi', email: 'r@t.test', password: 'secret123' });
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: lastEmailToken(), password: 'hijacked-pass' });
    expect(res.status).toBe(400);
  });

  it('two concurrent uses of one link: only one succeeds', async () => {
    const u = await createUser('CUSTOMER');
    await request(app).post('/auth/forgot-password').send({ email: u.email });
    const token = lastEmailToken();
    const results = await Promise.all([
      request(app).post('/auth/reset-password').send({ token, password: 'first-password' }),
      request(app).post('/auth/reset-password').send({ token, password: 'second-password' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });
});

describe('email verification', () => {
  it('verifies the email from the link', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ name: 'Ravi', email: 'r@t.test', password: 'secret123' });
    const res = await request(app).post('/auth/verify-email').send({ token: lastEmailToken() });
    expect(res.status).toBe(200);
    expect((await agent.get('/auth/me')).body.user.emailVerified).toBe(true);

    const resend = await agent.post('/auth/resend-verification');
    expect(resend.status).toBe(409);
  });
});

describe('staff invite for staff-created customers', () => {
  it('manager invites a passwordless customer, who sets a password and logs in', async () => {
    const manager = await createUser('MANAGER');
    const customer = await createUser('CUSTOMER', { email: 'priya@t.test', password: false });
    const agent = await loginAs(manager.email!);

    const res = await agent.post('/auth/invite').send({ customerId: customer.id });
    expect(res.status).toBe(200);
    expect(sendSpy.mock.calls.at(-1)![0].to).toBe('priya@t.test');

    const accept = await request(app)
      .post('/auth/accept-invite')
      .send({ token: lastEmailToken(), password: 'priya-pass-1' });
    expect(accept.status).toBe(200);

    const login = await request(app).post('/auth/login').send({ email: 'priya@t.test', password: 'priya-pass-1' });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ id: customer.id, emailVerified: true });
  });

  it('customers and technicians cannot send invites (403)', async () => {
    const target = await createUser('CUSTOMER', { password: false });
    for (const role of ['CUSTOMER', 'TECHNICIAN'] as const) {
      const agent = await loginAs((await createUser(role)).email!);
      const res = await agent.post('/auth/invite').send({ customerId: target.id });
      expect(res.status).toBe(403);
    }
  });

  it('refuses customers who already have a password or have no email', async () => {
    const owner = await createUser('OWNER');
    const agent = await loginAs(owner.email!);
    const registered = await createUser('CUSTOMER');
    const phoneOnly = await createUser('CUSTOMER', { email: null, password: false });
    const staff = await createUser('MANAGER');

    expect((await agent.post('/auth/invite').send({ customerId: registered.id })).status).toBe(409);
    expect((await agent.post('/auth/invite').send({ customerId: phoneOnly.id })).status).toBe(400);
    expect((await agent.post('/auth/invite').send({ customerId: staff.id })).status).toBe(404);
  });

  it('a staff-created customer can also claim the account via forgot password', async () => {
    const customer = await createUser('CUSTOMER', { password: false });
    await request(app).post('/auth/forgot-password').send({ email: customer.email });
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ token: lastEmailToken(), password: 'claimed-pass' });
    expect(res.status).toBe(200);
  });
});

describe('assertCustomerAccess (ownership)', () => {
  it('staff can access any customer; a customer only themselves', () => {
    expect(() => assertCustomerAccess({ id: 'm', role: 'MANAGER' }, 'c1')).not.toThrow();
    expect(() => assertCustomerAccess({ id: 'o', role: 'OWNER' }, 'c1')).not.toThrow();
    expect(() => assertCustomerAccess({ id: 'c1', role: 'CUSTOMER' }, 'c1')).not.toThrow();
    expect(() => assertCustomerAccess({ id: 'c2', role: 'CUSTOMER' }, 'c1')).toThrow(/Not found/);
    expect(() => assertCustomerAccess({ id: 't', role: 'TECHNICIAN' }, 'c1')).toThrow(/permission/);
  });
});
