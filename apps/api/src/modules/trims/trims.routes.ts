import { Router } from 'express';
import { zProductionListQuery, zTrimsDocInput, zTrimsDocUpdate } from '@wewin/shared';
import { mountDocRoutes } from '../../core/doc-routes';
import { trimsService as s } from './trims.service';

/** /api/v1/trims-docs (?type=RECEIPT|ISSUE) — the architecture's /trims-receipts and /trims-issues as one typed document. */
export const trimsRouter = Router();
const perms = { view: 'trims.view', create: 'trims.create', post: 'trims.post', cancel: 'trims.cancel' } as const;
const svc = {
  list: (q: never) => s.list(q),
  get: (id: string) => s.get(id),
  create: (b: never, u: Parameters<typeof s.create>[1]) => s.create(b, u),
  update: (id: string, b: never) => s.update(id, b),
  remove: (id: string) => s.remove(id),
  post: (id: string, u: Parameters<typeof s.post>[1]) => s.post(id, u),
  cancel: (id: string, r: string, u: Parameters<typeof s.cancel>[2]) => s.cancel(id, r, u),
};
mountDocRoutes(trimsRouter, '/trims-docs', { perms, listQuery: zProductionListQuery, createBody: zTrimsDocInput, updateBody: zTrimsDocUpdate, svc });
