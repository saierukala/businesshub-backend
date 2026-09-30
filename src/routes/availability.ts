import { Router } from 'express';
import * as c from '../controllers/availability.controller';
import { availabilityQuery } from './availability.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';

// Customers see times only; Owner/Manager also see which technicians are free (decided by role).
export const availabilityRouter = Router();
// Technicians use it (in customer mode) to pick a slot for a follow-up visit.
availabilityRouter.use(requireAuth, requireRole('CUSTOMER', 'OWNER', 'MANAGER', 'TECHNICIAN'));
availabilityRouter.get('/', validate({ query: availabilityQuery }), c.get);
