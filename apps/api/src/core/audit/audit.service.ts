import { Prisma } from '@wewin/db';
import { getContext } from '../context';
import { type Tx, prisma } from '../db';

export type AuditAction = 'POST' | 'CANCEL' | 'CLOSE' | 'APPROVE' | 'REJECT' | 'CONFIRM' | 'REOPEN' | 'EXPORT' | 'LOGIN' | 'ACKNOWLEDGE';

/**
 * Explicit business-action audit rows (post / cancel / close / approve with reason).
 * Row-level create/update/delete auditing is done by the `audit_row_change` trigger (D-03),
 * inside the same transaction.
 */
export const audit = {
  async log(
    tx: Tx,
    e: { docType: string; recordId: string; action: AuditAction; reason?: string | null; docNo?: string | null; data?: unknown },
  ): Promise<void> {
    const ctx = getContext();
    await tx.auditLog.create({
      data: {
        userId: ctx?.userId ?? null,
        requestId: ctx?.requestId ?? null,
        tableName: e.docType,
        recordId: e.recordId,
        action: e.action,
        reason: e.reason ?? null,
        docNo: e.docNo ?? null,
        newData: e.data === undefined ? Prisma.JsonNull : (e.data as Prisma.InputJsonValue),
      },
    });
  },

  list(filter: { tableName?: string; recordId?: string; userId?: string; action?: string; skip: number; take: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.tableName ? { tableName: filter.tableName } : {}),
      ...(filter.recordId ? { recordId: filter.recordId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
    };
    return prisma.$transaction([
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: filter.skip, take: filter.take }),
      prisma.auditLog.count({ where }),
    ]);
  },
};
