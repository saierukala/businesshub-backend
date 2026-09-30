import type { Request, Response } from 'express';
import * as create from '../services/booking.service';
import * as actions from '../services/booking.actions';
import * as assign from '../services/booking.assign';
import * as visits from '../services/booking.visit';
import * as followUps from '../services/booking.followup';
import * as payments from '../services/payment.service';
import type { RecordPaymentBody } from '../routes/payments.schemas';
import type * as v2 from '../routes/visits.schemas';
import * as query from '../services/booking.query';
import type * as s from '../routes/bookings.schemas';

const v = (req: Request) => req.validated!;
const id = (req: Request) => (v(req).params as { id: string }).id;
const body = <T>(req: Request) => v(req).body as T;

export async function list(req: Request, res: Response) {
  res.json(await query.listBookings(req.user!, v(req).query as s.ListBookingsQuery));
}

export async function get(req: Request, res: Response) {
  res.json(await query.getBooking(req.user!, id(req)));
}

export async function createBooking(req: Request, res: Response) {
  res.status(201).json(await create.createBooking(req.user!, body<s.CreateBookingBody>(req)));
}

export async function reschedule(req: Request, res: Response) {
  res.json(await create.rescheduleBooking(req.user!, id(req), body<s.RescheduleBookingBody>(req)));
}

export async function cancel(req: Request, res: Response) {
  res.json(await actions.cancelBooking(req.user!, id(req), body<s.CancelBookingBody>(req)));
}

export async function assignableTechnicians(req: Request, res: Response) {
  res.json(await assign.listAssignableTechnicians(req.user!, id(req)));
}

export async function assignTechnician(req: Request, res: Response) {
  res.json(await assign.assignTechnician(req.user!, id(req), body<s.AssignBookingBody>(req)));
}

export async function advance(req: Request, res: Response) {
  res.json(await visits.advanceBooking(req.user!, id(req), body<v2.AdvanceBody>(req)));
}

export async function saveVisit(req: Request, res: Response) {
  res.json(await visits.saveVisit(req.user!, id(req), body<v2.SaveVisitBody>(req)));
}

export async function completeVisit(req: Request, res: Response) {
  res.json(await visits.completeVisit(req.user!, id(req), body<v2.CompleteVisitBody>(req)));
}

export async function proposeExtraCharge(req: Request, res: Response) {
  res.json(await visits.proposeExtraCharge(req.user!, id(req), body<v2.ProposeExtraChargeBody>(req)));
}

export async function decideExtraCharge(req: Request, res: Response) {
  res.json(await visits.decideExtraCharge(req.user!, id(req), body<v2.ExtraChargeDecisionBody>(req)));
}

export async function followUp(req: Request, res: Response) {
  res.status(201).json(await followUps.createFollowUp(req.user!, id(req), body<v2.FollowUpBody>(req)));
}

export async function noShow(req: Request, res: Response) {
  res.json(await actions.markNoShow(req.user!, id(req), body<s.NoShowBody>(req)));
}

export async function recordPayment(req: Request, res: Response) {
  res.status(201).json(await payments.recordPayment(req.user!, id(req), body<RecordPaymentBody>(req)));
}

export async function receipt(req: Request, res: Response) {
  res.json(await payments.getReceipt(req.user!, id(req)));
}
