import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context (user, request id) used by withTx() to tag audit rows. */
export interface RequestContext {
  requestId: string;
  userId?: string;
  /** Exporter / unit logged into (Q-085): unit-scoped tables are filtered to it. */
  unitId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function setContextUser(userId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}

export function setContextUnit(unitId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.unitId = unitId;
}

/** Unit of the current request or job, if any (Q-085). */
export function currentUnitId(): string | undefined {
  return storage.getStore()?.unitId;
}
