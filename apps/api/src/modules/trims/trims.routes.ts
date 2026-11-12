import { Router } from 'express';
import { z } from 'zod';
import { zBoolString, zProductionListQuery, zRef, zTrimsDocInput, zTrimsDocUpdate } from '@wewin/shared';
import { mountDocRoutes } from '../../core/doc-routes';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { trimsService as s } from './trims.service';

/**
 * /api/v1/trims-docs (?type=RECEIPT|ISSUE|RETURN|REPLACEMENT|TRANSFER) — the Accessories menu's
 * Purchase Receipt, Purchase Return, Replacement Inward, Consumption Issue and Transfer Between Order (Q-072).
 */
export const trimsRouter = Router();
const perms = { view: 'trims.view', create: 'trims.create', post: 'trims.post', cancel: 'trims.cancel' } as const;

const zPoLinesQuery = z.object({
  vendorId: zRef().optional(),
  orderId: zRef().optional(),
  poId: zRef().optional(),
  status: z.enum(['POSTED', 'CLOSED', 'CANCELLED']).optional(),
  openOnly: zBoolString.optional(),
});
trimsRouter.get('/trims-docs/po-lines', requirePermission('trims.view'), handle({ query: zPoLinesQuery }, ({ query }) => s.poLines(query)));
trimsRouter.get('/trims-docs/replaceable', requirePermission('trims.view'), handle({ query: z.object({ vendorId: zRef().optional(), returnDocId: zRef().optional() }) }, ({ query }) => s.replaceable(query)));

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
