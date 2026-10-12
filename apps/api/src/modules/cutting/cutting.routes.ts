import { Router } from 'express';
import { z } from 'zod';
import { zCutLayInput, zCutLayUpdate, zIdParam, zProductionListQuery, zReason } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { cuttingService as svc } from './cutting.service';

type In<T extends object> = HandlerInput<T>;
const zBundleQuery = zProductionListQuery.extend({ colour: z.string().optional(), size: z.string().optional() });
const zBundleNo = z.object({ bundleNo: z.string().trim().min(1).max(60) });

/** Controller (thin): one service call per request. */
export const cuttingController = {
  list: async ({ query }: In<{ query: typeof zProductionListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zCutLayInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zCutLayUpdate }>) => svc.update(params.id, body),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  },
  post: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.post(params.id, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user),
  movements: ({ params }: In<{ params: typeof zIdParam }>) => svc.movements(params.id),
  bundles: async ({ query }: In<{ query: typeof zBundleQuery }>) => {
    const r = await svc.bundles(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  bundleByNo: ({ params }: In<{ params: typeof zBundleNo }>) => svc.bundleByNo(params.bundleNo),
};

/** /api/v1/cut-lays, /bundles (A§8: post; print tickets). */
export const cuttingRouter = Router();
const c = cuttingController;
const view = requirePermission('cutting.view');
const create = requirePermission('cutting.create');
cuttingRouter.get('/cut-lays', view, handle({ query: zProductionListQuery }, c.list));
cuttingRouter.get('/cut-lays/:id', view, handle({ params: zIdParam }, c.get));
cuttingRouter.get('/cut-lays/:id/print', view, handle({ params: zIdParam }, c.get));
cuttingRouter.get('/cut-lays/:id/movements', requirePermission('cutting.view', 'stock.view'), handle({ params: zIdParam }, c.movements));
cuttingRouter.post('/cut-lays', create, handle({ body: zCutLayInput }, c.create, { status: 201 }));
cuttingRouter.patch('/cut-lays/:id', create, handle({ params: zIdParam, body: zCutLayUpdate }, c.update));
cuttingRouter.delete('/cut-lays/:id', create, handle({ params: zIdParam }, c.remove));
cuttingRouter.post('/cut-lays/:id/post', requirePermission('cutting.post'), handle({ params: zIdParam }, c.post));
cuttingRouter.post('/cut-lays/:id/cancel', requirePermission('cutting.cancel'), handle({ params: zIdParam, body: zReason }, c.cancel));
cuttingRouter.get('/bundles', view, handle({ query: zBundleQuery }, c.bundles));
cuttingRouter.get('/bundles/by-no/:bundleNo', requirePermission('stock.view'), handle({ params: zBundleNo }, c.bundleByNo));
