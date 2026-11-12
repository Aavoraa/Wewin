import { Router } from 'express';
import { zApprove, zIdParam, zPoInput, zPoListQuery, zPoUpdate, zReason } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { purchaseService as svc } from './purchase.service';

type In<T extends object> = HandlerInput<T>;

/** Controller (thin): one service call per request. */
export const purchaseController = {
  list: async ({ query }: In<{ query: typeof zPoListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zPoInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zPoUpdate }>) => svc.update(params.id, body),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  },
  approve: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zApprove }>) => svc.approve(params.id, body.note, user),
  revert: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.revert(params.id, body.reason, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user),
  close: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.close(params.id, body.reason, user),
  config: () => svc.config(),
  yarnBalance: ({ params }: In<{ params: typeof zIdParam }>) => svc.yarnBalance(params.id),
};

/** /api/v1/purchase-orders — yarn, fabric and accessories purchase orders (Q-066). */
export const purchaseRouter = Router();
const c = purchaseController;
const view = requirePermission('purchase.view');
const create = requirePermission('purchase.create');
const approve = requirePermission('purchase.approve');
const cancel = requirePermission('purchase.cancel');
purchaseRouter.get('/purchase-orders', view, handle({ query: zPoListQuery }, c.list));
purchaseRouter.get('/purchase-orders/config', view, handle({}, c.config));
purchaseRouter.get('/orders/:id/yarn-balance', view, handle({ params: zIdParam }, c.yarnBalance));
purchaseRouter.get('/purchase-orders/:id', view, handle({ params: zIdParam }, c.get));
purchaseRouter.post('/purchase-orders', create, handle({ body: zPoInput }, c.create, { status: 201 }));
purchaseRouter.patch('/purchase-orders/:id', create, handle({ params: zIdParam, body: zPoUpdate }, c.update));
purchaseRouter.delete('/purchase-orders/:id', create, handle({ params: zIdParam }, c.remove));
purchaseRouter.post('/purchase-orders/:id/approve', approve, handle({ params: zIdParam, body: zApprove }, c.approve));
purchaseRouter.post('/purchase-orders/:id/revert', approve, handle({ params: zIdParam, body: zReason }, c.revert));
purchaseRouter.post('/purchase-orders/:id/cancel', cancel, handle({ params: zIdParam, body: zReason }, c.cancel));
purchaseRouter.post('/purchase-orders/:id/close', cancel, handle({ params: zIdParam, body: zReason }, c.close));
