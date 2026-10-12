import { Router } from 'express';
import { z } from 'zod';
import { zBoolString, zIdParam } from '@wewin/shared';
import { handle } from '../http';
import { notify } from './notify.service';

/** /api/v1/notifications — the signed-in user's own notifications (no extra permission needed). */
export const notifyRouter = Router();
notifyRouter.get(
  '/notifications',
  handle({ query: z.object({ unread: zBoolString.optional(), take: z.coerce.number().int().min(1).max(100).default(30) }) }, ({ user, query }) =>
    notify.list(user.id, !!query.unread, query.take),
  ),
);
notifyRouter.get('/notifications/unread-count', handle({}, async ({ user }) => ({ count: await notify.unreadCount(user.id) })));
notifyRouter.post('/notifications/read-all', handle({}, async ({ user }) => ({ updated: (await notify.markRead(user.id)).count })));
notifyRouter.post(
  '/notifications/:id/read',
  handle({ params: zIdParam }, async ({ user, params }) => ({ updated: (await notify.markRead(user.id, params.id)).count })),
);
