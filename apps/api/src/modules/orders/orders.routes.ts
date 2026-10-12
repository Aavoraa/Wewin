import { Router } from 'express';
import { zCostingInput, zIdParam, zOrderInput, zOrderListQuery, zOrderUpdate, zReason } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { ordersController, zSearch } from './orders.controller';

/** /api/v1/orders (A§8 endpoint map: orders, lines, costing; confirm, close). */
export const ordersRouter = Router();
const view = requirePermission('orders.view');
const c = ordersController;
ordersRouter.get('/orders', view, handle({ query: zOrderListQuery }, c.list));
ordersRouter.get('/orders/search', view, handle({ query: zSearch }, c.search));
ordersRouter.get('/orders/:id', view, handle({ params: zIdParam }, c.get));
ordersRouter.get('/orders/:id/lines', view, handle({ params: zIdParam }, c.lines));
ordersRouter.post('/orders', requirePermission('orders.create'), handle({ body: zOrderInput }, c.create, { status: 201 }));
ordersRouter.patch('/orders/:id', requirePermission('orders.create'), handle({ params: zIdParam, body: zOrderUpdate }, c.update));
ordersRouter.delete('/orders/:id', requirePermission('orders.create'), handle({ params: zIdParam }, c.remove));
ordersRouter.post('/orders/:id/confirm', requirePermission('orders.confirm'), handle({ params: zIdParam }, c.confirm));
ordersRouter.post('/orders/:id/close', requirePermission('orders.close'), handle({ params: zIdParam, body: zReason }, c.close));
ordersRouter.post('/orders/:id/cancel', requirePermission('orders.close'), handle({ params: zIdParam, body: zReason }, c.cancel));
ordersRouter.get('/orders/:id/costing', view, handle({ params: zIdParam }, c.getCosting));
ordersRouter.put('/orders/:id/costing', requirePermission('orders.costing.edit'), handle({ params: zIdParam, body: zCostingInput }, c.saveCosting));
