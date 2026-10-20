import { describe, expect, it } from 'vitest';
import { groupOpeningOrders, groupVendorStock, parseOpeningDate, zOpeningBalanceRow, zOpeningOrderRow } from './opening';

describe('opening import helpers', () => {
  it('reads ISO, Indian DD-MM-YYYY / DD/MM/YYYY and Excel date cells; rejects impossible dates', () => {
    expect(parseOpeningDate('2026-08-01')).toBe('2026-08-01');
    expect(parseOpeningDate('1-8-2026')).toBe('2026-08-01');
    expect(parseOpeningDate('01/08/2026')).toBe('2026-08-01');
    expect(parseOpeningDate(new Date('2026-08-01T00:00:00Z'))).toBe('2026-08-01');
    expect(parseOpeningDate('31-02-2026')).toBeNull();
    expect(parseOpeningDate('08/01/26')).toBeNull();
    expect(parseOpeningDate('')).toBeNull();
  });

  it('row schemas normalise codes, amounts with commas and optional cells', () => {
    const r = zOpeningBalanceRow.parse({ vendorCode: ' kts ', refNo: 'A/1', billDate: '30-08-2026', dueDate: '', amount: '48,250', remarks: '' });
    expect(r).toEqual({ vendorCode: 'KTS', refNo: 'A/1', billDate: '2026-08-30', dueDate: null, amount: '48250.00', remarks: null });
    expect(zOpeningBalanceRow.safeParse({ vendorCode: 'K', refNo: 'A', billDate: '2026-08-30', dueDate: '', amount: '0', remarks: '' }).success).toBe(false);
  });

  it('groups colour × size rows into orders and reports disagreeing headers, duplicate cells and missing components', () => {
    const base = zOpeningOrderRow.parse({ orderNo: 'w1', buyerCode: 'b', buyerPoNo: 'P', poDate: '2026-08-01', shipDate: '', styleNo: 'S', styleName: '', garmentItemCode: 'g', currency: 'eur', colour: 'NAVY', size: 'S', qty: '10', unitPrice: '', remarks: '' });
    const rows = [
      { ...base, row: 2 },
      { ...base, size: 'M', qty: '20', row: 3 },
      { ...base, size: 'M', row: 4 },
      { ...base, buyerPoNo: 'OTHER', size: 'L', row: 5 },
      { ...base, orderNo: 'W2', row: 6 },
    ];
    const g = groupOpeningOrders(rows, [{ orderNo: 'W1', code: 'FRONT', name: 'Front', panelItemCode: 'P1', pcsPerGarment: '1', row: 2 }, { orderNo: 'W9', code: 'X', name: 'X', panelItemCode: 'P', pcsPerGarment: '1', row: 3 }]);
    expect(g.orders.map((o) => [o.orderNo, o.colours, o.sizes, o.lines.length])).toEqual([
      ['W1', ['NAVY'], ['S', 'M', 'L'], 4],
      ['W2', ['NAVY'], ['S'], 1],
    ]);
    expect(g.errors.map((e) => `${e.sheet}:${e.row}:${e.message}`)).toEqual([
      'Orders:4:NAVY / M appears twice for order W1',
      'Orders:5:Differs from row 2 of order W1',
      'Components:3:Order W9 is not on the Orders sheet',
      'Orders:6:Order W2 has no rows on the Components sheet',
    ]);
  });

  it('groups vendor stock into one D.C. per vendor / order / process / sent date', () => {
    const r = (vendorCode: string, sentDate: string, row: number) => ({ vendorCode, orderNo: 'O', processCode: 'KNIT', sentDate, row });
    expect(groupVendorStock([r('A', '2026-09-01', 2), r('A', '2026-09-01', 3), r('A', '2026-09-02', 4), r('B', '2026-09-01', 5)]).map((g) => g.map((x) => x.row))).toEqual([[2, 3], [4], [5]]);
  });
});
