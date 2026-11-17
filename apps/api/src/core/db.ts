import { Prisma, PrismaClient } from '@wewin/db';
import { currentUnitId, getContext } from './context';
import { logger } from './logger';

/** First exporter's main unit: existing data, and rows written outside a unit (seed, scripts). */
export const MAIN_UNIT_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Tables whose rows belong to an exporter / unit (Q-085). Every query on them made while a unit is
 * in the request / job context is filtered to that unit, and new rows are stamped with it — the
 * one place units are kept apart. Lines, links and masters belong to their document or are shared.
 */
export const UNIT_SCOPED_MODELS = new Set([
  'Order', 'FabricProgram', 'YarnProgram', 'YarnReceipt', 'OutwardDc', 'InwardDc', 'FabricRoll', 'CutLay', 'CutBundle', 'PanelDc',
  'RecutSlip', 'SewingIssue', 'SewingEntry', 'Carton', 'PackingList', 'TrimsDoc', 'VendorBill', 'DebitNote', 'PaymentVoucher',
  'AgeingSnapshot', 'InvoiceScan', 'ExportInvoice', 'Shipment', 'BuyerReceipt', 'OpeningImport', 'QcInspection', 'PurchaseOrder',
  'StockDoc', 'SplRequest', 'StockMovement', 'Alert', 'ReportExport',
]);

type Args = Record<string, unknown> & { where?: unknown; data?: unknown; create?: unknown };
const WHERE_AND = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy', 'updateMany', 'updateManyAndReturn', 'deleteMany']);
const WHERE_UNIQUE = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

function scopeArgs(operation: string, args: Args, unitId: string): Args {
  const a: Args = { ...args };
  if (WHERE_AND.has(operation)) a.where = a.where ? { AND: [a.where, { unitId }] } : { unitId };
  else if (WHERE_UNIQUE.has(operation)) a.where = { ...(a.where as object), unitId };
  const stamp = (d: unknown) => (d && typeof d === 'object' && !('unitId' in d) ? { ...d, unitId } : d);
  if (operation === 'create') a.data = stamp(a.data);
  if (operation === 'createMany' || operation === 'createManyAndReturn') a.data = Array.isArray(a.data) ? a.data.map(stamp) : stamp(a.data);
  if (operation === 'upsert') a.create = stamp(a.create);
  return a;
}

const base = new PrismaClient({
  log: [
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});
base.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
base.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));

const scoped = base.$extends({
  name: 'unit-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const unitId = currentUnitId();
        if (!unitId || !UNIT_SCOPED_MODELS.has(model)) return query(args);
        return query(scopeArgs(operation, args as Args, unitId) as typeof args);
      },
    },
  },
});

/** The database client: unit-scoped (see UNIT_SCOPED_MODELS); typed as the plain client. */
export const prisma = scoped as unknown as PrismaClient;

/** Tables of UNIT_SCOPED_MODELS, plus the per-unit stock balance cache (Q-085). */
const UNIT_SCOPED_TABLES = [
  'orders', 'fabric_programs', 'yarn_programs', 'yarn_receipts', 'outward_dcs', 'inward_dcs', 'fabric_rolls', 'cut_lays', 'cut_bundles', 'panel_dcs',
  'recut_slips', 'sewing_issues', 'sewing_entries', 'cartons', 'packing_lists', 'trims_docs', 'vendor_bills', 'debit_notes', 'payment_vouchers',
  'ageing_snapshots', 'invoice_scans', 'export_invoices', 'shipments', 'buyer_receipts', 'opening_imports', 'qc_inspections', 'purchase_orders',
  'stock_docs', 'spl_requests', 'stock_movements', 'alerts', 'report_exports', 'stock_balances',
];

/**
 * For hand-written report SQL (Q-085): runs the query with every unit-scoped table replaced by a CTE of
 * the same name holding only the current unit's rows (a CTE hides the table of that name in the query),
 * so all of its references are filtered at once. Without a unit in context the query runs as written.
 */
export function unitScoped(query: Prisma.Sql): Prisma.Sql {
  const unitId = currentUnitId();
  if (!unitId) return query;
  const ctes = Prisma.join(
    UNIT_SCOPED_TABLES.map((t) => Prisma.sql`${Prisma.raw(`"${t}" AS (SELECT * FROM public."${t}" WHERE unit_id = `)}${unitId}::uuid)`),
    ', ',
  );
  const first = query.strings[0] ?? '';
  const m = /^\s*WITH\s+/i.exec(first);
  if (m) {
    const strings = [first.slice(m[0].length), ...query.strings.slice(1)];
    const rest = Prisma.sql(Object.assign(strings, { raw: strings }) as unknown as TemplateStringsArray, ...query.values);
    return Prisma.sql`WITH ${ctes}, ${rest}`;
  }
  return Prisma.sql`WITH ${ctes} ${query}`;
}

/** For hand-written SQL on unit-scoped tables: `AND <alias>.unit_id = <unit>` when a unit is set (Q-085). */
export function unitFilter(alias?: string): Prisma.Sql {
  const unitId = currentUnitId();
  if (!unitId) return Prisma.empty;
  return alias ? Prisma.sql`AND ${Prisma.raw(`${alias}.unit_id`)} = ${unitId}::uuid` : Prisma.sql`AND unit_id = ${unitId}::uuid`;
}

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
