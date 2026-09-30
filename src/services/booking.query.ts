import { DateTime } from 'luxon';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { isStaff } from '../middleware/auth';
import { BUSINESS_TZ } from './availability.compute';
import { bookingDetailView, bookingInclude, bookingView, historyInclude } from './booking.view';
import { findBookingForView, technicianIdOf, type Actor } from './booking.shared';
import type { ListBookingsQuery } from '../routes/bookings.schemas';

const dayStart = (d: string) => DateTime.fromISO(d, { zone: BUSINESS_TZ }).startOf('day').toJSDate();

export async function listBookings(actor: Actor, q: ListBookingsQuery) {
  const where: Prisma.BookingWhereInput = { status: q.status };
  if (q.hideCancelled && !q.status) where.status = { notIn: ['CANCELLED', 'NO_SHOW'] };
  if (isStaff(actor.role)) {
    where.customerId = q.customerId;
    where.technicianId = q.technicianId;
    where.needsReassignment = q.needsReassignment;
  } else if (actor.role === 'TECHNICIAN') {
    where.technicianId = await technicianIdOf(actor); // a technician only ever sees their own jobs
  } else {
    where.customerId = actor.id; // customers only ever see their own, whatever they ask for
  }
  if (q.from || q.to) {
    where.startAt = {
      ...(q.from && { gte: dayStart(q.from) }),
      ...(q.to && { lt: DateTime.fromJSDate(dayStart(q.to), { zone: BUSINESS_TZ }).plus({ days: 1 }).toJSDate() }), // `to` is inclusive
    };
  }

  const [items, total] = await Promise.all([
    prisma.booking.findMany({ where, include: bookingInclude, orderBy: { startAt: q.sort === 'soonest' ? 'asc' : 'desc' }, ...pageArgs(q) }),
    prisma.booking.count({ where }),
  ]);
  return toPage(items.map(bookingView), total, q);
}

export async function getBooking(actor: Actor, id: string) {
  await findBookingForView(actor, id); // 404 for a customer's neighbour or another technician's job
  const [booking, visit, payment] = await Promise.all([
    prisma.booking.findUniqueOrThrow({ where: { id }, include: { ...bookingInclude, ...historyInclude } }),
    prisma.serviceVisit.findUnique({ where: { bookingId: id } }),
    prisma.payment.findFirst({ where: { bookingId: id, status: 'PAID' }, include: { recordedBy: { select: { name: true } } } }),
  ]);
  return bookingDetailView(booking, actor.role, visit, payment);
}
