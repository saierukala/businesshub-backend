import { Router } from 'express';
import * as c from '../controllers/booking.controller';
import * as s from './bookings.schemas';
import * as v from './visits.schemas';
import * as p from './payments.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams } from '../validation/common';

// Customers and staff share the booking endpoints; the service decides what each may do (ownership, windows,
// overrides). Technicians read their own assigned jobs and work them through the visit endpoints below.
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const customerOrStaff = requireRole('CUSTOMER', 'OWNER', 'MANAGER');
const staffOnly = requireRole('OWNER', 'MANAGER');
const techOnly = requireRole('TECHNICIAN');

// Reading: everyone sees their own (a technician: the jobs assigned to them).
bookingsRouter.get('/', requireRole('CUSTOMER', 'OWNER', 'MANAGER', 'TECHNICIAN'), validate({ query: s.listBookingsQuery }), c.list);
bookingsRouter.get('/:id', requireRole('CUSTOMER', 'OWNER', 'MANAGER', 'TECHNICIAN'), validate({ params: idParams }), c.get);

// Booking, moving, cancelling.
bookingsRouter.post('/', customerOrStaff, validate({ body: s.createBookingBody }), c.createBooking);
bookingsRouter.post('/:id/reschedule', customerOrStaff, validate({ params: idParams, body: s.rescheduleBookingBody }), c.reschedule);
bookingsRouter.post('/:id/cancel', customerOrStaff, validate({ params: idParams, body: s.cancelBookingBody }), c.cancel);

// Staff: who does the job, and no-shows.
bookingsRouter.get('/:id/technicians', staffOnly, validate({ params: idParams }), c.assignableTechnicians);
bookingsRouter.post('/:id/assign', staffOnly, validate({ params: idParams, body: s.assignBookingBody }), c.assignTechnician);
bookingsRouter.post('/:id/no-show', staffOnly, validate({ params: idParams, body: s.noShowBody }), c.noShow);

// The technician's visit (spec §5 and §10).
bookingsRouter.post('/:id/status', techOnly, validate({ params: idParams, body: v.advanceBody }), c.advance);
bookingsRouter.patch('/:id/visit', techOnly, validate({ params: idParams, body: v.saveVisitBody }), c.saveVisit);
bookingsRouter.post('/:id/visit/complete', techOnly, validate({ params: idParams, body: v.completeVisitBody }), c.completeVisit);
bookingsRouter.post('/:id/visit/extra-charge', techOnly, validate({ params: idParams, body: v.proposeExtraChargeBody }), c.proposeExtraCharge);
// The customer decides in the app; the manager can record the customer's answer from a phone call.
bookingsRouter.post(
  '/:id/visit/extra-charge/decision',
  customerOrStaff,
  validate({ params: idParams, body: v.extraChargeDecisionBody }),
  c.decideExtraCharge,
);

// A second visit for the same repair: manager or the assigned technician.
bookingsRouter.post('/:id/follow-up', requireRole('OWNER', 'MANAGER', 'TECHNICIAN'), validate({ params: idParams, body: v.followUpBody }), c.followUp);

// Payment (Phase 9): the technician of a completed job or a manager records it; everyone involved can open the receipt.
bookingsRouter.post('/:id/payment', requireRole('OWNER', 'MANAGER', 'TECHNICIAN'), validate({ params: idParams, body: p.recordPaymentBody }), c.recordPayment);
bookingsRouter.get('/:id/receipt', requireRole('CUSTOMER', 'OWNER', 'MANAGER', 'TECHNICIAN'), validate({ params: idParams }), c.receipt);
