import { Router } from 'express';
import * as c from '../controllers/customer.controller';
import * as s from './customers.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams } from '../validation/common';

// Staff only. Customers see their own profile via /auth/me.
export const customersRouter = Router();
customersRouter.use(requireAuth, requireRole('OWNER', 'MANAGER'));
customersRouter.get('/', validate({ query: s.listCustomersQuery }), c.search);
customersRouter.post('/', validate({ body: s.createCustomerBody }), c.create);
customersRouter.get('/:id', validate({ params: idParams }), c.get);
customersRouter.patch('/:id', validate({ params: idParams, body: s.updateCustomerBody }), c.update);
