import { Router } from 'express';
import { z } from 'zod';
import {
  zIdParam,
  zPanelInInput,
  zPanelInUpdate,
  zPanelOutInput,
  zPanelOutUpdate,
  zProductionListQuery,
  zReason,
  zRecutSlipInput,
  zRecutSlipUpdate,
} from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { AppError } from '../../core/errors/app-error';
import { panelsService as svc } from './panels.service';

type In<T extends object> = HandlerInput<T>;
const zTyped = z.object({ type: z.enum(['OUT', 'IN']) }).passthrough();
const zVendorQ = z.object({ vendorId: z.string().uuid() });
const list = <T>(r: { rows: T[]; total: number; p: { page: number; pageSize: number } }) => new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });

/** Controller: panel D.C. type decides which shared schema validates the body. */
export const panelsController = {
  list: async ({ query }: In<{ query: typeof zProductionListQuery }>) => list(await svc.list(query)),
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  pending: ({ query }: In<{ query: typeof zVendorQ }>) => svc.pendingForVendor(query.vendorId),
  create: ({ body, user }: In<{ body: typeof zTyped }>) =>
    body.type === 'OUT' ? svc.create('OUT', zPanelOutInput.parse(body), user) : svc.create('IN', zPanelInInput.parse(body), user),
  update: async ({ params, body }: In<{ params: typeof zIdParam; body: typeof zTyped }>) => {
    const cur = await svc.get(params.id);
    if (cur.type !== body.type) throw new AppError('VALIDATION_ERROR', 'Document type cannot change', 400);
    return svc.update(params.id, body.type === 'OUT' ? zPanelOutUpdate.parse(body) : zPanelInUpdate.parse(body));
  },
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  },
  post: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.post(params.id, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user),
  close: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.close(params.id, body.reason, user),

  listRecut: async ({ query }: In<{ query: typeof zProductionListQuery }>) => list(await svc.listRecut(query)),
  getRecut: ({ params }: In<{ params: typeof zIdParam }>) => svc.getRecut(params.id),
  createRecut: ({ body }: In<{ body: typeof zRecutSlipInput }>) => svc.createRecut(body),
  updateRecut: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zRecutSlipUpdate }>) => svc.updateRecut(params.id, body),
  postRecut: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.postRecut(params.id, user),
  cancelRecut: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancelRecut(params.id, body.reason),
  removeRecut: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.removeRecut(params.id);
    res.status(204).end();
    return HANDLED;
  },
};

/** /api/v1/panel-dcs (type OUT / IN) and /recut-slips (A§8). */
export const panelsRouter = Router();
const c = panelsController;
const view = requirePermission('panels.view');
const create = requirePermission('panels.create');
const id = { params: zIdParam };
panelsRouter.get('/panel-dcs', view, handle({ query: zProductionListQuery }, c.list));
panelsRouter.get('/panel-dcs/pending', view, handle({ query: zVendorQ }, c.pending));
panelsRouter.get('/panel-dcs/:id', view, handle(id, c.get));
panelsRouter.get('/panel-dcs/:id/print', view, handle(id, c.get));
panelsRouter.post('/panel-dcs', create, handle({ body: zTyped }, c.create, { status: 201 }));
panelsRouter.patch('/panel-dcs/:id', create, handle({ params: zIdParam, body: zTyped }, c.update));
panelsRouter.delete('/panel-dcs/:id', create, handle(id, c.remove));
panelsRouter.post('/panel-dcs/:id/post', requirePermission('panels.post'), handle(id, c.post));
panelsRouter.post('/panel-dcs/:id/cancel', requirePermission('panels.cancel'), handle({ params: zIdParam, body: zReason }, c.cancel));
panelsRouter.post('/panel-dcs/:id/close', requirePermission('panels.close'), handle({ params: zIdParam, body: zReason }, c.close));

panelsRouter.get('/recut-slips', view, handle({ query: zProductionListQuery }, c.listRecut));
panelsRouter.get('/recut-slips/:id', view, handle(id, c.getRecut));
panelsRouter.post('/recut-slips', create, handle({ body: zRecutSlipInput }, c.createRecut, { status: 201 }));
panelsRouter.patch('/recut-slips/:id', create, handle({ params: zIdParam, body: zRecutSlipUpdate }, c.updateRecut));
panelsRouter.delete('/recut-slips/:id', create, handle(id, c.removeRecut));
panelsRouter.post('/recut-slips/:id/post', requirePermission('panels.post'), handle(id, c.postRecut));
panelsRouter.post('/recut-slips/:id/cancel', requirePermission('panels.cancel'), handle({ params: zIdParam, body: zReason }, c.cancelRecut));
