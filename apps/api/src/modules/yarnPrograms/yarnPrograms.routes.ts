import { Router } from 'express';
import { zIdParam, zReason, zYarnProgramInput, zYarnProgramListQuery, zYarnProgramUpdate } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle, type HandlerInput } from '../../core/http';
import { yarnProgramsService as svc } from './yarnPrograms.service';

type In<T extends object> = HandlerInput<T>;

/** Controller (thin): one service call per request. */
export const yarnProgramsController = {
  list: async ({ query }: In<{ query: typeof zYarnProgramListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body }: In<{ body: typeof zYarnProgramInput }>) => svc.create(body),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zYarnProgramUpdate }>) => svc.update(params.id, body),
  approve: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.approve(params.id, user),
  cancel: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteDraft(params.id);
    res.status(204).end();
    return HANDLED;
  },
};

/** /api/v1/yarn-programs — Program Defined on the yarn process screens (Q-074). Same permissions as fabric programmes. */
export const yarnProgramsRouter = Router();
const c = yarnProgramsController;
const view = requirePermission('programs.view');
const edit = requirePermission('programs.edit');
const approve = requirePermission('programs.approve');
yarnProgramsRouter.get('/yarn-programs', view, handle({ query: zYarnProgramListQuery }, c.list));
yarnProgramsRouter.get('/yarn-programs/:id', view, handle({ params: zIdParam }, c.get));
yarnProgramsRouter.post('/yarn-programs', edit, handle({ body: zYarnProgramInput }, c.create, { status: 201 }));
yarnProgramsRouter.patch('/yarn-programs/:id', edit, handle({ params: zIdParam, body: zYarnProgramUpdate }, c.update));
yarnProgramsRouter.delete('/yarn-programs/:id', edit, handle({ params: zIdParam }, c.remove));
yarnProgramsRouter.post('/yarn-programs/:id/approve', approve, handle({ params: zIdParam }, c.approve));
yarnProgramsRouter.post('/yarn-programs/:id/cancel', approve, handle({ params: zIdParam, body: zReason }, c.cancel));
