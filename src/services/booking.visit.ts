import type { Booking } from '@prisma/client';
import { prisma } from '../db/prisma';
import { AppError } from '../errors/AppError';
import { isStaff } from '../middleware/auth';
import { writeAudit } from './audit.service';
import { changeStatus } from './booking.status';
import { bookingInclude, bookingView } from './booking.view';
import { findBookingFor, findMyBooking, type Actor } from './booking.shared';
import type {
  AdvanceBody,
  CompleteVisitBody,
  ExtraChargeDecisionBody,
  ProposeExtraChargeBody,
  SaveVisitBody,
} from '../routes/visits.schemas';

const reload = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, include: bookingInclude }).then(bookingView);

// The visit only exists once the work has started, and only the assigned technician edits it.
async function myOpenVisit(actor: Actor, bookingId: string) {
  const { booking, techId } = await findMyBooking(actor, bookingId);
  if (booking.status !== 'IN_PROGRESS') {
    throw new AppError(409, 'INVALID_TRANSITION', 'The visit can only be edited while the work is in progress');
  }
  const visit = await prisma.serviceVisit.findUnique({ where: { bookingId } });
  if (!visit) throw AppError.notFound('Visit not found');
  return { booking, techId, visit };
}

// Technician moves their own booking forward: on the way -> arrived -> in progress (spec §5).
// Starting the work opens the visit record. Skipping a step, or going back, is refused by the transition map.
export async function advanceBooking(actor: Actor, bookingId: string, input: AdvanceBody, now = new Date()) {
  const { booking, techId } = await findMyBooking(actor, bookingId);
  await prisma.$transaction(async (tx) => {
    await changeStatus(tx, {
      booking,
      to: input.to,
      actorId: actor.id,
      auditAction: `BOOKING_${input.to}`,
    });
    if (input.to === 'IN_PROGRESS') {
      await tx.serviceVisit.upsert({
        where: { bookingId },
        update: {},
        create: { bookingId, technicianId: techId, startedAt: now },
      });
    }
  });
  return reload(bookingId);
}

export async function saveVisit(actor: Actor, bookingId: string, input: SaveVisitBody) {
  await myOpenVisit(actor, bookingId);
  await prisma.serviceVisit.update({ where: { bookingId }, data: input });
  return reload(bookingId);
}

// Completing needs the diagnosis and work performed (validated by the schema) and no extra charge still
// waiting for the customer: work beyond the base service proceeds only when approved (spec §10).
export async function completeVisit(actor: Actor, bookingId: string, input: CompleteVisitBody, now = new Date()) {
  const { booking, visit } = await myOpenVisit(actor, bookingId);
  if (visit.extraChargeStatus === 'PROPOSED') {
    throw new AppError(409, 'EXTRA_CHARGE_PENDING', 'The customer has not decided on the extra charge yet');
  }
  await prisma.$transaction(async (tx) => {
    await tx.serviceVisit.update({ where: { bookingId }, data: { ...input, completedAt: now } });
    await changeStatus(tx, {
      booking,
      to: 'COMPLETED',
      actorId: actor.id,
      note: 'Visit completed',
      auditAction: 'VISIT_COMPLETED',
    });
  });
  return reload(bookingId);
}

// The technician found extra work: record the amount and reason. Nothing beyond the base service
// happens until the customer (or the manager, from a phone call) approves it.
export async function proposeExtraCharge(actor: Actor, bookingId: string, input: ProposeExtraChargeBody) {
  const { visit } = await myOpenVisit(actor, bookingId);
  if (visit.extraChargeStatus === 'PROPOSED') {
    throw new AppError(409, 'EXTRA_CHARGE_PENDING', 'An extra charge is already waiting for the customer');
  }
  if (visit.extraChargeStatus === 'APPROVED') {
    throw new AppError(409, 'EXTRA_CHARGE_APPROVED', 'An extra charge was already approved for this visit');
  }
  await prisma.$transaction(async (tx) => {
    await tx.serviceVisit.update({
      where: { bookingId },
      data: {
        extraChargeAmount: input.amount,
        extraChargeReason: input.reason,
        extraChargeStatus: 'PROPOSED',
        extraChargeDecidedByUserId: null,
        extraChargeDecidedAt: null,
      },
    });
    await writeAudit(
      { userId: actor.id, action: 'EXTRA_CHARGE_PROPOSED', entityType: 'Booking', entityId: bookingId, metadata: { amount: input.amount, reason: input.reason } },
      tx,
    );
  });
  return reload(bookingId);
}

// The customer approves or declines in the app; the manager can record the customer's answer from a
// phone call. Either way the deciding user and time are stored. A technician cannot decide.
export async function decideExtraCharge(actor: Actor, bookingId: string, input: ExtraChargeDecisionBody, now = new Date()) {
  const booking: Booking = await findBookingFor(actor, bookingId); // customer: own only (404 otherwise); technician: 403
  const visit = await prisma.serviceVisit.findUnique({ where: { bookingId } });
  if (!visit || visit.extraChargeStatus !== 'PROPOSED') {
    throw new AppError(409, 'NO_EXTRA_CHARGE_PENDING', 'There is no extra charge waiting for a decision');
  }
  if (booking.status !== 'IN_PROGRESS') {
    throw new AppError(409, 'INVALID_TRANSITION', 'The extra charge can only be decided while the work is in progress');
  }
  const { count } = await prisma.$transaction(async (tx) => {
    // "where status = PROPOSED": two answers at once (customer and manager) cannot both win.
    const updated = await tx.serviceVisit.updateMany({
      where: { bookingId, extraChargeStatus: 'PROPOSED' },
      data: { extraChargeStatus: input.decision, extraChargeDecidedByUserId: actor.id, extraChargeDecidedAt: now },
    });
    if (updated.count === 1) {
      await writeAudit(
        {
          userId: actor.id,
          action: input.decision === 'APPROVED' ? 'EXTRA_CHARGE_APPROVED' : 'EXTRA_CHARGE_DECLINED',
          entityType: 'Booking',
          entityId: bookingId,
          metadata: { amount: visit.extraChargeAmount?.toFixed(2) ?? null, decidedByRole: actor.role, onBehalfOfCustomer: isStaff(actor.role) },
        },
        tx,
      );
    }
    return updated;
  });
  if (count === 0) throw new AppError(409, 'NO_EXTRA_CHARGE_PENDING', 'Someone else already decided on this extra charge');
  return reload(bookingId);
}
