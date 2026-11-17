import { describe, expect, it } from 'vitest';
import { NAV, navFor } from './nav';

const labels = (m: Parameters<typeof navFor>[0]) => navFor(m).map((g) => g.label);

describe('module choice at login (Q-088)', () => {
  it('All modules shows every menu', () => {
    expect(navFor('ALL')).toHaveLength(NAV.length);
  });
  it('each module keeps the shared menus and its own', () => {
    for (const m of ['ORDER_PLANNING', 'YARN_TO_FABRIC', 'PRODUCTION'] as const) {
      expect(labels(m)).toEqual(expect.arrayContaining(['Overview', 'Masters', 'Settings']));
    }
    expect(labels('ORDER_PLANNING')).toEqual(expect.arrayContaining(['Orders', 'Export']));
    expect(labels('ORDER_PLANNING')).not.toContain('Bills Entry');
    expect(labels('YARN_TO_FABRIC')).toEqual(expect.arrayContaining(['Transaction', 'Job work', 'Bills Entry', 'Accounts', 'Stores']));
    expect(labels('YARN_TO_FABRIC')).not.toContain('Production');
    expect(labels('PRODUCTION')).toEqual(expect.arrayContaining(['Production', 'Accessories', 'Stores']));
    expect(labels('PRODUCTION')).not.toContain('Transaction');
  });
  it('every menu is reachable from some module', () => {
    const reached = new Set((['ORDER_PLANNING', 'YARN_TO_FABRIC', 'PRODUCTION'] as const).flatMap(labels));
    expect(NAV.map((g) => g.label).filter((l) => !reached.has(l))).toEqual([]);
  });
});
