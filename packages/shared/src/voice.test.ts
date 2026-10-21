import { describe, expect, it } from 'vitest';
import { localNavigate, resolveByName, zVoiceInterpret } from './voice';

const vendors = [
  { id: 'v1', code: 'DYE-NCP', name: 'Noyyal Colour Processors' },
  { id: 'v2', code: 'DYE-SVD', name: 'Sri Vinayaga Dyeing' },
  { id: 'v3', code: 'KNT-SMK', name: 'Sri Murugan Knitting' },
  { id: 'v4', code: 'KNT-AVK', name: 'Annai Velankanni Knits' },
];

describe('resolveByName', () => {
  it('matches a spoken code, an exact name, or a clearly best name', () => {
    expect(resolveByName('dye ncp', vendors).id).toBe('v1');
    expect(resolveByName('Noyyal Colour Processors Pvt Ltd', vendors).id).toBe('v1');
    expect(resolveByName('noyal colour', vendors).id).toBe('v1');
    expect(resolveByName('annai velankanni', vendors)).toMatchObject({ id: 'v4', label: 'Annai Velankanni Knits' });
  });
  it('never guesses between close names; returns candidates instead', () => {
    const r = resolveByName('Sri', vendors);
    expect(r.id).toBeNull();
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['v2', 'v3']);
    expect(resolveByName('Tata Steel', vendors)).toMatchObject({ id: null, candidates: [] });
    expect(resolveByName('', vendors).id).toBeNull();
  });
});

describe('localNavigate (no AI)', () => {
  const screens = [
    { label: 'Packing lists', to: '/packing-lists' },
    { label: 'Yarn receipts', to: '/yarn-receipts' },
    { label: 'Vendor bills', to: '/vendor-bills' },
    { label: 'Reports', to: '/reports' },
  ];
  it('opens a screen by name and a new document with "new"', () => {
    expect(localNavigate('open packing lists', screens)).toEqual(screens[0]);
    expect(localNavigate('go to vendor bill', screens)).toEqual(screens[2]);
    expect(localNavigate('new yarn receipt', screens)).toEqual({ to: '/yarn-receipts/new', label: 'New yarn receipt' });
    expect(localNavigate('new report', screens)).toEqual(screens[3]);
  });
  it('returns nothing for requests it cannot map', () => {
    expect(localNavigate('how much yarn is in stock', screens)).toBeNull();
    expect(localNavigate('open', screens)).toBeNull();
  });
});

describe('request schema', () => {
  it('limits transcript length and screen paths', () => {
    expect(zVoiceInterpret.safeParse({ transcript: 'x'.repeat(601) }).success).toBe(false);
    expect(zVoiceInterpret.safeParse({ transcript: 'open bills', screens: [{ label: 'Evil', to: 'https://x.test' }] }).success).toBe(false);
    expect(zVoiceInterpret.parse({ transcript: ' open bills ' })).toMatchObject({ transcript: 'open bills', screens: [] });
  });
});
