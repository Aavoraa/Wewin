import { Router } from 'express';
import { z } from 'zod';
import { zCartonInput, zCartonUpdate, zPackingListInput, zPackingListUpdate, zProductionListQuery } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { mountDocRoutes } from '../../core/doc-routes';
import { handle } from '../../core/http';
import { packingService as s } from './packing.service';

/** /api/v1/cartons and /packing-lists (A§8: post; print labels). */
export const packingRouter = Router();
const perms = { view: 'packing.view', create: 'packing.create', post: 'packing.post', cancel: 'packing.cancel' } as const;
const zCartonQuery = zProductionListQuery.extend({ unlisted: z.enum(['true', 'false']).optional() });

packingRouter.get('/cartons/by-no/:no', requirePermission('packing.view'), handle({ params: z.object({ no: z.string().min(1).max(60) }) }, ({ params }) => s.cartonByNo(params.no)));

mountDocRoutes(packingRouter, '/cartons', {
  perms,
  listQuery: zCartonQuery,
  createBody: zCartonInput,
  updateBody: zCartonUpdate,
  svc: {
    list: (q) => s.listCartons(q),
    get: (id) => s.getCarton(id),
    create: (b, u) => s.createCarton(b, u),
    update: (id, b) => s.updateCarton(id, b),
    remove: (id) => s.removeCarton(id),
    post: (id, u) => s.postCarton(id, u),
    cancel: (id, r, u) => s.cancelCarton(id, r, u),
  },
});

mountDocRoutes(packingRouter, '/packing-lists', {
  perms,
  listQuery: zProductionListQuery,
  createBody: zPackingListInput,
  updateBody: zPackingListUpdate,
  svc: {
    list: (q) => s.listPls(q),
    get: (id) => s.getPl(id),
    create: (b) => s.createPl(b),
    update: (id, b) => s.updatePl(id, b),
    remove: (id) => s.removePl(id),
    post: (id, u) => s.postPl(id, u),
    cancel: (id, r) => s.cancelPl(id, r),
  },
});
