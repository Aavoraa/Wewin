import { z } from 'zod';
import { type zCostingInput, type zIdParam, type zOrderInput, type zOrderListQuery, type zOrderUpdate, type zReason } from '@wewin/shared';
import { HANDLED, ListResult, type HandlerInput } from '../../core/http';
import { ordersService as svc } from './orders.service';

export const zSearch = z.object({ q: z.string().trim().min(1).max(40) });

type In<T extends object> = HandlerInput<T>;

/** Controller: maps validated requests to one service call each. */
export const ordersController = {
  list: async ({ query }: In<{ query: typeof zOrderListQuery }>) => {
    const r = await svc.list(query);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  },
  get: ({ params }: In<{ params: typeof zIdParam }>) => svc.get(params.id),
  create: ({ body, user }: In<{ body: typeof zOrderInput }>) => svc.create(body, user),
  update: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zOrderUpdate }>) => svc.update(params.id, body),
  lines: async ({ params }: In<{ params: typeof zIdParam }>) => {
    const o = await svc.get(params.id);
    return { colours: o.colours, sizes: o.sizes, lines: o.lines, totals: o.totals };
  },
  confirm: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.confirm(params.id, user),
  close: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.close(params.id, body.reason),
  cancel: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancel(params.id, body.reason),
  remove: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteDraft(params.id);
    res.status(204).end();
    return HANDLED;
  },
  getCosting: ({ params }: In<{ params: typeof zIdParam }>) => svc.getCosting(params.id),
  saveCosting: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zCostingInput }>) => svc.saveCosting(params.id, body, user),
  search: ({ query }: In<{ query: typeof zSearch }>) => svc.search(query.q),
};


