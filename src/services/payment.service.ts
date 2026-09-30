import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { writeAudit } from './audit.service';
import { BUSINESS_TZ } from './availability.compute';
import { amountDue, paymentView } from './booking.view';
import { findBookingFor, findBookingForView, findMyBooking, type Actor } from './booking.shared';
import type { RecordPaymentBody } from '../routes/payments.schemas';

const alreadyPaid = () => new AppError(409, 'ALREADY_PAID', 'This booking has already been paid');

// RC-2026-00001. Same idea as booking numbers: the advisory lock makes simultaneous payments take turns
// picking the next number (released when the transaction ends); the unique index is the backstop.
async function nextReceiptNumber(tx: Prisma.TransactionClient, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(6002)`;
  const prefix = `RC-${DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).year}-`;
  const last = await tx.payment.findFirst({
    where: { receiptNumber: { startsWith: prefix } },
    orderBy: { receiptNumber: 'desc' },
    select: { receiptNumber: true },
  });
  const seq = last?.receiptNumber ? Number(last.receiptNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// The technician (their own job) or a manager records the payment once the visit is completed. The amount is
// worked out here from the service price and the approved extra charge, never taken from the request.
// Payment state is only ever changed on the server. A booking can be paid once: the database enforces it.
export async function recordPayment(actor: Actor, bookingId: string, input: RecordPaymentBody, now = new Date()) {
  const booking = actor.role === 'TECHNICIAN' ? (await findMyBooking(actor, bookingId)).booking : await findBookingFor(actor, bookingId);
  if (booking.status !== 'COMPLETED') {
    throw new AppError(409, 'NOT_COMPLETED', 'Complete the visit before collecting payment');
  }
  if (await prisma.payment.findFirst({ where: { bookingId, status: 'PAID' }, select: { id: true } })) throw alreadyPaid();

  const [service, visit] = await Promise.all([
    prisma.service.findUniqueOrThrow({ where: { id: booking.serviceId }, select: { basePrice: true } }),
    prisma.serviceVisit.findUnique({ where: { bookingId } }),
  ]);
  const amount = amountDue(visit, service.basePrice);

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          bookingId,
          amount,
          method: input.method,
          status: 'PAID',
          providerRef: input.reference || null,
          receiptNumber: await nextReceiptNumber(tx, now),
          recordedByUserId: actor.id,
          paidAt: now,
        },
        include: { recordedBy: { select: { name: true } } },
      });
      await writeAudit(
        {
          userId: actor.id,
          action: 'PAYMENT_RECORDED',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: { paymentId: created.id, amount: amount.toFixed(2), method: input.method, receiptNumber: created.receiptNumber, reference: input.reference ?? null },
        },
        tx,
      );
      return created;
    });
    return paymentView(payment);
  } catch (err) {
    // Two requests recorded the payment at once: the partial unique index let only one through.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw alreadyPaid();
    throw err;
  }
}

// A simple receipt for a paid booking: who, what, how much, how. The customer opens their own; the assigned
// technician and staff can open it too. Rendered as a printable page by the frontend.
export async function getReceipt(actor: Actor, bookingId: string) {
  await findBookingForView(actor, bookingId);
  const [booking, payment, settings] = await Promise.all([
    prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        customer: { select: { name: true, phone: true } },
        service: { select: { name: true, basePrice: true } },
        address: true,
        technician: { select: { user: { select: { name: true } } } },
        visit: true,
      },
    }),
    prisma.payment.findFirst({ where: { bookingId, status: 'PAID' } }),
    prisma.businessSettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!payment) throw AppError.notFound('No receipt yet: this booking has not been paid');

  const extra = booking.visit?.extraChargeStatus === 'APPROVED' ? booking.visit.extraChargeAmount : null;
  return {
    receiptNumber: payment.receiptNumber,
    paidAt: payment.paidAt,
    business: settings?.businessName ?? 'HomeFix Appliance Services',
    bookingNumber: booking.bookingNumber,
    visitDate: booking.startAt,
    customer: { name: booking.customer.name, phone: booking.customer.phone },
    address: [booking.address.line1, booking.address.area, booking.address.city, booking.address.pincode].filter(Boolean).join(', '),
    technician: booking.technician?.user.name ?? null,
    lines: [
      { label: booking.service.name, amount: booking.service.basePrice.toFixed(2) },
      ...(extra ? [{ label: `Extra: ${booking.visit?.extraChargeReason ?? 'additional work'}`, amount: extra.toFixed(2) }] : []),
    ],
    total: payment.amount.toFixed(2),
    method: payment.method,
    reference: payment.providerRef,
    // Staff also see who recorded it; the customer's copy does not need it.
    ...(isStaff(actor.role) && { recordedByUserId: payment.recordedByUserId }),
  };
}
