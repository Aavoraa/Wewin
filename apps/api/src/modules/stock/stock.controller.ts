import { ListResult, type HandlerInput } from '../../core/http';
import { stockService } from './stock.service';
import { type zBalanceQuery, type zMovementQuery } from './stock.schemas';

export const stockController = {
  async balances({ query }: HandlerInput<{ query: typeof zBalanceQuery }>) {
    const { page, pageSize, ...f } = query;
    const r = await stockService.balances({ ...f, skip: (page - 1) * pageSize, take: pageSize });
    return new ListResult(r.rows, { page, pageSize, total: r.total });
  },

  async atVendors({ query }: HandlerInput<{ query: typeof zBalanceQuery }>) {
    const { page, pageSize, locationKind: _k, live: _l, ...f } = query;
    const r = await stockService.atVendors({ ...f, skip: (page - 1) * pageSize, take: pageSize });
    return new ListResult(r.rows, { page, pageSize, total: r.total });
  },

  async movements({ query }: HandlerInput<{ query: typeof zMovementQuery }>) {
    const { page, pageSize, ...f } = query;
    const r = await stockService.movements({ ...f, skip: (page - 1) * pageSize, take: pageSize });
    return new ListResult(r.rows, { page, pageSize, total: r.total });
  },

  refresh() {
    return stockService.refreshCache();
  },
};
