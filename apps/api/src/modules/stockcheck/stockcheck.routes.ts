import { Router } from 'express';
import {
  zDisposalInput,
  zDisposalListQuery,
  zDisposalUpdate,
  zIdParam,
  zStockCountInput,
  zStockCountListQuery,
  zStockCountSheetQuery,
  zStockCountUpdate,
} from '@wewin/shared';
import { mountDocRoutes } from '../../core/doc-routes';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { stockCountService as counts } from './stockcount.service';
import { disposalService as disposals } from './disposal.service';

/**
 * /api/v1/stock-counts — physical stock check; /api/v1/stock-disposals — leftover order stock
 * disposed after dispatch (Q-080). Post = management approval.
 */
export const stockCheckRouter = Router();
stockCheckRouter.get(
  '/stock-counts/sheet',
  requirePermission('stock.view'),
  handle({ query: zStockCountSheetQuery }, ({ query }) => counts.sheet(query)),
);
stockCheckRouter.get(
  '/orders/:id/leftover-stock',
  requirePermission('stock.view'),
  handle({ params: zIdParam }, ({ params }) => disposals.leftovers(params.id)),
);

mountDocRoutes(stockCheckRouter, '/stock-counts', {
  perms: {
    view: 'stock.view',
    create: 'stock.count.create',
    post: 'stock.count.approve',
    cancel: 'stock.count.approve',
  },
  listQuery: zStockCountListQuery,
  createBody: zStockCountInput,
  updateBody: zStockCountUpdate,
  svc: {
    list: (q: never) => counts.list(q),
    get: (id) => counts.get(id),
    create: (b, u) => counts.create(b, u),
    update: (id, b) => counts.update(id, b),
    remove: (id) => counts.remove(id),
    post: (id, u) => counts.post(id, u),
    cancel: (id, r, u) => counts.cancel(id, r, u),
  },
});

mountDocRoutes(stockCheckRouter, '/stock-disposals', {
  perms: {
    view: 'stock.view',
    create: 'stock.dispose.create',
    post: 'stock.dispose.approve',
    cancel: 'stock.dispose.approve',
  },
  listQuery: zDisposalListQuery,
  createBody: zDisposalInput,
  updateBody: zDisposalUpdate,
  svc: {
    list: (q: never) => disposals.list(q),
    get: (id) => disposals.get(id),
    create: (b, u) => disposals.create(b, u),
    update: (id, b) => disposals.update(id, b),
    remove: (id) => disposals.remove(id),
    post: (id, u) => disposals.post(id, u),
    cancel: (id, r, u) => disposals.cancel(id, r, u),
  },
});
