import { Router } from 'express';
import * as c from '../controllers/catalog.controller';
import * as s from './catalog.schemas';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { idParams, pagination } from '../validation/common';

const ownerOnly = [requireAuth, requireRole('OWNER')];

// Any logged-in user can read the catalog; only the owner edits it.
export const categoriesRouter = Router();
categoriesRouter.get('/', requireAuth, validate({ query: pagination }), c.listCategories);
categoriesRouter.post('/', ...ownerOnly, validate({ body: s.categoryBody }), c.createCategory);
categoriesRouter.patch('/:id', ...ownerOnly, validate({ params: idParams, body: s.categoryBody }), c.renameCategory);

export const servicesRouter = Router();
servicesRouter.get('/', requireAuth, validate({ query: s.listServicesQuery }), c.listServices);
servicesRouter.get('/:id', requireAuth, validate({ params: idParams }), c.getService);
servicesRouter.post('/', ...ownerOnly, validate({ body: s.createServiceBody }), c.createService);
servicesRouter.patch('/:id', ...ownerOnly, validate({ params: idParams, body: s.updateServiceBody }), c.updateService);
