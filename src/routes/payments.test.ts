import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db/prisma';
import { resetDb } from '../test/db';
import { actor, loginAs } from '../test/http';
import { bookingBody, makeWorld, type World } from '../test/world';

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

// A finished job: booked, worked and completed by the technician. extra = an approved extra charge.
async function completedJob(hhmm = '10:00', extra?: number) {
  const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body;
  const tech = w.techs.find((t) => t.id === b.technician.id)!;
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'ASSIGNED' } });
  const agent = await techAgent(tech);
  for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) await agent.post(`/bookings/${b.id}/status`).send({ to });
  if (extra) {
    await agent.post(`/bookings/${b.id}/visit/extra-charge`).send({ amount: extra, reason: 'New part' });
    await w.customer.agent.post(`/bookings/${b.id}/visit/extra-charge/decision`).send({ decision: 'APPROVED' });
  }
  await agent.post(`/bookings/${b.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Replaced the relay' });
  return { id: b.id as string, tech, agent };
}

describe('recording a payment', () => {
  it('the technician records cash; the amount is the service price, with a receipt number and an audit row', async () => {
    const job = await completedJob();
    const res = await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: '599.00', method: 'CASH', status: 'PAID', recordedBy: 'Test TECHNICIAN' });
    expect(res.body.receiptNumber).toBe(`RC-${new Date().getFullYear()}-00001`);
    expect(res.body.paidAt).toBeTruthy();

    expect((await audit('PAYMENT_RECORDED'))[0].metadata).toMatchObject({ amount: '599.00', method: 'CASH', receiptNumber: res.body.receiptNumber });
    const detail = (await w.customer.agent.get(`/bookings/${job.id}`)).body;
    expect(detail.payment).toMatchObject({ amount: '599.00', status: 'PAID' });
    expect(detail.paid).toBe(true);
  });

  it('adds the approved extra charge to the amount, and numbers receipts in order', async () => {
    const first = await completedJob('10:00', 250);
    const second = await completedJob('13:00');
    const a = await first.agent.post(`/bookings/${first.id}/payment`).send({ method: 'UPI', reference: 'UPI-778899' });
    const b = await second.agent.post(`/bookings/${second.id}/payment`).send({ method: 'CASH' });
    expect(a.body).toMatchObject({ amount: '849.00', method: 'UPI', reference: 'UPI-778899' }); // 599 + 250
    expect(b.body.amount).toBe('599.00');
    expect([a.body.receiptNumber, b.body.receiptNumber]).toEqual([`RC-${new Date().getFullYear()}-00001`, `RC-${new Date().getFullYear()}-00002`]);
  });

  it('a declined extra charge is not collected', async () => {
    const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).body;
    const tech = w.techs.find((t) => t.id === b.technician.id)!;
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'ASSIGNED' } });
    const agent = await techAgent(tech);
    for (const to of ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']) await agent.post(`/bookings/${b.id}/status`).send({ to });
    await agent.post(`/bookings/${b.id}/visit/extra-charge`).send({ amount: 300, reason: 'Part' });
    await w.customer.agent.post(`/bookings/${b.id}/visit/extra-charge/decision`).send({ decision: 'DECLINED' });
    await agent.post(`/bookings/${b.id}/visit/complete`).send({ diagnosis: 'Faulty relay', workPerformed: 'Cleaned it' });
    expect((await agent.post(`/bookings/${b.id}/payment`).send({ method: 'CASH' })).body.amount).toBe('599.00');
  });

  it('ignores any amount in the request: the client cannot change what was paid', async () => {
    const job = await completedJob();
    const res = await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH', amount: 1, status: 'PAID' });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe('599.00');
  });

  it('accepts CASH and UPI only for now', async () => {
    const job = await completedJob();
    for (const method of ['CARD', 'ONLINE', 'cheque', undefined]) {
      expect((await job.agent.post(`/bookings/${job.id}/payment`).send({ method })).status, String(method)).toBe(400);
    }
    expect(await prisma.payment.count()).toBe(0);
  });

  it('needs a completed visit', async () => {
    const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).body;
    const { agent: manager } = await actor('MANAGER');
    const res = await manager.post(`/bookings/${b.id}/payment`).send({ method: 'CASH' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_COMPLETED');
  });

  it('a booking is paid once', async () => {
    const job = await completedJob();
    expect((await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' })).status).toBe(201);
    const again = await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'UPI' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_PAID');
    expect(await prisma.payment.count()).toBe(1);
  });

  it('two payments recorded at the same instant: exactly one is saved', async () => {
    const job = await completedJob();
    const { agent: manager } = await actor('MANAGER');
    const [a, b, c] = await Promise.all([
      job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' }),
      manager.post(`/bookings/${job.id}/payment`).send({ method: 'UPI' }),
      manager.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' }),
    ]);
    expect([a.status, b.status, c.status].sort()).toEqual([201, 409, 409]);
    expect(await prisma.payment.count({ where: { status: 'PAID' } })).toBe(1);
  });

  it('a manager can record it for any completed booking; customers and other technicians cannot', async () => {
    const job = await completedJob();
    expect((await w.customer.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' })).status).toBe(403);
    const other = await techAgent(w.techs.find((t) => t.id !== job.tech.id)!);
    expect((await other.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' })).status).toBe(404);
    const { user, agent: manager } = await actor('MANAGER');
    const res = await manager.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' });
    expect(res.status).toBe(201);
    expect((await prisma.payment.findFirstOrThrow()).recordedByUserId).toBe(user.id);
  });
});

describe('receipt', () => {
  it('the customer opens their receipt: lines, total, method and business name', async () => {
    const job = await completedJob('10:00', 250);
    await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'UPI', reference: 'TXN123' });

    const res = await w.customer.agent.get(`/bookings/${job.id}/receipt`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      business: 'HomeFix Appliance Services',
      receiptNumber: expect.stringMatching(/^RC-\d{4}-00001$/),
      total: '849.00',
      method: 'UPI',
      reference: 'TXN123',
      technician: 'Test TECHNICIAN',
      lines: [
        { label: 'Fridge Repair', amount: '599.00' },
        { label: 'Extra: New part', amount: '250.00' },
      ],
    });
    expect(res.body.recordedByUserId).toBeUndefined(); // not on the customer's copy
    const total = res.body.lines.reduce((sum: number, l: { amount: string }) => sum + Number(l.amount), 0);
    expect(total).toBe(Number(res.body.total));
  });

  it('is not there until paid, and not for other customers', async () => {
    const job = await completedJob();
    expect((await w.customer.agent.get(`/bookings/${job.id}/receipt`)).status).toBe(404); // unpaid
    await job.agent.post(`/bookings/${job.id}/payment`).send({ method: 'CASH' });

    const stranger = await w.addCustomer();
    expect((await stranger.agent.get(`/bookings/${job.id}/receipt`)).status).toBe(404);
    const otherTech = await techAgent(w.techs.find((t) => t.id !== job.tech.id)!);
    expect((await otherTech.get(`/bookings/${job.id}/receipt`)).status).toBe(404);
    expect((await job.agent.get(`/bookings/${job.id}/receipt`)).status).toBe(200);
    const { agent: manager } = await actor('OWNER');
    expect((await manager.get(`/bookings/${job.id}/receipt`)).body.recordedByUserId).toBeTruthy();
  });
});

describe('the database rules', () => {
  const row = (bookingId: string, over: Record<string, unknown> = {}) => ({
    bookingId,
    amount: 599,
    method: 'CASH' as const,
    status: 'PAID' as const,
    paidAt: new Date(),
    ...over,
  });

  it('refuses a second PAID payment for a booking, and a zero amount', async () => {
    const job = await completedJob();
    await prisma.payment.create({ data: row(job.id, { receiptNumber: 'RC-T-1' }) });
    await expect(prisma.payment.create({ data: row(job.id, { receiptNumber: 'RC-T-2' }) })).rejects.toThrow();
    await expect(prisma.payment.create({ data: row(job.id, { status: 'FAILED', amount: 0, receiptNumber: 'RC-T-3' }) })).rejects.toThrow();
    // A failed attempt is fine next to a paid one.
    await expect(prisma.payment.create({ data: row(job.id, { status: 'FAILED', receiptNumber: 'RC-T-4' }) })).resolves.toBeTruthy();
  });
});
