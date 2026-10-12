import { Router } from 'express';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { stockController } from './stock.controller';
import { zBalanceQuery, zMovementQuery } from './stock.schemas';

/** /api/v1/stock — read-only views over the single stock ledger. */
export const stockRouter = Router();
stockRouter.get('/stock/balances', requirePermission('stock.view'), handle({ query: zBalanceQuery }, stockController.balances));
stockRouter.get('/stock/at-vendors', requirePermission('stock.view'), handle({ query: zBalanceQuery }, stockController.atVendors));
stockRouter.get('/stock/movements', requirePermission('stock.view'), handle({ query: zMovementQuery }, stockController.movements));
stockRouter.post('/stock/refresh', requirePermission('stock.view'), handle({}, stockController.refresh));
