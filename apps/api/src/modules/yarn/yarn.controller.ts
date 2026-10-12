import { type zDocListQuery, type zIdParam, type zReason, type zYarnReceiptInput, type zYarnReceiptUpdate } from '@wewin/shared';
import { HANDLED, ListResult, type HandlerInput } from '../../core/http';
import { yarnService as svc } from './yarn.service';

type In<T extends object> = HandlerInput<T>;

export const yarnController = {
  list: async ({ query }: In<{ query: typeof zDocListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zYarnReceiptInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zYarnReceiptUpdate }>) => svc.update(params.id, body),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteDraft(params.id);
    res.status(204).end();
    return HANDLED;
  },
  post: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.post(params.id, user),
  cancel: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason, user),
  print: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  movements: ({ params }: In<{ params: typeof zIdParam }>) => svc.movements(params.id),
};
