import type { BookingStatus, Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError';
import { writeAudit } from './audit.service';

// The ONE place that says which status moves are allowed (spec §5).
// Later phases (assign, technician progress, complete) use the same map.
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['EN_ROUTE', 'CANCELLED', 'NO_SHOW'],
  EN_ROUTE: ['ARRIVED', 'NO_SHOW'],
  ARRIVED: ['IN_PROGRESS', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// Statuses where the customer's slot can still be moved.
export const RESCHEDULABLE: BookingStatus[] = ['PENDING', 'CONFIRMED', 'ASSIGNED'];

export function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ${from} booking cannot be changed to ${to}`);
  }
}

type Change = {
  booking: { id: string; status: BookingStatus };
  to: BookingStatus;
  actorId: string;
  note?: string;
  auditAction: string;
  metadata?: Prisma.InputJsonObject;
  data?: Prisma.BookingUncheckedUpdateManyInput; // extra columns to change in the same update
};

// A booking that is over no longer needs a new technician, so it leaves the "Needs reassignment" queue.
const ENDED: BookingStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW'];

// Every status change goes through here, inside a transaction: check the map, update, then write
// BookingStatusHistory and AuditLog (spec rule 7).
export async function changeStatus(tx: Prisma.TransactionClient, c: Change) {
  assertTransition(c.booking.status, c.to);

  // "where status = from" makes a second request that raced us fail instead of overwriting.
  const { count } = await tx.booking.updateMany({
    where: { id: c.booking.id, status: c.booking.status },
    data: { ...c.data, status: c.to, ...(ENDED.includes(c.to) && { needsReassignment: false }) },
  });
  if (count === 0) throw new AppError(409, 'INVALID_TRANSITION', 'This booking was just changed by someone else. Reload and try again.');

  await tx.bookingStatusHistory.create({
    data: { bookingId: c.booking.id, fromStatus: c.booking.status, toStatus: c.to, changedByUserId: c.actorId, note: c.note },
  });
  await writeAudit(
    {
      userId: c.actorId,
      action: c.auditAction,
      entityType: 'Booking',
      entityId: c.booking.id,
      metadata: { from: c.booking.status, to: c.to, ...c.metadata },
    },
    tx,
  );
}
