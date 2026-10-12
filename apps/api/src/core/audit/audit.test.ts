import { describe, expect, it } from 'vitest';
import { prisma, withTx } from '../db';
import { audit } from './audit.service';
import { asContext, asUser, createUser, uid } from '../../../test/helpers';

describe('audit log', () => {
  it('records row changes with the acting user, in the same transaction', async () => {
    const u = await createUser('OWNER');
    const code = uid('ITM');
    const item = await asContext(u.id, () =>
      withTx((tx) => tx.item.create({ data: { code, name: 'Audit test', type: 'YARN', unit: 'KG' } })),
    );
    await asContext(u.id, () => withTx((tx) => tx.item.update({ where: { id: item.id }, data: { name: 'Renamed' } })));
    const rows = await prisma.auditLog.findMany({ where: { tableName: 'items', recordId: item.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual(['INSERT', 'UPDATE']);
    expect(rows.every((r) => r.userId === u.id)).toBe(true);
    expect((rows[1]!.oldData as { name: string }).name).toBe('Audit test');
    expect((rows[1]!.newData as { name: string }).name).toBe('Renamed');
  });

  it('writes nothing when the transaction rolls back', async () => {
    const code = uid('ITM');
    await expect(
      withTx(async (tx) => {
        await tx.item.create({ data: { code, name: 'Rolled back', type: 'YARN', unit: 'KG' } });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const n = await prisma.auditLog.count({ where: { tableName: 'items', newData: { path: ['code'], equals: code } } });
    expect(n).toBe(0);
  });

  it('never stores password hashes', async () => {
    const u = await createUser([]);
    const rows = await prisma.auditLog.findMany({ where: { tableName: 'users', recordId: u.id } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(JSON.stringify(r.newData)).not.toContain('password_hash');
  });

  it('explicit POST/CANCEL rows carry reason and doc number', async () => {
    const u = await createUser('OWNER');
    const id = (await prisma.item.create({ data: { code: uid('X'), name: 'x', type: 'YARN', unit: 'KG' } })).id;
    await asContext(u.id, () =>
      withTx((tx) => audit.log(tx, { docType: 'TEST_DOC', recordId: id, action: 'CANCEL', reason: 'Wrong vendor', docNo: 'T/26-27/0001' })),
    );
    const row = await prisma.auditLog.findFirstOrThrow({ where: { tableName: 'TEST_DOC', recordId: id } });
    expect(row).toMatchObject({ action: 'CANCEL', reason: 'Wrong vendor', docNo: 'T/26-27/0001', userId: u.id });
  });

  it('is append-only at the database level', async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.$executeRaw`UPDATE audit_log SET action = 'X' WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM audit_log WHERE id = ${row.id}`).rejects.toThrow(/append-only/);
  });

  it('GET /audit requires audit.view', async () => {
    expect((await (await asUser(['stock.view'])).get('/api/v1/audit')).status).toBe(403);
    const res = await (await asUser(['audit.view'])).get('/api/v1/audit?pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.meta.pageSize).toBe(5);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });
});
