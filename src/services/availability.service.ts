import { DateTime } from 'luxon';
import type { Role, Service } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { BUSINESS_TZ, computeSlots, type Slot, type TechnicianInput } from './availability.compute';
import { findBookingFor } from './booking.shared';
import type { AvailabilityQuery } from '../routes/availability.schemas';

export type SlotMode = 'customer' | 'staff';

// The single settings row. The seed creates it; if it is missing (fresh database) it is created with the
// defaults. Not an upsert: simultaneous first requests would all try to insert and all but one would fail.
// createMany + skipDuplicates is INSERT ... ON CONFLICT DO NOTHING, which is safe when requests race.
export async function getSettings() {
  const existing = await prisma.businessSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  await prisma.businessSettings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
  return prisma.businessSettings.findUniqueOrThrow({ where: { id: 1 } });
}

// Loads what the pure engine needs for one day and runs it. Shared by GET /availability and by
// createBooking / rescheduleBooking, so the booking check and the slots the user saw cannot differ.
// excludeBookingId: when rescheduling, the booking's own current slot must not block itself.
export async function loadSlots(p: {
  service: Service;
  area: string;
  date: string; // YYYY-MM-DD in Asia/Kolkata
  mode: SlotMode;
  now: Date;
  excludeBookingId?: string;
}): Promise<{ slots: Slot[]; names: Map<string, string> }> {
  const settings = await getSettings();

  const dayStart = DateTime.fromISO(p.date, { zone: BUSINESS_TZ }).startOf('day');
  const before = { lt: dayStart.plus({ days: 1 }).toJSDate() }; // starts before the day ends...
  const after = { gt: dayStart.toJSDate() }; // ...and ends after it began = overlaps the day

  const technicians = await prisma.technician.findMany({
    where: {
      status: 'ACTIVE',
      user: { active: true },
      skills: { some: { categoryId: p.service.categoryId } },
      areas: { some: { area: p.area } },
    },
    include: {
      user: { select: { name: true } },
      skills: true,
      areas: true,
      workingHours: true,
      timeOff: { where: { startAt: before, endAt: after } },
      bookings: {
        where: {
          // Same statuses the database constraint ignores: cancelled and no-show free the slot.
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startAt: before,
          endAt: after,
          ...(p.excludeBookingId && { id: { not: p.excludeBookingId } }),
        },
      },
    },
  });

  const inputs: TechnicianInput[] = technicians.map((t) => ({
    id: t.id,
    name: t.user.name,
    active: true,
    categoryIds: t.skills.map((s) => s.categoryId),
    areas: t.areas.map((a) => a.area),
    workingHours: t.workingHours,
    bookings: t.bookings,
    timeOff: t.timeOff,
  }));

  const slots = computeSlots({
    date: p.date,
    categoryId: p.service.categoryId,
    area: p.area,
    durationMinutes: p.service.durationMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    cutoffMinutes: settings.bookingCutoffMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    mode: p.mode,
    now: p.now,
    technicians: inputs,
  });
  return { slots, names: new Map(inputs.map((t) => [t.id, t.name])) };
}

// Mode comes from the caller's ROLE, never from the request: a customer cannot ask for staff mode.
export const modeFor = (role: Role): SlotMode => (role === 'OWNER' || role === 'MANAGER' ? 'staff' : 'customer');

export async function getAvailability(actor: { id: string; role: Role }, q: AvailabilityQuery, now = new Date()) {
  const service = await prisma.service.findUnique({ where: { id: q.serviceId } });
  if (!service || !service.active) throw AppError.notFound('Service not found');

  // Rescheduling: the booking being moved must not block its own current time, so small shifts
  // (10:00 -> 10:30) are offered. The caller must be allowed to see that booking (a customer's
  // neighbour gets 404), and it must be for this service.
  let excludeBookingId: string | undefined;
  if (q.excludeBookingId) {
    const booking = await findBookingFor(actor, q.excludeBookingId);
    if (booking.serviceId !== service.id) {
      throw AppError.badRequest('That booking is for a different service', [{ path: 'excludeBookingId', message: 'Not for this service' }]);
    }
    excludeBookingId = booking.id;
  }

  const role = actor.role;
  const mode = modeFor(role);
  const { slots, names } = await loadSlots({ service, area: q.area, date: q.date, mode, now, excludeBookingId });

  return {
    date: q.date,
    timezone: BUSINESS_TZ,
    durationMinutes: service.durationMinutes,
    // Customers get times only. Staff also see who is free, so the manager can pick.
    slots: slots.map((s) => ({
      startAt: s.startAt,
      endAt: s.endAt,
      ...(mode === 'staff' && { technicians: s.technicianIds.map((id) => ({ id, name: names.get(id)! })) }),
    })),
  };
}
