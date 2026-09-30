import { Router } from 'express';
import type { Request, Response } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { idParams } from '../validation/common';
import * as n from '../services/notification.service';
import { listNotificationsQuery, type ListNotificationsQuery } from './notifications.schemas';

// Every logged-in person reads only their own notifications (customer, technician, manager, owner).
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', validate({ query: listNotificationsQuery }), async (req: Request, res: Response) => {
  res.json(await n.listNotifications(req.user!.id, req.validated!.query as ListNotificationsQuery));
});
notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  res.json(await n.unreadCount(req.user!.id));
});
notificationsRouter.post('/read-all', async (req: Request, res: Response) => {
  res.json(await n.markAllRead(req.user!.id));
});
notificationsRouter.post('/:id/read', validate({ params: idParams }), async (req: Request, res: Response) => {
  res.json(await n.markRead(req.user!.id, (req.validated!.params as { id: string }).id));
});
