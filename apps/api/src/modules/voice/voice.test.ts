import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env';
import { prisma } from '../../core/db';
import { type Client, asUser, uid } from '../../../test/helpers';
import { type Masters, masters } from '../../../test/fixtures';
import { type AiVoice, interpretWithAi } from './voice.ai';
import { setVoiceInterpreter } from './voice.service';

let owner: Client;
let m: Masters;
let next: Partial<AiVoice> = {};
const ok = (r: { status: number; body: unknown }, s = 200) => expect(r.status, JSON.stringify(r.body)).toBe(s);
const blank: AiVoice = { intent: 'unknown', screen_path: '', report_key: '', report_params: [], search_text: '', fields: [], lines: [], reply: '' };
const screens = [
  { label: 'Packing lists', to: '/packing-lists' },
  { label: 'Yarn receipts', to: '/yarn-receipts' },
];
const yarnForm = {
  title: 'Yarn receipt',
  fields: [
    { name: 'docDate', label: 'Receipt date', type: 'date' },
    { name: 'vendorId', label: 'Mill', type: 'vendor' },
    { name: 'supplierInvoiceNo', label: 'Invoice no.', type: 'text' },
  ],
  lines: { label: 'Lots', fields: [{ name: 'itemId', label: 'Yarn', type: 'item', itemType: 'YARN' }, { name: 'lot', label: 'Lot', type: 'text' }, { name: 'qtyKg', label: 'Kg', type: 'number' }] },
};
const say = (c: Client, transcript: string, extra: object = {}) => c.post('/api/v1/voice/interpret', { transcript, screens, ...extra });

beforeAll(async () => {
  owner = await asUser('OWNER');
  m = await masters();
  setVoiceInterpreter(async () => ({ ...blank, ...next }));
});
afterAll(() => {
  setVoiceInterpreter(interpretWithAi);
  env.VOICE_AI_PROVIDER = '';
});

describe('voice without AI', () => {
  it('reports its configuration and opens screens by name', async () => {
    const c = await owner.get('/api/v1/voice/config');
    ok(c);
    expect(c.body.data).toEqual({ enabled: true, language: 'en-IN', ai: false });
    const r = await say(owner, 'open packing lists');
    ok(r);
    expect(r.body.data).toMatchObject({ kind: 'navigate', to: '/packing-lists' });
    expect((await say(owner, 'new yarn receipt')).body.data).toMatchObject({ kind: 'navigate', to: '/yarn-receipts/new' });
    expect((await say(owner, 'how much yarn do we have')).body.data.kind).toBe('unknown');
  });
});

describe('voice with AI (interpreter stubbed)', () => {
  beforeAll(() => {
    env.VOICE_AI_PROVIDER = 'anthropic';
  });

  it('navigates only to screens the page offered', async () => {
    next = { intent: 'navigate', screen_path: '/yarn-receipts/new' };
    expect((await say(owner, 'start a new yarn receipt')).body.data).toMatchObject({ kind: 'navigate', to: '/yarn-receipts/new', label: 'New yarn receipt' });
    next = { intent: 'navigate', screen_path: '/settings', reply: '' };
    expect((await say(owner, 'open settings')).body.data.kind).toBe('unknown');
  });

  it('answers an enquiry from a report the user may run, narrowed by what was said', async () => {
    const lot = uid('VL');
    const yr = await owner.post('/api/v1/yarn-receipts', { docDate: '2026-10-01', vendorId: m.vendors.mill.id, lines: [{ itemId: m.items.yarn.id, lot, qtyKg: '432.5' }] });
    ok(yr, 201);
    ok(await owner.post(`/api/v1/yarn-receipts/${yr.body.data.id}/post`));
    next = { intent: 'enquiry', report_key: 'stock-balances', report_params: [{ name: 'locationKind', value: 'OWN' }], search_text: lot };
    const r = await say(owner, `how much of lot ${lot} is in stock`);
    ok(r);
    expect(r.body.data).toMatchObject({ kind: 'answer', total: 1, report: { key: 'stock-balances', params: { locationKind: 'OWN' } } });
    expect(r.body.data.rows[0]).toMatchObject({ lot, qty: '432.500' });
    expect(r.body.data.message).toContain('Quantity 432.500');
    // A user without stock access cannot be answered from the stock report.
    const merch = await asUser(['orders.view', 'reports.view']);
    expect((await say(merch, 'stock of yarn')).body.data.kind).toBe('unknown');
  });

  it('resolves the vendor in an enquiry by name, or says it could not', async () => {
    next = { intent: 'enquiry', report_key: 'pending-dcs', report_params: [{ name: 'vendorId', value: 'test knitter two' }] };
    const r = await say(owner, 'pending dcs at test knitter two');
    ok(r);
    expect(r.body.data.report.params.vendorId ?? null).not.toBe(m.vendors.knitter.id);
  });

  it('fills a form: dates, numbers, masters by name, several lines; problems are listed, nothing is saved', async () => {
    const before = await prisma.yarnReceipt.count();
    next = {
      intent: 'fill',
      fields: [{ name: 'docDate', value: '2026-10-21' }, { name: 'vendorId', value: m.vendors.mill.code }, { name: 'supplierInvoiceNo', value: 'KSM/0901' }],
      lines: [
        { cells: [{ name: 'itemId', value: m.items.yarn.code }, { name: 'lot', value: 'KSM-1' }, { name: 'qtyKg', value: '1,000' }] },
        { cells: [{ name: 'itemId', value: 'unobtainium yarn' }, { name: 'lot', value: 'KSM-2' }, { name: 'qtyKg', value: 'five hundred' }] },
      ],
    };
    const r = await say(owner, 'mill test mill invoice KSM 0901 two lots', { form: yarnForm });
    ok(r);
    const d = r.body.data;
    expect(d.kind).toBe('fill');
    expect(d.fields.docDate).toBe('2026-10-21');
    expect(d.fields.vendorId).toMatchObject({ id: m.vendors.mill.id });
    expect(d.lines[0]).toMatchObject({ itemId: { id: m.items.yarn.id }, lot: 'KSM-1', qtyKg: '1000' });
    expect(d.lines[1].itemId.id).toBeNull();
    expect(d.problems).toEqual(expect.arrayContaining([expect.stringMatching(/Line 2 yarn: "unobtainium yarn"/), expect.stringMatching(/Line 2 kg: "five hundred" is not a number/)]));
    expect(await prisma.yarnReceipt.count()).toBe(before);
  });

  it('is refused when switched off in settings', async () => {
    await prisma.appSetting.upsert({ where: { key: 'voice.enabled' }, create: { key: 'voice.enabled', value: false }, update: { value: false } });
    try {
      expect((await say(owner, 'open packing lists')).status).toBe(409);
    } finally {
      await prisma.appSetting.delete({ where: { key: 'voice.enabled' } });
    }
  });
});
