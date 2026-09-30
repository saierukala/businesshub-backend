import { DateTime } from 'luxon';
import type { Role } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { BUSINESS_TZ, computeSlots, type TechnicianInput } from './availability.compute';
import type { AvailabilityQuery } from '../routes/availability.schemas';

const isStaff = (role: Role) => role === 'OWNER' || role === 'MANAGER';

// Loads what the pure engine needs for one day, runs it, and shapes the answer for the caller.
// Mode comes from the caller's ROLE, never from the request: a customer cannot ask for staff mode.
export async function getAvailability(role: Role, q: AvailabilityQuery, now = new Date()) {
  const service = await prisma.service.findUnique({ where: { id: q.serviceId } });
  if (!service || !service.active) throw AppError.notFound('Service not found');

  const settings = await prisma.businessSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const dayStart = DateTime.fromISO(q.date, { zone: BUSINESS_TZ }).startOf('day');
  const window = { lt: dayStart.plus({ days: 1 }).toJSDate() }; // starts before the day ends...
  const dayStartDate = dayStart.toJSDate(); // ...and ends after it began = overlaps the day

  const technicians = await prisma.technician.findMany({
    where: {
      status: 'ACTIVE',
      user: { active: true },
      skills: { some: { categoryId: service.categoryId } },
      areas: { some: { area: q.area } },
    },
    include: {
      user: { select: { name: true } },
      skills: true,
      areas: true,
      workingHours: true,
      timeOff: { where: { startAt: window, endAt: { gt: dayStartDate } } },
      // Same statuses the database constraint ignores: cancelled and no-show free the slot.
      bookings: { where: { status: { notIn: ['CANCELLED', 'NO_SHOW'] }, startAt: window, endAt: { gt: dayStartDate } } },
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

  const staff = isStaff(role);
  const slots = computeSlots({
    date: q.date,
    categoryId: service.categoryId,
    area: q.area,
    durationMinutes: service.durationMinutes,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    cutoffMinutes: settings.bookingCutoffMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    mode: staff ? 'staff' : 'customer',
    now,
    technicians: inputs,
  });

  const names = new Map(inputs.map((t) => [t.id, t.name]));
  return {
    date: q.date,
    timezone: BUSINESS_TZ,
    durationMinutes: service.durationMinutes,
    // Customers get times only. Staff also see who is free, so the manager can pick.
    slots: slots.map((s) => ({
      startAt: s.startAt,
      endAt: s.endAt,
      ...(staff && { technicians: s.technicianIds.map((id) => ({ id, name: names.get(id)! })) }),
    })),
  };
}
