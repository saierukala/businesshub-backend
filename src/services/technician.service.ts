import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { pageArgs, toPage } from '../db/paginate';
import { AppError } from '../errors/AppError';
import { writeAudit } from './audit.service';
import type { CreateTimeOffBody, ListTechniciansQuery, ListTimeOffQuery, SetWorkingHoursBody } from '../routes/technicians.schemas';

const include = {
  user: { select: { name: true, email: true, active: true } },
  skills: { include: { category: { select: { id: true, name: true } } } },
  areas: true,
  workingHours: true,
} satisfies Prisma.TechnicianInclude;

type Loaded = Prisma.TechnicianGetPayload<{ include: typeof include }>;

const view = (t: Loaded) => ({
  id: t.id,
  userId: t.userId,
  name: t.user.name,
  email: t.user.email,
  phone: t.phone,
  status: t.status,
  skills: t.skills.map((s) => s.category).sort((a, b) => a.name.localeCompare(b.name)),
  areas: t.areas.map((a) => a.area).sort(),
  workingHours: [...t.workingHours]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((h) => ({ dayOfWeek: h.dayOfWeek, startTime: h.startTime, endTime: h.endTime, isOff: h.isOff })),
});

async function load(id: string) {
  const t = await prisma.technician.findUnique({ where: { id }, include });
  if (!t) throw AppError.notFound('Technician not found');
  return t;
}

export async function listTechnicians(q: ListTechniciansQuery) {
  const where: Prisma.TechnicianWhereInput = q.q ? { user: { name: { contains: q.q, mode: 'insensitive' } } } : {};
  const [items, total] = await Promise.all([
    prisma.technician.findMany({ where, include, orderBy: { user: { name: 'asc' } }, ...pageArgs(q) }),
    prisma.technician.count({ where }),
  ]);
  return toPage(items.map(view), total, q);
}

export async function getTechnician(id: string) {
  return view(await load(id));
}

export async function setSkills(actorId: string, id: string, categoryIds: string[]) {
  await load(id);
  const ids = [...new Set(categoryIds)];
  const found = await prisma.serviceCategory.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw AppError.badRequest('One or more categories do not exist');

  await prisma.$transaction(async (tx) => {
    await tx.technicianSkill.deleteMany({ where: { technicianId: id } });
    await tx.technicianSkill.createMany({ data: ids.map((categoryId) => ({ technicianId: id, categoryId })) });
    await writeAudit({ userId: actorId, action: 'TECHNICIAN_SKILLS_SET', entityType: 'Technician', entityId: id, metadata: { categoryIds: ids } }, tx);
  });
  return view(await load(id));
}

export async function setAreas(actorId: string, id: string, areas: string[]) {
  await load(id);
  const unique = [...new Set(areas)]; // already normalised by the schema
  await prisma.$transaction(async (tx) => {
    await tx.technicianServiceArea.deleteMany({ where: { technicianId: id } });
    await tx.technicianServiceArea.createMany({ data: unique.map((area) => ({ technicianId: id, area })) });
    await writeAudit({ userId: actorId, action: 'TECHNICIAN_AREAS_SET', entityType: 'Technician', entityId: id, metadata: { areas: unique } }, tx);
  });
  return view(await load(id));
}

// Times are "HH:mm" in Asia/Kolkata. They are not converted: the availability engine (Phase 5)
// reads them as local business time.
export async function setWorkingHours(actorId: string, id: string, { days }: SetWorkingHoursBody) {
  await load(id);
  await prisma.$transaction(async (tx) => {
    for (const d of days) {
      await tx.workingHours.upsert({
        where: { technicianId_dayOfWeek: { technicianId: id, dayOfWeek: d.dayOfWeek } },
        update: { startTime: d.startTime, endTime: d.endTime, isOff: d.isOff },
        create: { technicianId: id, ...d },
      });
    }
    await writeAudit({ userId: actorId, action: 'TECHNICIAN_HOURS_SET', entityType: 'Technician', entityId: id, metadata: { days } }, tx);
  });
  return view(await load(id));
}

export async function listTimeOff(id: string, q: ListTimeOffQuery) {
  await load(id);
  const where: Prisma.TimeOffWhereInput = { technicianId: id, ...(q.includePast ? {} : { endAt: { gt: new Date() } }) };
  const [items, total] = await Promise.all([
    prisma.timeOff.findMany({ where, orderBy: { startAt: 'asc' }, ...pageArgs(q) }),
    prisma.timeOff.count({ where }),
  ]);
  return toPage(items, total, q);
}

export async function createTimeOff(actorId: string, id: string, input: CreateTimeOffBody) {
  await load(id);
  const overlap = await prisma.timeOff.findFirst({
    where: { technicianId: id, startAt: { lt: input.endAt }, endAt: { gt: input.startAt } },
    select: { id: true },
  });
  if (overlap) throw AppError.conflict('This overlaps time off that is already recorded', 'TIME_OFF_OVERLAP');

  return prisma.$transaction(async (tx) => {
    const row = await tx.timeOff.create({ data: { ...input, technicianId: id, createdByUserId: actorId } });

    // Bookings already inside the time off are never deleted or moved. They are flagged, and the
    // manager reassigns or reschedules them (spec §7). Finished or cancelled ones are left alone.
    const toFlag = await tx.booking.findMany({
      where: {
        technicianId: id,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'NO_SHOW'] },
        startAt: { lt: row.endAt },
        endAt: { gt: row.startAt },
        needsReassignment: false,
      },
      select: { id: true },
    });
    const flagged = await tx.booking.updateMany({
      where: { id: { in: toFlag.map((b) => b.id) } },
      data: { needsReassignment: true },
    });
    // One audit row per booking, so each booking's own history shows why it needs a new technician.
    for (const b of toFlag) {
      await writeAudit(
        { userId: actorId, action: 'BOOKING_FLAGGED_REASSIGNMENT', entityType: 'Booking', entityId: b.id, metadata: { technicianId: id, timeOffId: row.id } },
        tx,
      );
    }

    await writeAudit(
      {
        userId: actorId,
        action: 'TIME_OFF_ADDED',
        entityType: 'Technician',
        entityId: id,
        metadata: {
          timeOffId: row.id,
          startAt: row.startAt.toISOString(),
          endAt: row.endAt.toISOString(),
          reason: row.reason,
          bookingsFlagged: flagged.count,
        },
      },
      tx,
    );
    return { ...row, bookingsNeedingReassignment: flagged.count };
  });
}

export async function deleteTimeOff(actorId: string, id: string, timeOffId: string) {
  // Scoped by technician: a manager cannot delete another technician's row by guessing the id.
  const row = await prisma.timeOff.findFirst({ where: { id: timeOffId, technicianId: id } });
  if (!row) throw AppError.notFound('Time off not found');
  await prisma.$transaction(async (tx) => {
    await tx.timeOff.delete({ where: { id: timeOffId } });
    await writeAudit({ userId: actorId, action: 'TIME_OFF_REMOVED', entityType: 'Technician', entityId: id, metadata: { timeOffId } }, tx);
  });
}
