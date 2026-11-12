import { Router } from 'express';
import { zIdParam, zReason, zStockDocInput, zStockDocListQuery, zStockDocUpdate } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { stockDocsService as svc } from './stockdocs.service';

type In<T extends object> = HandlerInput<T>;

/** Controller (thin): one service call per request. */
export const stockDocsController = {
  list: async ({ query }: In<{ query: typeof zStockDocListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zStockDocInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zStockDocUpdate }>) => svc.update(params.id, body),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  },
  post: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.post(params.id, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user),
};

/** /api/v1/stock-docs — other deliveries / inwards, yarn transfers between orders, rejections (Q-071). */
export const stockDocsRouter = Router();
const c = stockDocsController;
const view = requirePermission('stock.view');
const create = requirePermission('stockdocs.create');
stockDocsRouter.get('/stock-docs', view, handle({ query: zStockDocListQuery }, c.list));
stockDocsRouter.get('/stock-docs/:id', view, handle({ params: zIdParam }, c.get));
stockDocsRouter.post('/stock-docs', create, handle({ body: zStockDocInput }, c.create, { status: 201 }));
stockDocsRouter.patch('/stock-docs/:id', create, handle({ params: zIdParam, body: zStockDocUpdate }, c.update));
stockDocsRouter.delete('/stock-docs/:id', create, handle({ params: zIdParam }, c.remove));
stockDocsRouter.post('/stock-docs/:id/post', requirePermission('stockdocs.post'), handle({ params: zIdParam }, c.post));
stockDocsRouter.post('/stock-docs/:id/cancel', requirePermission('stockdocs.cancel'), handle({ params: zIdParam, body: zReason }, c.cancel));
