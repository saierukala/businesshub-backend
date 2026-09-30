import { Router } from 'express';
import * as c from '../controllers/user.controller';
import * as s from './users.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams } from '../validation/common';

// Owner only: staff accounts and deactivating users.
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('OWNER'));
usersRouter.get('/', validate({ query: s.listUsersQuery }), c.list);
usersRouter.post('/', validate({ body: s.createUserBody }), c.create);
usersRouter.patch('/:id/active', validate({ params: idParams, body: s.setActiveBody }), c.setActive);
usersRouter.post('/:id/invite', validate({ params: idParams }), c.resendInvite);
