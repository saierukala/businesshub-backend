import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../db/prisma';
import { resetDb } from '../test/db';
import { actor, app } from '../test/http';
import { at, bookingBody, makeWorld, monday, type World } from '../test/world';
import { cancelBooking } from '../services/booking.actions';
import { createBooking, rescheduleBooking } from '../services/booking.service';

let w: World;
beforeEach(async () => {
  await resetDb();
  w = await makeWorld(1);
});
afterAll(() => prisma.$disconnect());

// Service-level input (Date objects, like the schema produces).
const input = (hhmm: string, over: Record<string, unknown> = {}) => ({
  applianceId: w.customer.applianceId,
  serviceId: w.serviceId,
  addressId: w.customer.addressId,
  problemDescription: 'Not cooling',
  startAt: at(hhmm),
  ...over,
});
const asCustomer = () => ({ id: w.customer.user.id, role: 'CUSTOMER' as const });
const audit = (action: string) => prisma.auditLog.findMany({ where: { action } });

describe('customer books', () => {
  it('creates a CONFIRMED booking with a technician, number, history and audit row', async () => {
    const res = await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'CONFIRMED',
      source: 'ONLINE',
      customer: { id: w.customer.user.id },
      technician: { id: w.techs[0].id },
      service: { basePrice: '599.00' },
      startAt: at('10:00').toISOString(),
      endAt: at('11:00').toISOString(),
    });
    const year = new Date().getFullYear();
    expect(res.body.bookingNumber).toBe(`BH-${year}-00001`);

    const second = await w.customer.agent.post('/bookings').send(bookingBody(w, '12:00'));
    expect(second.body.bookingNumber).toBe(`BH-${year}-00002`);

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: res.body.id } });
    expect(history).toMatchObject([{ fromStatus: null, toStatus: 'CONFIRMED', changedByUserId: w.customer.user.id }]);
    expect(await audit('BOOKING_CREATED')).toHaveLength(2);
  });

  it('ignores a customerId in the body: the booking is always for the caller', async () => {
    const other = await w.addCustomer();
    const res = await w.customer.agent.post('/bookings').send({ ...bookingBody(w, '10:00'), customerId: other.user.id });
    expect(res.status).toBe(201);
    expect(res.body.customer.id).toBe(w.customer.user.id);
  });

  it('refuses staff-only fields from a customer', async () => {
    for (const extra of [{ technicianId: w.techs[0].id }, { source: 'PHONE' }, { overrideReason: 'please' }]) {
      const res = await w.customer.agent.post('/bookings').send({ ...bookingBody(w, '10:00'), ...extra });
      expect(res.status).toBe(403);
    }
  });

  it("cannot use another customer's appliance or address (404, not a leak)", async () => {
    const other = await w.addCustomer();
    const a = await w.customer.agent.post('/bookings').send({ ...bookingBody(w, '10:00'), applianceId: other.applianceId });
    expect(a.status).toBe(404);
    const b = await w.customer.agent.post('/bookings').send({ ...bookingBody(w, '10:00'), addressId: other.addressId });
    expect(b.status).toBe(404);
  });

  it('rejects a service that does not match the appliance type', async () => {
    const tv = await prisma.serviceCategory.create({ data: { name: 'TV' } });
    const tvService = await prisma.service.create({ data: { categoryId: tv.id, name: 'TV Repair', durationMinutes: 60, basePrice: 449 } });
    const res = await w.customer.agent.post('/bookings').send({ ...bookingBody(w, '10:00'), serviceId: tvService.id });
    expect(res.status).toBe(400);
  });

  it('rejects inactive services, off-grid times and taken slots with 409', async () => {
    expect((await w.customer.agent.post('/bookings').send(bookingBody(w, '10:15'))).body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).status).toBe(201);
    const again = await w.customer.agent.post('/bookings').send(bookingBody(w, '10:30')); // overlaps 10:00-11:00
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SLOT_UNAVAILABLE');

    await prisma.service.update({ where: { id: w.serviceId }, data: { active: false } });
    expect((await w.customer.agent.post('/bookings').send(bookingBody(w, '14:00'))).status).toBe(404);
  });

  it('is refused inside the 2-hour cutoff, even at the service level', async () => {
    const now = at('08:00'); // 09:00 is only 1 hour away
    await expect(createBooking(asCustomer(), input('09:00'), now)).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_UNAVAILABLE' });
    await expect(createBooking(asCustomer(), input('10:00'), now)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('technicians and anonymous users cannot book', async () => {
    expect((await request(app).post('/bookings').send(bookingBody(w, '10:00'))).status).toBe(401);
    const { agent } = await actor('TECHNICIAN');
    expect((await agent.post('/bookings').send(bookingBody(w, '10:00'))).status).toBe(403);
  });
});

describe('staff books on behalf of a customer', () => {
  const staffBody = (over: Record<string, unknown> = {}) => ({
    ...bookingBody(w, '10:00'),
    customerId: w.customer.user.id,
    source: 'PHONE',
    ...over,
  });

  it('uses the same service: createdBy is the staff user, the customer is the one named', async () => {
    const { user, agent } = await actor('MANAGER');
    const res = await agent.post('/bookings').send(staffBody());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ source: 'PHONE', createdByUserId: user.id, customer: { id: w.customer.user.id }, status: 'CONFIRMED' });
    expect((await audit('BOOKING_CREATED'))[0]).toMatchObject({ userId: user.id });
  });

  it('needs customerId and source', async () => {
    const { agent } = await actor('MANAGER');
    expect((await agent.post('/bookings').send(staffBody({ customerId: undefined }))).status).toBe(400);
    expect((await agent.post('/bookings').send(staffBody({ source: undefined }))).status).toBe(400);
  });

  it("cannot mix in another customer's appliance", async () => {
    const other = await w.addCustomer();
    const { agent } = await actor('OWNER');
    const res = await agent.post('/bookings').send(staffBody({ applianceId: other.applianceId }));
    expect(res.status).toBe(404);
  });

  it('a technician the staff picked makes the booking ASSIGNED; must be free and qualified', async () => {
    const { agent } = await actor('MANAGER');
    const ok = await agent.post('/bookings').send(staffBody({ technicianId: w.techs[0].id }));
    expect(ok.body).toMatchObject({ status: 'ASSIGNED', technician: { id: w.techs[0].id } });

    const busy = await agent.post('/bookings').send(staffBody({ technicianId: w.techs[0].id, startAt: at('10:30').toISOString() }));
    expect(busy.status).toBe(409);
  });

  it('inside the cutoff staff need a reason, and it goes into the audit log', async () => {
    const manager = { id: (await actor('MANAGER')).user.id, role: 'MANAGER' as const };
    const now = at('08:00');
    const base = input('09:00', { customerId: w.customer.user.id, source: 'PHONE' });

    await expect(createBooking(manager, base, now)).rejects.toMatchObject({ statusCode: 400, code: 'OVERRIDE_REASON_REQUIRED' });
    const ok = await createBooking(manager, { ...base, overrideReason: 'Urgent, water leaking' }, now);
    expect(ok.status).toBe('CONFIRMED');
    expect((await audit('BOOKING_CREATED'))[0].metadata).toMatchObject({ overrideReason: 'Urgent, water leaking', overridden: ['BOOKING_CUTOFF'] });
  });

  it('can never override the past, a technician conflict, or working hours', async () => {
    const manager = { id: (await actor('MANAGER')).user.id, role: 'MANAGER' as const };
    const base = { ...input('09:00', { customerId: w.customer.user.id, source: 'PHONE' }), overrideReason: 'Please, it is urgent' };
    await expect(createBooking(manager, base, at('10:00'))).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' }); // already started
    await expect(createBooking(manager, { ...base, startAt: at('07:00') }, at('06:00'))).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' }); // before hours
    await createBooking(manager, { ...base, startAt: at('12:00') }, at('06:00'));
    await expect(createBooking(manager, { ...base, startAt: at('12:30') }, at('06:00'))).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' }); // conflict
  });
});

describe('cancel and no-show', () => {
  const book = async (hhmm = '10:00') => (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body;

  it('customer cancels their own booking; it writes history and audit and frees the slot', async () => {
    const b = await book();
    const res = await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({ reason: 'Fixed it myself' });
    expect(res.body.status).toBe('CANCELLED');

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(history[1]).toMatchObject({ fromStatus: 'CONFIRMED', note: 'Fixed it myself' });
    expect(await audit('BOOKING_CANCELLED')).toHaveLength(1);

    expect((await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).status).toBe(201); // slot is free again
  });

  it("cannot cancel someone else's booking, or cancel twice", async () => {
    const b = await book();
    const other = await w.addCustomer();
    expect((await other.agent.post(`/bookings/${b.id}/cancel`).send({})).status).toBe(404);

    await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({});
    const twice = await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({});
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('inside the 4-hour window: customers are refused, staff need a reason', async () => {
    const b = await book('10:00');
    const now = at('07:00'); // 3 hours before
    await expect(cancelBooking(asCustomer(), b.id, {}, now)).rejects.toMatchObject({ statusCode: 409, code: 'CANCELLATION_WINDOW_CLOSED' });

    const manager = { id: (await actor('MANAGER')).user.id, role: 'MANAGER' as const };
    await expect(cancelBooking(manager, b.id, {}, now)).rejects.toMatchObject({ statusCode: 400, code: 'OVERRIDE_REASON_REQUIRED' });
    await expect(cancelBooking(manager, b.id, { overrideReason: 'Customer called' }, now)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect((await audit('BOOKING_CANCELLED'))[0].metadata).toMatchObject({ overrideReason: 'Customer called', overridden: ['CANCELLATION_WINDOW_CLOSED'] });
  });

  it('a customer cannot send an override reason', async () => {
    const b = await book();
    expect((await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({ overrideReason: 'let me' })).status).toBe(403);
  });

  it('staff mark no-show only from ASSIGNED, EN_ROUTE or ARRIVED', async () => {
    const { agent } = await actor('MANAGER');
    const b = await book();
    const early = await agent.post(`/bookings/${b.id}/no-show`).send({});
    expect(early.status).toBe(409); // CONFIRMED -> NO_SHOW is not allowed
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    await prisma.booking.update({ where: { id: b.id }, data: { status: 'ASSIGNED' } });
    const ok = await agent.post(`/bookings/${b.id}/no-show`).send({ note: 'Nobody home' });
    expect(ok.body.status).toBe('NO_SHOW');
    expect((await audit('BOOKING_NO_SHOW')).length).toBe(1);

    expect((await w.customer.agent.post(`/bookings/${b.id}/no-show`).send({})).status).toBe(403);
  });

  it('a finished booking cannot be cancelled', async () => {
    const b = await book();
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } });
    expect((await w.customer.agent.post(`/bookings/${b.id}/cancel`).send({})).status).toBe(409);
  });
});

describe('reschedule', () => {
  const book = async (hhmm = '10:00') => (await w.customer.agent.post('/bookings').send(bookingBody(w, hhmm))).body;
  const move = (id: string, hhmm: string, extra = {}) =>
    w.customer.agent.post(`/bookings/${id}/reschedule`).send({ startAt: at(hhmm).toISOString(), ...extra });

  it('moves the same booking, keeps old and new times in history and audit, counts it', async () => {
    const b = await book('10:00');
    const res = await move(b.id, '14:00');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: b.id, rescheduleCount: 1, status: 'CONFIRMED', startAt: at('14:00').toISOString(), endAt: at('15:00').toISOString() });

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
    expect(history[1].note).toMatch(/^Rescheduled from \w{3} \d+ \w{3}, 10:00 am to \w{3} \d+ \w{3}, 2:00 pm \(IST\)$/);
    expect((await audit('BOOKING_RESCHEDULED'))[0].metadata).toMatchObject({ from: at('10:00').toISOString(), to: at('14:00').toISOString(), rescheduleCount: 1 });

    expect((await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).status).toBe(201); // old slot is free
  });

  it('its own current slot does not block a small move', async () => {
    const b = await book('10:00');
    expect((await move(b.id, '10:30')).status).toBe(200); // 10:30-11:30 overlaps its own 10:00-11:00
    expect((await move(b.id, '10:30')).status).toBe(400); // same time again
  });

  it('a taken slot is 409 and leaves the booking unchanged', async () => {
    const b = await book('10:00');
    const other = await w.addCustomer();
    await other.agent.post('/bookings').send(bookingBody(w, '14:00', other));
    const res = await move(b.id, '14:30');
    expect(res.status).toBe(409);
    const unchanged = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(unchanged).toMatchObject({ rescheduleCount: 0, startAt: at('10:00') });
  });

  it('customers get 2 reschedules; the 3rd is refused, staff can override with a reason', async () => {
    const b = await book('10:00');
    await move(b.id, '11:00');
    await move(b.id, '12:00');
    const third = await move(b.id, '13:00');
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('RESCHEDULE_LIMIT_REACHED');

    const { agent } = await actor('MANAGER');
    const noReason = await agent.post(`/bookings/${b.id}/reschedule`).send({ startAt: at('13:00').toISOString() });
    expect(noReason.body.error.code).toBe('OVERRIDE_REASON_REQUIRED');
    const ok = await agent.post(`/bookings/${b.id}/reschedule`).send({ startAt: at('13:00').toISOString(), overrideReason: 'Customer asked by phone' });
    expect(ok.body.rescheduleCount).toBe(3);
    expect((await audit('BOOKING_RESCHEDULED')).at(-1)!.metadata).toMatchObject({ overridden: ['RESCHEDULE_LIMIT_REACHED'] });
  });

  it('inside the 4-hour window customers are refused', async () => {
    const b = await book('10:00');
    await expect(rescheduleBooking(asCustomer(), b.id, { startAt: at('15:00') }, at('07:00'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'RESCHEDULE_WINDOW_CLOSED',
    });
  });

  it("cannot reschedule someone else's booking or a finished one", async () => {
    const b = await book();
    const other = await w.addCustomer();
    expect((await other.agent.post(`/bookings/${b.id}/reschedule`).send({ startAt: at('14:00').toISOString() })).status).toBe(404);

    await prisma.booking.update({ where: { id: b.id }, data: { status: 'IN_PROGRESS' } });
    expect((await move(b.id, '14:00')).status).toBe(409);
  });

  it('a manager-assigned technician is kept, or the move fails', async () => {
    const { agent } = await actor('MANAGER');
    const b = (await agent.post('/bookings').send({ ...bookingBody(w, '10:00'), customerId: w.customer.user.id, source: 'PHONE', technicianId: w.techs[0].id })).body;
    expect(b.status).toBe('ASSIGNED');
    await prisma.timeOff.create({ data: { technicianId: w.techs[0].id, startAt: at('13:00'), endAt: at('15:00'), createdByUserId: w.techs[0].userId } });
    expect((await move(b.id, '13:00')).status).toBe(409); // the only technician is on time off
  });

  it('a new time clears the needs-reassignment flag', async () => {
    const b = await book('10:00');
    await prisma.booking.update({ where: { id: b.id }, data: { needsReassignment: true } });
    expect((await move(b.id, '14:00')).body.needsReassignment).toBe(false);
  });
});

describe('reading bookings', () => {
  it('customers list only their own; staff can filter and paginate', async () => {
    const other = await w.addCustomer();
    await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'));
    await w.customer.agent.post('/bookings').send(bookingBody(w, '12:00'));
    await other.agent.post('/bookings').send(bookingBody(w, '14:00', other));

    const mine = await w.customer.agent.get(`/bookings?customerId=${other.user.id}`); // filter is ignored for customers
    expect(mine.body.total).toBe(2);
    expect(mine.body.items.every((i: { customer: { id: string } }) => i.customer.id === w.customer.user.id)).toBe(true);

    const { agent } = await actor('OWNER');
    expect((await agent.get('/bookings')).body.total).toBe(3);
    expect((await agent.get(`/bookings?customerId=${other.user.id}`)).body.total).toBe(1);
    expect((await agent.get('/bookings?pageSize=2')).body).toMatchObject({ pageSize: 2, totalPages: 2 });
    expect((await agent.get(`/bookings?from=${monday.toFormat('yyyy-MM-dd')}&to=${monday.toFormat('yyyy-MM-dd')}`)).body.total).toBe(3);
    expect((await agent.get(`/bookings?from=${monday.plus({ days: 1 }).toFormat('yyyy-MM-dd')}`)).body.total).toBe(0);
    expect((await agent.get('/bookings?status=CANCELLED')).body.total).toBe(0);
  });

  it('detail includes history; only the owner of the booking or staff can open it', async () => {
    const b = (await w.customer.agent.post('/bookings').send(bookingBody(w, '10:00'))).body;
    const own = await w.customer.agent.get(`/bookings/${b.id}`);
    expect(own.body.history).toHaveLength(1);
    expect(own.body.history[0].changedBy).toBeUndefined(); // customers do not see who

    const { agent } = await actor('MANAGER');
    expect((await agent.get(`/bookings/${b.id}`)).body.history[0].changedBy).toMatchObject({ role: 'CUSTOMER' });

    const other = await w.addCustomer();
    expect((await other.agent.get(`/bookings/${b.id}`)).status).toBe(404);
    const tech = await actor('TECHNICIAN');
    expect((await tech.agent.get(`/bookings/${b.id}`)).status).toBe(403);
  });
});
