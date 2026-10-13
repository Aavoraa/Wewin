import { Router } from 'express';
import {
  zAccountsListQuery,
  zAgeingQuery,
  zApprove,
  zBillInput,
  zBillListQuery,
  zBillMatchQuery,
  zBillUpdate,
  zDebitNoteInput,
  zDebitNoteUpdate,
  zIdParam,
  zItc04Query,
  zLedgerQuery,
  zPaymentInput,
  zPaymentSuggestQuery,
  zPaymentUpdate,
  zPendingDcQuery,
  zRateContractInput,
  zRateContractUpdate,
  zRateListQuery,
} from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, ListResult, handle } from '../../core/http';
import { mountDocRoutes } from '../../core/doc-routes';
import { sendWorkbook } from '../../core/excel';
import { ratesService } from './rates.service';
import { billsService } from './bills.service';
import { debitNotesService } from './debitnotes.service';
import { paymentsService } from './payments.service';
import { statementsService } from './statements.service';
// Registers the close-after-billing hooks on outward / panel D.C.s (Q-012).
import './debits.service';

/** /api/v1 accounts endpoints (A§8): rate contracts, vendor bills (+ match, approve), debit notes, payments, ledgers, ageing. */
export const accountsRouter = Router();
const view = requirePermission('accounts.view');
const id = { params: zIdParam };
const all = <T>(rows: T[]) => new ListResult(rows, { page: 1, pageSize: rows.length, total: rows.length });

// ───────── Rate contracts ─────────
const rates = requirePermission('masters.rates.edit');
accountsRouter.get('/rate-contracts', view, handle({ query: zRateListQuery }, async ({ query }) => {
  const r = await ratesService.list(query);
  return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
}));
accountsRouter.get('/rate-contracts/:id', view, handle(id, ({ params }) => ratesService.get(params.id)));
accountsRouter.post('/rate-contracts', rates, handle({ body: zRateContractInput }, ({ body }) => ratesService.create(body), { status: 201 }));
accountsRouter.patch('/rate-contracts/:id', rates, handle({ params: zIdParam, body: zRateContractUpdate }, ({ params, body }) => ratesService.update(params.id, body)));
accountsRouter.post('/rate-contracts/:id/activate', rates, handle(id, ({ params }) => ratesService.setActive(params.id, true)));
accountsRouter.post('/rate-contracts/:id/deactivate', rates, handle(id, ({ params }) => ratesService.setActive(params.id, false)));

// ───────── Vendor bills ─────────
const billCreate = requirePermission('accounts.bill.create');
accountsRouter.get('/vendor-bills/match', billCreate, handle({ query: zBillMatchQuery }, async ({ query }) => all(await billsService.candidates(query.vendorId, query.orderId ?? null))));
accountsRouter.post('/vendor-bills/preview', billCreate, handle({ body: zBillInput }, ({ body }) => billsService.preview(body)));
accountsRouter.post('/vendor-bills/:id/approve', requirePermission('accounts.bill.approve'), handle({ params: zIdParam, body: zApprove }, ({ params, body, user }) => billsService.approve(params.id, body.note, user)));
mountDocRoutes(accountsRouter, '/vendor-bills', {
  perms: { view: 'accounts.view', create: 'accounts.bill.create', post: 'accounts.bill.post', cancel: 'accounts.bill.cancel' },
  listQuery: zBillListQuery,
  createBody: zBillInput,
  updateBody: zBillUpdate,
  svc: {
    list: (q: never) => billsService.list(q),
    get: (i) => billsService.get(i),
    create: (b, u) => billsService.create(b, u),
    update: (i, b) => billsService.update(i, b),
    remove: (i) => billsService.remove(i),
    post: (i, u) => billsService.post(i, u),
    cancel: (i, r, u) => billsService.cancel(i, r, u),
  },
});

// ───────── Debit notes ─────────
mountDocRoutes(accountsRouter, '/debit-notes', {
  perms: { view: 'accounts.view', create: 'accounts.debitnote.create', post: 'accounts.debitnote.post', cancel: 'accounts.debitnote.cancel' },
  listQuery: zAccountsListQuery,
  createBody: zDebitNoteInput,
  updateBody: zDebitNoteUpdate,
  svc: {
    list: (q: never) => debitNotesService.list(q),
    get: (i) => debitNotesService.get(i),
    create: (b) => debitNotesService.create(b),
    update: (i, b) => debitNotesService.update(i, b),
    remove: (i) => debitNotesService.remove(i),
    post: (i, u) => debitNotesService.post(i, u),
    cancel: (i, r, u) => debitNotesService.cancel(i, r, u),
  },
});

// ───────── Payments ─────────
accountsRouter.get('/payments/suggest', requirePermission('accounts.payment.create'), handle({ query: zPaymentSuggestQuery }, ({ query }) =>
  paymentsService.suggest(query.vendorId, query.amount, query.tdsAmount, query.useAdvance),
));
mountDocRoutes(accountsRouter, '/payments', {
  perms: { view: 'accounts.view', create: 'accounts.payment.create', post: 'accounts.payment.post', cancel: 'accounts.payment.cancel' },
  listQuery: zAccountsListQuery,
  createBody: zPaymentInput,
  updateBody: zPaymentUpdate,
  svc: {
    list: (q: never) => paymentsService.list(q),
    get: (i) => paymentsService.get(i),
    create: (b, u) => paymentsService.create(b, u),
    update: (i, b) => paymentsService.update(i, b),
    remove: (i) => paymentsService.remove(i),
    post: (i, u) => paymentsService.post(i, u),
    cancel: (i, r, u) => paymentsService.cancel(i, r, u),
  },
});

// ───────── Ledgers & reports ─────────
accountsRouter.get('/vendors/:id/open-bills', view, handle(id, async ({ params }) => all(await billsService.openBills(params.id))));
accountsRouter.get('/vendors/:id/ledger', view, handle({ params: zIdParam, query: zLedgerQuery }, async ({ params, query, req }) => {
  const l = await statementsService.vendorLedger(params.id, query.from, query.to);
  // ?format=xlsx exports the entries through the generic register export.
  return req.query.format === 'xlsx' ? all(l.entries) : l;
}));
accountsRouter.get('/reports/ageing', view, handle({ query: zAgeingQuery }, async ({ query, req }) => {
  const a = await statementsService.ageing(query);
  return req.query.format === 'xlsx' ? all(a.rows) : a;
}));
accountsRouter.get('/reports/pending-dcs', requirePermission('jobwork.view'), handle({ query: zPendingDcQuery }, async ({ query, req }) => {
  const r = await statementsService.pendingDcs(query);
  return req.query.format === 'xlsx' ? all(r.rows) : r;
}));
accountsRouter.get('/reports/itc-04', requirePermission('accounts.view', 'reports.export'), handle({ query: zItc04Query }, async ({ query, res }) => {
  const wb = await statementsService.itc04Workbook(query.from, query.to);
  await sendWorkbook(res, `ITC-04-draft-${query.from}-to-${query.to}.xlsx`, wb);
  return HANDLED;
}));
