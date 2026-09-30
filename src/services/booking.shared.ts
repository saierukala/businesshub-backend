import { DateTime } from 'luxon';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { assertOwnsRecord } from './customer-access.service';
import { BUSINESS_TZ } from './availability.compute';

export type Actor = { id: string; role: Role };

// Bookings that still occupy the technician. Cancelled and no-show free the slot (same as the DB constraint).
export const FREES_SLOT = ['CANCELLED', 'NO_SHOW'] as const;

export const istDate = (d: Date) => DateTime.fromJSDate(d, { zone: BUSINESS_TZ }).toFormat('yyyy-MM-dd');

// Loads a booking the actor may act on. A customer asking for someone else's booking gets 404.
export async function findBookingFor(actor: Actor, id: string) {
  return assertOwnsRecord(actor, await prisma.booking.findUnique({ where: { id } }), 'Booking');
}

type Blocked = { code: string; message: string };

// Staff may override cutoff and cancellation windows only, and only with a reason that goes into the
// audit log (spec rule 4). A customer who hits one of these is simply refused (409).
// Returns what to record in the audit log, or undefined when nothing was overridden.
export function checkOverrides(actor: Actor, blocked: Blocked[], overrideReason?: string) {
  if (blocked.length === 0) return undefined;
  if (!isStaff(actor.role)) throw new AppError(409, blocked[0].code, blocked[0].message);
  if (!overrideReason) {
    throw new AppError(400, 'OVERRIDE_REASON_REQUIRED', `${blocked.map((b) => b.message).join(' ')} Enter a reason to go ahead anyway.`, [
      { path: 'overrideReason', message: 'A reason is required' },
    ]);
  }
  return { overrideReason, overridden: blocked.map((b) => b.code) };
}

// Technicians free for a slot, fewest bookings that day first (spread the work), then by id so it is stable.
export async function orderByLoad(technicianIds: string[], date: string): Promise<string[]> {
  const dayStart = DateTime.fromISO(date, { zone: BUSINESS_TZ }).startOf('day');
  const rows = await prisma.booking.groupBy({
    by: ['technicianId'],
    where: {
      technicianId: { in: technicianIds },
      status: { notIn: [...FREES_SLOT] },
      startAt: { gte: dayStart.toJSDate(), lt: dayStart.plus({ days: 1 }).toJSDate() },
    },
    _count: { _all: true },
  });
  const load = new Map(rows.map((r) => [r.technicianId, r._count._all]));
  return [...technicianIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b));
}

// BH-2026-00001. The advisory lock makes two simultaneous bookings take turns picking the next number
// (it is released when the transaction ends). The unique index on bookingNumber is the backstop.
export async function nextBookingNumber(tx: Prisma.TransactionClient, now: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(6001)`;
  const prefix = `BH-${DateTime.fromJSDate(now, { zone: BUSINESS_TZ }).year}-`;
  const last = await tx.booking.findFirst({
    where: { bookingNumber: { startsWith: prefix } },
    orderBy: { bookingNumber: 'desc' },
    select: { bookingNumber: true },
  });
  const seq = last ? Number(last.bookingNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

export const slotGone = () => new AppError(409, 'SLOT_UNAVAILABLE', 'That time slot is no longer available. Please choose another.');

export const hours = (minutes: number) => `${minutes / 60} hours`;
