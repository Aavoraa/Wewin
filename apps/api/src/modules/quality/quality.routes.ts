import { Router } from 'express';
import { z } from 'zod';
import { zApprove, zIdParam, zQcInput, zQcListQuery, zQcUpdate, zReason, zRef } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { packingService } from '../packing/packing.service';
import { qualityService as svc } from './quality.service';

type In<T extends object> = HandlerInput<T>;
const zRollIds = z.object({ ids: z.union([zRef(), z.array(zRef())]).transform((v) => (Array.isArray(v) ? v : [v])) });
const zSummary = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Controller (thin): one service call per request. */
export const qualityController = {
  list: async ({ query }: In<{ query: typeof zQcListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zQcInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zQcUpdate }>) => svc.update(params.id, body),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  },
  approve: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zApprove }>) => svc.approve(params.id, body.note, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user, packingService.packedByCell),
  rollStatus: ({ query }: In<{ query: typeof zRollIds }>) => svc.rollStatus(query.ids),
  summary: ({ query }: In<{ query: typeof zSummary }>) => svc.summary(query.days),
  config: () => svc.config(),
};

/** /api/v1/qc — quality checks: fabric roll inspection, inline sewing checks, final inspection (Q-063). */
export const qualityRouter = Router();
const c = qualityController;
const view = requirePermission('qc.view');
const create = requirePermission('qc.create');
qualityRouter.get('/qc', view, handle({ query: zQcListQuery }, c.list));
qualityRouter.get('/qc/config', view, handle({}, c.config));
qualityRouter.get('/qc/summary', view, handle({ query: zSummary }, c.summary));
qualityRouter.get('/qc/roll-status', requirePermission('stock.view'), handle({ query: zRollIds }, c.rollStatus));
qualityRouter.get('/qc/:id', view, handle({ params: zIdParam }, c.get));
qualityRouter.post('/qc', create, handle({ body: zQcInput }, c.create, { status: 201 }));
qualityRouter.patch('/qc/:id', create, handle({ params: zIdParam, body: zQcUpdate }, c.update));
qualityRouter.delete('/qc/:id', create, handle({ params: zIdParam }, c.remove));
qualityRouter.post('/qc/:id/approve', requirePermission('qc.approve'), handle({ params: zIdParam, body: zApprove }, c.approve));
qualityRouter.post('/qc/:id/cancel', requirePermission('qc.cancel'), handle({ params: zIdParam, body: zReason }, c.cancel));
