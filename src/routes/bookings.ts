import { Router } from 'express';
import * as c from '../controllers/booking.controller';
import * as s from './bookings.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams } from '../validation/common';

// Customers and staff share every endpoint; the service decides what each may do (ownership, windows,
// overrides). Technicians get their own view with visits (Phase 8).
export const bookingsRouter = Router();
bookingsRouter.use(requireAuth, requireRole('CUSTOMER', 'OWNER', 'MANAGER'));
bookingsRouter.get('/', validate({ query: s.listBookingsQuery }), c.list);
bookingsRouter.post('/', validate({ body: s.createBookingBody }), c.createBooking);
bookingsRouter.get('/:id', validate({ params: idParams }), c.get);
bookingsRouter.post('/:id/reschedule', validate({ params: idParams, body: s.rescheduleBookingBody }), c.reschedule);
bookingsRouter.post('/:id/cancel', validate({ params: idParams, body: s.cancelBookingBody }), c.cancel);
bookingsRouter.get('/:id/technicians', requireRole('OWNER', 'MANAGER'), validate({ params: idParams }), c.assignableTechnicians);
bookingsRouter.post('/:id/assign', requireRole('OWNER', 'MANAGER'), validate({ params: idParams, body: s.assignBookingBody }), c.assignTechnician);
bookingsRouter.post('/:id/no-show', requireRole('OWNER', 'MANAGER'), validate({ params: idParams, body: s.noShowBody }), c.noShow);
