import { z } from 'zod';
import {
  type zIdParam,
  type zInwardDcInput,
  type zInwardDcUpdate,
  type zInwardListQuery,
  type zOutwardDcInput,
  type zOutwardDcUpdate,
  type zOutwardListQuery,
  type zReason,
} from '@wewin/shared';
import { HANDLED, ListResult, type HandlerInput } from '../../core/http';
import { jobworkService as svc } from './jobwork.service';

type In<T extends object> = HandlerInput<T>;
const list = <T>(r: { rows: T[]; total: number; p: { page: number; pageSize: number } }) =>
  new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });

export const zVendorQuery = z.object({ vendorId: z.string().uuid() });
export const zRollParam = z.object({ rollNo: z.string().trim().min(1).max(60) });

export const jobworkController = {
  // Outward
  listOutward: async ({ query }: In<{ query: typeof zOutwardListQuery }>) => list(await svc.listOutward(query)),
  getOutward: ({ params }: In<{ params: typeof zIdParam }>) => svc.getOutward(params.id),
  createOutward: ({ body, user }: In<{ body: typeof zOutwardDcInput }>) => svc.createOutward(body, user),
  updateOutward: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zOutwardDcUpdate }>) => svc.updateOutward(params.id, body),
  deleteOutward: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteOutward(params.id);
    res.status(204).end();
    return HANDLED;
  },
  postOutward: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.postOutward(params.id, user),
  cancelOutward: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancelOutward(params.id, body.reason, user),
  closeOutward: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.closeOutward(params.id, body.reason, user),
  lossOf: ({ params }: In<{ params: typeof zIdParam }>) => svc.lossOf(params.id),
  pending: ({ query }: In<{ query: typeof zVendorQuery }>) => svc.pendingForVendor(query.vendorId),
  outwardMovements: ({ params }: In<{ params: typeof zIdParam }>) => svc.movements('OUT', params.id),

  // Inward
  listInward: async ({ query }: In<{ query: typeof zInwardListQuery }>) => list(await svc.listInward(query)),
  getInward: ({ params }: In<{ params: typeof zIdParam }>) => svc.getInward(params.id),
  createInward: ({ body, user }: In<{ body: typeof zInwardDcInput }>) => svc.createInward(body, user),
  updateInward: ({ params, body }: In<{ params: typeof zIdParam; body: typeof zInwardDcUpdate }>) => svc.updateInward(params.id, body),
  deleteInward: async ({ params, res }: In<{ params: typeof zIdParam }>) => {
    await svc.deleteInward(params.id);
    res.status(204).end();
    return HANDLED;
  },
  postInward: ({ params, user }: In<{ params: typeof zIdParam }>) => svc.postInward(params.id, user),
  cancelInward: ({ params, body, user }: In<{ params: typeof zIdParam; body: typeof zReason }>) => svc.cancelInward(params.id, body.reason, user),
  inwardMovements: ({ params }: In<{ params: typeof zIdParam }>) => svc.movements('IN', params.id),

  roll: ({ params }: In<{ params: typeof zRollParam }>) => svc.rollByNo(params.rollNo),
};
