import type { Address, Appliance, BookingSource, Service } from '@prisma/client';
import { prisma } from '../db/prisma';
import { isExclusionViolation } from '../db/pgErrors';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { assertOwnsRecord, resolveCustomerId } from './customer-access.service';
import { getSettings, loadSlots, modeFor, type SlotMode } from './availability.service';
import { writeAudit } from './audit.service';
import { RESCHEDULABLE } from './booking.status';
import { bookingInclude, bookingView } from './booking.view';
import { checkOverrides, findBookingFor, hours, istDate, istLabel, nextBookingNumber, orderByLoad, slotGone, type Actor } from './booking.shared';
import type { CreateBookingBody, RescheduleBookingBody } from '../routes/bookings.schemas';

const minutes = (n: number) => n * 60_000;

// The ONE way to create a booking. Customers and staff both come through here (spec rule 3):
// the controller passes the acting user, and the customer is worked out from their role.
export async function createBooking(actor: Actor, input: CreateBookingBody, now = new Date()) {
  const staff = isStaff(actor.role);
  if (!staff && (input.technicianId || input.overrideReason || input.source)) {
    throw AppError.forbidden('Only staff can choose the technician, the source, or override a rule');
  }
  if (staff && !input.source) {
    throw AppError.badRequest('Choose where this booking came from', [{ path: 'source', message: 'Choose PHONE, WHATSAPP or WALK_IN' }]);
  }

  const customerId = await resolveCustomerId(actor, input.customerId);
  const [service, appliance, address] = await Promise.all([
    prisma.service.findUnique({ where: { id: input.serviceId } }),
    prisma.appliance.findUnique({ where: { id: input.applianceId } }),
    prisma.address.findUnique({ where: { id: input.addressId } }),
  ]);
  if (!service || !service.active) throw AppError.notFound('Service not found');
  // Ownership: the appliance and address must belong to THE CUSTOMER being booked for.
  // (For staff, assertOwnsRecord alone would accept any customer's record.)
  assertOwnsRecord(actor, appliance, 'Appliance');
  assertOwnsRecord(actor, address, 'Address');
  if (appliance!.customerId !== customerId) throw AppError.notFound('Appliance not found');
  if (address!.customerId !== customerId) throw AppError.notFound('Address not found');
  if (appliance!.categoryId !== service.categoryId) {
    throw AppError.badRequest('This service is not for that appliance type', [{ path: 'serviceId', message: 'Pick a service for this appliance' }]);
  }

  return placeBooking({
    actor,
    mode: modeFor(actor.role),
    customerId,
    appliance: appliance!,
    service,
    address: address!,
    problem: input.problemDescription,
    startAt: input.startAt,
    source: staff ? input.source! : 'ONLINE',
    technicianId: input.technicianId,
    overrideReason: input.overrideReason,
    now,
  });
}

type Placement = {
  actor: Actor;
  mode: SlotMode;
  customerId: string;
  appliance: Appliance;
  service: Service;
  address: Address;
  problem: string;
  startAt: Date;
  source: BookingSource;
  technicianId?: string; // staff pick: an assignment (ASSIGNED). Omit to auto-pick a free one (CONFIRMED).
  overrideReason?: string; // staff: needed inside the booking cutoff
  followUpOfBookingId?: string;
  now: Date;
};

// The shared middle of every new booking (customer, staff, follow-up).
//
// Layers against double booking (spec §8):
//  1. the availability engine finds the slot, so the user gets a clear message;
//  2. the database EXCLUDE constraint is the real guarantee: it rejects an overlapping booking even
//     when two requests pass step 1 at the same instant.
// If the DB rejects our pick, we try the next free technician; only when none is left do we return 409.
export async function placeBooking(p: Placement) {
  const { actor, service, address, appliance, startAt, now } = p;
  const staff = isStaff(actor.role);
  const settings = await getSettings();
  const date = istDate(startAt);
  const { slots } = await loadSlots({ service, area: address.area, date, mode: p.mode, now });
  const slot = slots.find((s) => s.startAt.getTime() === startAt.getTime());
  if (!slot) throw slotGone();

  // Staff can book inside the 2-hour cutoff, but must say why. (Customers never get this far: their
  // slot list already excludes it.)
  const override = staff
    ? checkOverrides(
        actor,
        startAt.getTime() < now.getTime() + minutes(settings.bookingCutoffMinutes)
          ? [{ code: 'BOOKING_CUTOFF', message: `This is inside the ${settings.bookingCutoffMinutes / 60}-hour booking cutoff.` }]
          : [],
        p.overrideReason,
      )
    : undefined;

  let candidates: string[];
  if (p.technicianId) {
    if (!slot.technicianIds.includes(p.technicianId)) throw slotGone(); // not free / not qualified for this slot
    candidates = [p.technicianId];
  } else {
    candidates = await orderByLoad(slot.technicianIds, date);
  }

  const endAt = slot.endAt;
  // A technician the manager picked is an assignment; an auto-picked one waits for the manager (spec §5).
  const status = p.technicianId ? 'ASSIGNED' : 'CONFIRMED';
  const note = p.followUpOfBookingId ? 'Follow-up visit' : staff ? `Booked by staff (${p.source})` : 'Booked online';

  for (const technicianId of candidates) {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            bookingNumber: await nextBookingNumber(tx, now),
            customerId: p.customerId,
            applianceId: appliance.id,
            serviceId: service.id,
            addressId: address.id,
            technicianId,
            problemDescription: p.problem,
            startAt,
            endAt,
            status,
            source: p.source,
            createdByUserId: actor.id,
            followUpOfBookingId: p.followUpOfBookingId,
          },
          include: bookingInclude,
        });
        await tx.bookingStatusHistory.create({
          data: { bookingId: created.id, fromStatus: null, toStatus: status, changedByUserId: actor.id, note },
        });
        await writeAudit(
          {
            userId: actor.id,
            action: p.followUpOfBookingId ? 'BOOKING_FOLLOW_UP_CREATED' : 'BOOKING_CREATED',
            entityType: 'Booking',
            entityId: created.id,
            metadata: {
              source: p.source,
              customerId: p.customerId,
              technicianId,
              startAt: startAt.toISOString(),
              followUpOfBookingId: p.followUpOfBookingId ?? null,
              ...override,
            },
          },
          tx,
        );
        return created;
      });
      return bookingView(booking);
    } catch (err) {
      if (isExclusionViolation(err)) continue; // someone got this technician first: try the next one
      throw err;
    }
  }
  throw slotGone();
}

// Same booking, new time: history and audit keep the old and new times, rescheduleCount goes up (spec §4).
export async function rescheduleBooking(actor: Actor, bookingId: string, input: RescheduleBookingBody, now = new Date()) {
  const staff = isStaff(actor.role);
  if (!staff && input.overrideReason) throw AppError.forbidden('Only staff can override a rule');

  const current = await findBookingFor(actor, bookingId);
  if (!RESCHEDULABLE.includes(current.status)) {
    throw new AppError(409, 'INVALID_TRANSITION', `A ${current.status} booking cannot be rescheduled`);
  }
  if (input.startAt.getTime() === current.startAt.getTime()) throw AppError.badRequest('The booking is already at that time');

  const settings = await getSettings();
  const blocked = [];
  if (current.startAt.getTime() - now.getTime() < minutes(settings.rescheduleWindowMinutes)) {
    blocked.push({ code: 'RESCHEDULE_WINDOW_CLOSED', message: `It is less than ${hours(settings.rescheduleWindowMinutes)} before the visit.` });
  }
  if (current.rescheduleCount >= settings.maxReschedules) {
    blocked.push({ code: 'RESCHEDULE_LIMIT_REACHED', message: `This booking was already rescheduled ${settings.maxReschedules} times.` });
  }
  if (!staff) checkOverrides(actor, blocked); // customers: refused with the specific reason

  const [service, address] = await Promise.all([
    prisma.service.findUniqueOrThrow({ where: { id: current.serviceId } }),
    prisma.address.findUniqueOrThrow({ where: { id: current.addressId } }),
  ]);
  const date = istDate(input.startAt);
  const { slots } = await loadSlots({
    service,
    area: address.area,
    date,
    mode: modeFor(actor.role),
    now,
    excludeBookingId: current.id, // its own current slot must not block the move
  });
  const slot = slots.find((s) => s.startAt.getTime() === input.startAt.getTime());
  if (!slot) throw slotGone();

  if (input.startAt.getTime() < now.getTime() + minutes(settings.bookingCutoffMinutes)) {
    blocked.push({ code: 'BOOKING_CUTOFF', message: `The new time is inside the ${settings.bookingCutoffMinutes / 60}-hour booking cutoff.` });
  }
  const override = checkOverrides(actor, blocked, input.overrideReason);

  // Keep the same technician when possible. A technician the manager assigned is kept or the move fails:
  // silently swapping them would undo the assignment.
  const keep = current.technicianId;
  let candidates = await orderByLoad(slot.technicianIds, date);
  if (keep && slot.technicianIds.includes(keep)) candidates = [keep, ...candidates.filter((id) => id !== keep)];
  else if (current.status === 'ASSIGNED') throw slotGone();
  if (current.status === 'ASSIGNED') candidates = candidates.slice(0, 1);

  for (const technicianId of candidates) {
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const { count } = await tx.booking.updateMany({
          where: { id: current.id, status: current.status, startAt: current.startAt }, // nobody changed it meanwhile
          data: {
            startAt: input.startAt,
            endAt: slot.endAt,
            technicianId,
            rescheduleCount: { increment: 1 },
            needsReassignment: false, // a new time resolves a time-off clash
          },
        });
        if (count === 0) throw new AppError(409, 'CONFLICT', 'This booking was just changed by someone else. Reload and try again.');

        const note = `Rescheduled from ${istLabel(current.startAt)} to ${istLabel(input.startAt)} (IST)`;
        await tx.bookingStatusHistory.create({
          data: { bookingId: current.id, fromStatus: current.status, toStatus: current.status, changedByUserId: actor.id, note },
        });
        await writeAudit(
          {
            userId: actor.id,
            action: 'BOOKING_RESCHEDULED',
            entityType: 'Booking',
            entityId: current.id,
            metadata: {
              from: current.startAt.toISOString(),
              to: input.startAt.toISOString(),
              technicianId,
              previousTechnicianId: current.technicianId,
              rescheduleCount: current.rescheduleCount + 1,
              ...override,
            },
          },
          tx,
        );
        return tx.booking.findUniqueOrThrow({ where: { id: current.id }, include: bookingInclude });
      });
      return bookingView(booking);
    } catch (err) {
      if (isExclusionViolation(err)) continue;
      throw err;
    }
  }
  throw slotGone();
}
