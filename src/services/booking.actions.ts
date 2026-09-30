import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { getSettings } from './availability.service';
import { assertTransition, changeStatus } from './booking.status';
import { bookingInclude, bookingView } from './booking.view';
import { checkOverrides, findBookingFor, hours, type Actor } from './booking.shared';
import type { CancelBookingBody, NoShowBody } from '../routes/bookings.schemas';

// Customers cancel their own bookings until 4 hours before the visit. Staff can cancel any booking,
// and inside the window only with a reason (audit-logged).
export async function cancelBooking(actor: Actor, bookingId: string, input: CancelBookingBody, now = new Date()) {
  if (!isStaff(actor.role) && input.overrideReason) throw AppError.forbidden('Only staff can override a rule');

  const booking = await findBookingFor(actor, bookingId);
  assertTransition(booking.status, 'CANCELLED'); // 409 if it is already cancelled, completed, on its way...

  const settings = await getSettings();
  const inside = booking.startAt.getTime() - now.getTime() < settings.cancellationWindowMinutes * 60_000;
  const override = checkOverrides(
    actor,
    inside ? [{ code: 'CANCELLATION_WINDOW_CLOSED', message: `It is less than ${hours(settings.cancellationWindowMinutes)} before the visit.` }] : [],
    input.overrideReason,
  );

  const updated = await prisma.$transaction(async (tx) => {
    await changeStatus(tx, {
      booking,
      to: 'CANCELLED',
      actorId: actor.id,
      note: input.reason,
      auditAction: 'BOOKING_CANCELLED',
      metadata: { reason: input.reason ?? null, ...override },
    });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
  });
  return bookingView(updated);
}

// Staff only. The technician's own status buttons (en route, arrived...) come with visits (Phase 8).
export async function markNoShow(actor: Actor, bookingId: string, input: NoShowBody) {
  if (!isStaff(actor.role)) throw AppError.forbidden();
  const booking = await findBookingFor(actor, bookingId);

  const updated = await prisma.$transaction(async (tx) => {
    await changeStatus(tx, { booking, to: 'NO_SHOW', actorId: actor.id, note: input.note, auditAction: 'BOOKING_NO_SHOW' });
    return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
  });
  return bookingView(updated);
}
