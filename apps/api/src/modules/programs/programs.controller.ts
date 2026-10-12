import {
  type zIdParam,
  type zProgramInput,
  type zProgramListQuery,
  type zProgramUpdate,
  type zReason,
  type zTrimsBomInput,
} from '@wewin/shared';
import { HANDLED, ListResult, type HandlerInput } from '../../core/http';
import { programsService as svc } from './programs.service';

type In<T extends object> = HandlerInput<T>;

export const programsController = {
  list: async ({ query }: In<{ query: typeof zProgramListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  processes: async ({ params }: In<{ params: typeof zIdParam }>) => (await svc.get(params.id)).processes,
  create: ({ body }: In<{ body: typeof zProgramInput }>) => svc.create(body),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zProgramUpdate }>) => svc.update(params.id, body),
  approve: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.approve(params.id, user),
  cancel: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteDraft(params.id);
    res.status(204).end();
    return HANDLED;
  },
  getBom: ({ params }: In<{ params: typeof zIdParam }>) => svc.getBom(params.id),
  saveBom: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zTrimsBomInput }>) => svc.saveBom(params.id, body),
};
