import { Router } from 'express';
import * as c from '../controllers/availability.controller';
import { availabilityQuery } from './availability.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';

// Customers see times only; Owner/Manager also see which technicians are free (decided by role).
export const availabilityRouter = Router();
availabilityRouter.use(requireAuth, requireRole('CUSTOMER', 'OWNER', 'MANAGER'));
availabilityRouter.get('/', validate({ query: availabilityQuery }), c.get);
