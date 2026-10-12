import { beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTx } from '../db';
import { numbering } from './numbering.service';
import { uid } from '../../../test/helpers';

// Unique series per run (the test database is persistent).
const S = { SEQ: uid('SEQ'), PAR: uid('PAR'), RB: uid('RB'), FY: uid('FY') };
const P = { SEQ: uid('Q').slice(2, 8), PAR: uid('P').slice(2, 8), RB: uid('R').slice(2, 8), FY: uid('F').slice(2, 8) };

async function fresh(code: string, prefix: string) {
  await prisma.documentSeries.create({ data: { code, name: code, prefix, padding: 4 } });
}

describe('numbering.next', () => {
  beforeAll(async () => {
    await fresh(S.SEQ, P.SEQ);
    await fresh(S.PAR, P.PAR);
    await fresh(S.RB, P.RB);
    await fresh(S.FY, P.FY);
  });

  it('issues sequential numbers per series and FY', async () => {
    const a = await withTx((tx) => numbering.next(S.SEQ as never, '2026-10-12', tx));
    const b = await withTx((tx) => numbering.next(S.SEQ as never, '2026-11-01', tx));
    expect(a.docNo).toBe(`${P.SEQ}/26-27/0001`);
    expect(b.docNo).toBe(`${P.SEQ}/26-27/0002`);
  });

  it('resets per financial year', async () => {
    const a = await withTx((tx) => numbering.next(S.FY as never, '2027-03-31', tx));
    const b = await withTx((tx) => numbering.next(S.FY as never, '2027-04-01', tx));
    const c = await withTx((tx) => numbering.next(S.FY as never, '2027-04-02', tx));
    expect([a.docNo, b.docNo, c.docNo]).toEqual([`${P.FY}/26-27/0001`, `${P.FY}/27-28/0001`, `${P.FY}/27-28/0002`]);
  });

  it('is gap-free: a rolled-back posting does not consume a number', async () => {
    await withTx((tx) => numbering.next(S.RB as never, '2026-10-12', tx));
    await expect(
      withTx(async (tx) => {
        await numbering.next(S.RB as never, '2026-10-12', tx);
        throw new Error('posting failed');
      }),
    ).rejects.toThrow('posting failed');
    const n = await withTx((tx) => numbering.next(S.RB as never, '2026-10-12', tx));
    expect(n.docNo).toBe(`${P.RB}/26-27/0002`);
  });

  it('never hands the same number to concurrent postings', async () => {
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, () => withTx((tx) => numbering.next(S.PAR as never, '2026-10-12', tx), { retries: 10 })),
    );
    const seqs = results.map((r) => r.seq).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(N);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('fails clearly for an unknown or inactive series', async () => {
    await expect(withTx((tx) => numbering.next('NOPE' as never, '2026-10-12', tx))).rejects.toMatchObject({
      code: 'SERIES_NOT_CONFIGURED',
    });
  });
});
