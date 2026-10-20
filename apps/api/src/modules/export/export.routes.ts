import { Router } from 'express';
import { z } from 'zod';
import { zBoolString, zBuyerReceiptInput, zBuyerReceiptUpdate, zExportInvoiceInput, zExportInvoicePreview, zExportInvoiceUpdate, zExportListQuery, zIdParam, zMoney, zRef, zShipmentInput, zShipmentUpdate } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { ListResult, handle } from '../../core/http';
import { mountDocRoutes } from '../../core/doc-routes';
import { invoicesService } from './invoices.service';
import { shipmentsService } from './shipments.service';
import { receiptsService } from './receipts.service';

/** /api/v1/export-invoices, /shipments, /buyer-receipts (A§8) and the export receivables report. */
export const exportRouter = Router();
const view = requirePermission('export.view');
const create = requirePermission('export.create');
const perms = { view: 'export.view', create: 'export.create', post: 'export.post', cancel: 'export.cancel' } as const;
const buyerQuery = z.object({ buyerId: zRef() });
const all = <T>(rows: T[]) => new ListResult(rows, { page: 1, pageSize: rows.length, total: rows.length });

exportRouter.get('/export-invoices/candidates', create, handle({ query: buyerQuery }, async ({ query }) => all(await invoicesService.candidates(query.buyerId))));
exportRouter.post('/export-invoices/preview', create, handle({ body: zExportInvoicePreview }, ({ body }) => invoicesService.preview(body)));
exportRouter.get('/export-invoices/:id/movements', requirePermission('export.view', 'stock.view'), handle({ params: zIdParam }, ({ params }) => invoicesService.movements(params.id)));
mountDocRoutes(exportRouter, '/export-invoices', {
  perms,
  listQuery: zExportListQuery,
  createBody: zExportInvoiceInput,
  updateBody: zExportInvoiceUpdate,
  svc: {
    list: (q: never) => invoicesService.list(q),
    get: (i) => invoicesService.get(i),
    create: (b, u) => invoicesService.create(b, u),
    update: (i, b) => invoicesService.update(i, b),
    remove: (i) => invoicesService.remove(i),
    post: (i, u) => invoicesService.post(i, u),
    cancel: (i, r, u) => invoicesService.cancel(i, r, u),
  },
});

exportRouter.get('/shipments/candidates', create, handle({ query: buyerQuery }, async ({ query }) => all(await shipmentsService.candidates(query.buyerId))));
mountDocRoutes(exportRouter, '/shipments', {
  perms,
  listQuery: zExportListQuery,
  createBody: zShipmentInput,
  updateBody: zShipmentUpdate,
  svc: {
    list: (q: never) => shipmentsService.list(q),
    get: (i) => shipmentsService.get(i),
    create: (b, u) => shipmentsService.create(b, u),
    update: (i, b) => shipmentsService.update(i, b),
    remove: (i) => shipmentsService.remove(i),
    post: (i, u) => shipmentsService.post(i, u),
    cancel: (i, r, u) => shipmentsService.cancel(i, r, u),
  },
});

exportRouter.get(
  '/buyer-receipts/suggest',
  create,
  handle({ query: z.object({ buyerId: zRef(), currency: z.string().regex(/^[A-Z]{3}$/), amountFc: zMoney().default('0'), bankChargesFc: zMoney().default('0') }) }, ({ query }) =>
    receiptsService.suggest(query.buyerId, query.currency, query.amountFc, query.bankChargesFc),
  ),
);
mountDocRoutes(exportRouter, '/buyer-receipts', {
  perms,
  listQuery: zExportListQuery,
  createBody: zBuyerReceiptInput,
  updateBody: zBuyerReceiptUpdate,
  svc: {
    list: (q: never) => receiptsService.list(q),
    get: (i) => receiptsService.get(i),
    create: (b, u) => receiptsService.create(b, u),
    update: (i, b) => receiptsService.update(i, b),
    remove: (i) => receiptsService.remove(i),
    post: (i, u) => receiptsService.post(i, u),
    cancel: (i, r, u) => receiptsService.cancel(i, r, u),
  },
});

exportRouter.get('/reports/export-receivables', view, handle({ query: z.object({ buyerId: zRef().optional(), format: z.string().optional(), all: zBoolString.optional() }) }, async ({ query, req }) => {
  const r = await receiptsService.receivables({ buyerId: query.buyerId });
  return req.query.format === 'xlsx' ? all(r.rows) : r;
}));
