import { Router } from 'express';
import * as c from '../controllers/appliance.controller';
import * as s from './appliances.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams, pagination } from '../validation/common';

// Customers manage their own; Owner/Manager manage any customer's (customerId required).
export const appliancesRouter = Router();
appliancesRouter.use(requireAuth, requireRole('CUSTOMER', 'OWNER', 'MANAGER'));
appliancesRouter.get('/', validate({ query: s.listAppliancesQuery }), c.list);
appliancesRouter.post('/', validate({ body: s.createApplianceBody }), c.create);
appliancesRouter.get('/:id/history', validate({ params: idParams, query: pagination }), c.history);
appliancesRouter.patch('/:id', validate({ params: idParams, body: s.updateApplianceBody }), c.update);
appliancesRouter.delete('/:id', validate({ params: idParams }), c.remove);
