import { Router } from 'express';
import { zDocListQuery, zIdParam, zReason, zYarnReceiptInput, zYarnReceiptUpdate } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { yarnController as c } from './yarn.controller';

/** /api/v1/yarn-receipts — Post, cancel (A§8). */
export const yarnRouter = Router();
const view = requirePermission('yarn.view');
const create = requirePermission('yarn.create');

yarnRouter.get('/yarn-receipts', view, handle({ query: zDocListQuery }, c.list));
yarnRouter.get('/yarn-receipts/:id', view, handle({ params: zIdParam }, c.get));
yarnRouter.get('/yarn-receipts/:id/print', view, handle({ params: zIdParam }, c.print));
yarnRouter.get('/yarn-receipts/:id/movements', requirePermission('yarn.view', 'stock.view'), handle({ params: zIdParam }, c.movements));
yarnRouter.post('/yarn-receipts', create, handle({ body: zYarnReceiptInput }, c.create, { status: 201 }));
yarnRouter.patch('/yarn-receipts/:id', create, handle({ params: zIdParam, body: zYarnReceiptUpdate }, c.update));
yarnRouter.delete('/yarn-receipts/:id', create, handle({ params: zIdParam }, c.remove));
yarnRouter.post('/yarn-receipts/:id/post', requirePermission('yarn.post'), handle({ params: zIdParam }, c.post));
yarnRouter.post('/yarn-receipts/:id/cancel', requirePermission('yarn.cancel'), handle({ params: zIdParam, body: zReason }, c.cancel));
