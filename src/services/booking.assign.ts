import type { Booking, BookingStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { isExclusionViolation } from '../db/pgErrors';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { writeAudit } from './audit.service';
import { loadSlots } from './availability.service';
import { changeStatus } from './booking.status';
import { bookingInclude, bookingView } from './booking.view';
import { findBookingFor, istDate, orderByLoad, slotGone, type Actor } from './booking.shared';
import type { AssignBookingBody } from '../routes/bookings.schemas';

// A technician can be given (or swapped) while the visit has not started.
const ASSIGNABLE: BookingStatus[] = ['CONFIRMED', 'ASSIGNED'];

// Loads the booking for staff and checks its status. Assigning is a manager job.
async function assignableBooking(actor: Actor, bookingId: string): Promise<Booking> {
  if (!isStaff(actor.role)) throw AppError.forbidden();
  const booking = await findBookingFor(actor, bookingId);
  if (!ASSIGNABLE.includes(booking.status)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ${booking.status} booking cannot be given a technician`);
  }
  return booking;
}

// Technicians who could take this booking at its current time: active, skilled, covering the area,
// inside their hours, not on time off and not busy with another booking. The booking's own slot does
// not count against its current technician. The same engine as GET /availability, so the answer cannot differ.
async function freeTechnicians(booking: Booking, now: Date) {
  const [service, address] = await Promise.all([
    prisma.service.findUniqueOrThrow({ where: { id: booking.serviceId } }),
    prisma.address.findUniqueOrThrow({ where: { id: booking.addressId } }),
  ]);
  const date = istDate(booking.startAt);
  const { slots, names } = await loadSlots({ service, area: address.area, date, mode: 'staff', now, excludeBookingId: booking.id });
  const slot = slots.find((s) => s.startAt.getTime() === booking.startAt.getTime());
  return { ids: slot ? await orderByLoad(slot.technicianIds, date) : [], names, date };
}

export async function listAssignableTechnicians(actor: Actor, bookingId: string, now = new Date()) {
  const booking = await assignableBooking(actor, bookingId);
  const { ids, names } = await freeTechnicians(booking, now);
  return { items: ids.map((id) => ({ id, name: names.get(id)!, isCurrent: id === booking.technicianId })) };
}

// Assign (CONFIRMED -> ASSIGNED) or reassign (ASSIGNED, another technician). The pick must be one of the
// free technicians, and the database constraint still has the last word if two managers race.
export async function assignTechnician(actor: Actor, bookingId: string, input: AssignBookingBody, now = new Date()) {
  const booking = await assignableBooking(actor, bookingId);
  if (booking.status === 'ASSIGNED' && booking.technicianId === input.technicianId) {
    throw AppError.badRequest('This booking is already assigned to that technician');
  }
  const { ids } = await freeTechnicians(booking, now);
  if (!ids.includes(input.technicianId)) throw slotGone(); // not qualified, not free, or inactive

  const previous = booking.technicianId;
  const users = await prisma.technician.findMany({
    where: { id: { in: [input.technicianId, ...(previous ? [previous] : [])] } },
    select: { id: true, user: { select: { name: true } } },
  });
  const nameOf = (id: string | null) => users.find((t) => t.id === id)?.user.name ?? 'nobody';
  const meta = { technicianId: input.technicianId, previousTechnicianId: previous, wasFlagged: booking.needsReassignment };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (booking.status === 'CONFIRMED') {
        await changeStatus(tx, {
          booking,
          to: 'ASSIGNED',
          actorId: actor.id,
          note: input.note ?? `Assigned to ${nameOf(input.technicianId)}`,
          auditAction: 'TECHNICIAN_ASSIGNED',
          metadata: meta,
          data: { technicianId: input.technicianId, needsReassignment: false },
        });
      } else {
        // Already ASSIGNED: the status stays, only the technician changes. "where technicianId = previous"
        // makes a second manager who changed it first win, instead of being overwritten.
        const { count } = await tx.booking.updateMany({
          where: { id: booking.id, status: 'ASSIGNED', technicianId: previous },
          data: { technicianId: input.technicianId, needsReassignment: false },
        });
        if (count === 0) throw new AppError(409, 'CONFLICT', 'This booking was just changed by someone else. Reload and try again.');
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: booking.id,
            fromStatus: 'ASSIGNED',
            toStatus: 'ASSIGNED',
            changedByUserId: actor.id,
            note: input.note ?? `Reassigned from ${nameOf(previous)} to ${nameOf(input.technicianId)}`,
          },
        });
        await writeAudit({ userId: actor.id, action: 'TECHNICIAN_REASSIGNED', entityType: 'Booking', entityId: booking.id, metadata: meta }, tx);
      }
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
    });
    return bookingView(updated);
  } catch (err) {
    if (isExclusionViolation(err)) throw slotGone(); // someone booked that technician a moment ago
    throw err;
  }
}
