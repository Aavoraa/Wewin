import { Prisma, PrismaClient } from '@wewin/db';
import { getContext } from './context';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});
prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));

export type Tx = Prisma.TransactionClient;
export type Isolation = 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

type Hook = () => Promise<void> | void;
const commitHooks = new WeakMap<Tx, Hook[]>();

/** Register work to run only after the outermost transaction commits (e.g. enqueue a job, notify). */
export function afterCommit(tx: Tx, hook: Hook): void {
  const list = commitHooks.get(tx);
  if (!list) throw new Error('afterCommit() called outside withTx()');
  list.push(hook);
}

interface TxOptions {
  /** Compose into an existing transaction (posting composes ledger + numbering + audit). */
  tx?: Tx;
  isolation?: Isolation;
  retries?: number;
  timeoutMs?: number;
}

function isRetryable(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /40001|40P01|could not serialize|deadlock detected/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` in a database transaction. Every write in the API goes through here so that the
 * audit trigger knows the acting user (set_config is transaction-local) and posting is atomic.
 * Serializable is the default for posting; serialization failures are retried.
 */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
  if (opts.tx) return fn(opts.tx);
  const ctx = getContext();
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let hooks: Hook[] = [];
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          hooks = [];
          commitHooks.set(tx, hooks);
          await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx?.userId ?? ''}, true),
                                    set_config('app.request_id', ${ctx?.requestId ?? ''}, true)`;
          return fn(tx);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel[opts.isolation ?? 'Serializable'],
          maxWait: 10_000,
          timeout: opts.timeoutMs ?? 30_000,
        },
      );
      for (const h of hooks) {
        try {
          await h();
        } catch (err) {
          logger.error({ err }, 'afterCommit hook failed');
        }
      }
      return result;
    } catch (e) {
      if (attempt < retries && isRetryable(e)) {
        await sleep(20 + Math.floor(Math.random() * 60) * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

/** Lock a row for the rest of the transaction (state checks before posting). */
export async function lockRow(tx: Tx, table: string, id: string): Promise<void> {
  if (!/^[a-z_]+$/.test(table)) throw new Error('bad table name');
  await tx.$queryRawUnsafe(`SELECT 1 FROM "${table}" WHERE id = $1::uuid FOR UPDATE`, id);
}
