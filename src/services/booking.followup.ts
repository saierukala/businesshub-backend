import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { modeFor } from './availability.service';
import { placeBooking } from './booking.service';
import { findBookingForView, type Actor } from './booking.shared';
import type { FollowUpBody } from '../routes/visits.schemas';

// A repair that needs a second visit: a NEW booking for the same customer, appliance and address, linked to
// the original with followUpOfBookingId. The manager or the assigned technician can create it, while the
// visit is in progress or after it is completed. It goes through the same slot engine and database
// constraint as every other booking.
export async function createFollowUp(actor: Actor, bookingId: string, input: FollowUpBody, now = new Date()) {
  const staff = isStaff(actor.role);
  if (!staff && actor.role !== 'TECHNICIAN') throw AppError.forbidden();
  if (!staff && (input.technicianId || input.overrideReason)) throw AppError.forbidden('Only staff can choose the technician or override a rule');

  const original = await findBookingForView(actor, bookingId); // a technician: only their own job (404 otherwise)
  if (original.status !== 'IN_PROGRESS' && original.status !== 'COMPLETED') {
    throw new AppError(409, 'INVALID_TRANSITION', 'A follow-up can be booked once the visit has started');
  }

  const [service, appliance, address] = await Promise.all([
    prisma.service.findUnique({ where: { id: input.serviceId ?? original.serviceId } }),
    prisma.appliance.findUniqueOrThrow({ where: { id: original.applianceId } }),
    prisma.address.findUniqueOrThrow({ where: { id: original.addressId } }),
  ]);
  if (!service || !service.active) throw AppError.notFound('Service not found');
  if (appliance.categoryId !== service.categoryId) {
    throw AppError.badRequest('This service is not for that appliance type', [{ path: 'serviceId', message: 'Pick a service for this appliance' }]);
  }

  return placeBooking({
    actor,
    mode: modeFor(actor.role), // staff may go inside the cutoff (with a reason); a technician books normal slots
    customerId: original.customerId,
    appliance,
    service,
    address,
    problem: input.problemDescription ?? `Follow-up to ${original.bookingNumber}`,
    startAt: input.startAt,
    source: original.source,
    technicianId: input.technicianId,
    overrideReason: input.overrideReason,
    followUpOfBookingId: original.id,
    now,
  });
}
