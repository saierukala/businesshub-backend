import { Router } from 'express';
import * as c from '../controllers/address.controller';
import * as s from './addresses.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams } from '../validation/common';

// Customers manage their own; Owner/Manager manage any customer's (customerId required).
export const addressesRouter = Router();
addressesRouter.use(requireAuth, requireRole('CUSTOMER', 'OWNER', 'MANAGER'));
addressesRouter.get('/', validate({ query: s.listAddressesQuery }), c.list);
addressesRouter.post('/', validate({ body: s.createAddressBody }), c.create);
addressesRouter.patch('/:id', validate({ params: idParams, body: s.updateAddressBody }), c.update);
addressesRouter.delete('/:id', validate({ params: idParams }), c.remove);
