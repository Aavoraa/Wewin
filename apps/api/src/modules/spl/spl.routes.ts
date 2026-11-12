import { Router } from 'express';
import { zIdParam, zProductionListQuery, zSplRequestInput, zSplRequestUpdate } from '@wewin/shared';
import { mountDocRoutes } from '../../core/doc-routes';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { splService as s } from './spl.service';

/** /api/v1/spl-requests — Accessories SPL.Request (Q-072); post = management approval. */
export const splRouter = Router();
splRouter.get('/orders/:id/accessory-balance', requirePermission('trims.view'), handle({ params: zIdParam }, ({ params }) => s.accessoryBalance(params.id)));
const svc = {
  list: (q: never) => s.list(q),
  get: (id: string) => s.get(id),
  create: (b: never, u: Parameters<typeof s.create>[1]) => s.create(b, u),
  update: (id: string, b: never) => s.update(id, b),
  remove: (id: string) => s.remove(id),
  post: (id: string, u: Parameters<typeof s.post>[1]) => s.post(id, u),
  cancel: (id: string, r: string, u: Parameters<typeof s.cancel>[2]) => s.cancel(id, r, u),
};
mountDocRoutes(splRouter, '/spl-requests', {
  perms: { view: 'trims.view', create: 'trims.create', post: 'trims.spl.approve', cancel: 'trims.spl.approve' },
  listQuery: zProductionListQuery,
  createBody: zSplRequestInput,
  updateBody: zSplRequestUpdate,
  svc,
});
