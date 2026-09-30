import type { Request, Response } from 'express';
import * as create from '../services/booking.service';
import * as actions from '../services/booking.actions';
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

export async function noShow(req: Request, res: Response) {
  res.json(await actions.markNoShow(req.user!, id(req), body<s.NoShowBody>(req)));
}
