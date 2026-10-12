import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from '@tanstack/react-table';
import { useNavigate } from 'react-router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, FileSpreadsheet, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTimeIst, formatInr, formatKg, formatPct, formatQty } from '@/lib/format';
import { cn, prefs } from '@/lib/utils';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { EmptyState, ErrorState } from './states';
import { Skeleton } from './ui/skeleton';
import { StatusBadge } from './StatusBadge';

export type CellType = 'text' | 'kg' | 'qty' | 'money' | 'rate' | 'pct' | 'date' | 'datetime' | 'int' | 'status';

export interface DTColumn<T> {
  key: string;
  header: string;
  type?: CellType;
  cell?: (row: T) => ReactNode;
  /** Server sort field; omit to make the column unsortable. */
  sort?: string;
  hidden?: boolean;
  className?: string;
  /** Excluded from Excel export (e.g. action buttons). */
  noExport?: boolean;
}

function getPath(row: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), row);
}

export function formatCell(v: unknown, type: CellType = 'text'): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  switch (type) {
    case 'kg':
      return formatKg(String(v));
    case 'qty':
    case 'int':
      return formatQty(String(v));
    case 'money':
      return formatInr(String(v));
    case 'rate':
      return formatQty(String(v), 4);
    case 'pct':
      return formatPct(String(v));
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTimeIst(String(v));
    case 'status':
      return <StatusBadge status={String(v)} />;
    default:
      return String(v);
  }
}

const NUMERIC: CellType[] = ['kg', 'qty', 'money', 'rate', 'pct', 'int'];

export interface DataTableProps<T> {
  /** Unique id: used for the query key and remembered column choices. */
  id: string;
  endpoint: string;
  columns: DTColumn<T>[];
  filters?: Record<string, string | undefined>;
  filterBar?: ReactNode;
  toolbar?: ReactNode;
  defaultSort?: string;
  exportTitle?: string;
  rowHref?: (row: T) => string;
  pageSize?: number;
  emptyTitle?: string;
  emptyHint?: string;
  searchPlaceholder?: string;
  footer?: (rows: T[]) => ReactNode;
}

/** Register pattern (A§9): server-side paging, search, sort, filters, column chooser, Excel export. */
export function DataTable<T extends object>(props: DataTableProps<T>) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => prefs.get(`dt:${props.id}:ps`, props.pageSize ?? 25));
  const [sort, setSort] = useState<string | undefined>(props.defaultSort);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    prefs.get(`dt:${props.id}:cols`, Object.fromEntries(props.columns.filter((c) => c.hidden).map((c) => [c.key, false]))),
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const filterKey = JSON.stringify(props.filters ?? {});
  useEffect(() => setPage(1), [filterKey]);

  const params = { page, pageSize, sort, q: q || undefined, ...(props.filters ?? {}) };
  const query = useQuery({
    queryKey: [props.id, props.endpoint, params],
    queryFn: ({ signal }) => api.list<T>(props.endpoint, params, signal),
    placeholderData: keepPreviousData,
  });

  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      props.columns.map((c) => ({
        id: c.key,
        header: c.header,
        accessorFn: (row) => getPath(row, c.key),
        cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : formatCell(ctx.getValue(), c.type)),
      })),
    [props.columns],
  );

  const table = useReactTable({
    data: query.data?.data ?? [],
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: (u) => {
      setVisibility((prev) => {
        const next = typeof u === 'function' ? u(prev) : u;
        prefs.set(`dt:${props.id}:cols`, next);
        return next;
      });
    },
  });

  const total = query.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const colByKey = new Map(props.columns.map((c) => [c.key, c]));

  function toggleSort(field?: string) {
    if (!field) return;
    setSort((s) => (s === field ? `-${field}` : s === `-${field}` ? undefined : field));
    setPage(1);
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const cols = props.columns
        .filter((c) => !c.noExport && visibility[c.key] !== false)
        .map((c) => ({ key: c.key, header: c.header, type: c.type === 'status' ? 'text' : (c.type ?? 'text') }));
      await api.download(props.endpoint, {
        ...params,
        page: 1,
        format: 'xlsx',
        cols: JSON.stringify(cols),
        title: props.exportTitle ?? props.id,
      });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={props.searchPlaceholder ?? 'Search…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
          />
        </div>
        {props.filterBar}
        <div className="ml-auto flex items-center gap-2">
          {props.toolbar}
          <Button variant="ghost" size="icon" onClick={() => void query.refetch()} aria-label="Refresh" title="Refresh">
            <RefreshCw className={cn(query.isFetching && 'animate-spin')} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {table.getAllLeafColumns().map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {colByKey.get(col.id)?.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => void exportXlsx()} loading={exporting} disabled={!total}>
            <FileSpreadsheet /> Excel
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border bg-card">
        <Table>
          <THead>
            {table.getHeaderGroups().map((hg) => (
              <TR key={hg.id}>
                {hg.headers.map((h) => {
                  const c = colByKey.get(h.column.id)!;
                  const active = sort === c.sort ? 'asc' : sort === `-${c.sort}` ? 'desc' : null;
                  return (
                    <TH key={h.id} className={cn(NUMERIC.includes(c.type ?? 'text') && 'text-right', c.className)}>
                      {c.sort ? (
                        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(c.sort)}>
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {active === 'asc' ? <ArrowUp className="size-3" /> : active === 'desc' ? <ArrowDown className="size-3" /> : null}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TH>
                  );
                })}
              </TR>
            ))}
          </THead>
          <TBody>
            {query.isLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TR key={i}>
                    {table.getVisibleLeafColumns().map((c) => (
                      <TD key={c.id}>
                        <Skeleton className="h-4 w-full" />
                      </TD>
                    ))}
                  </TR>
                ))
              : table.getRowModel().rows.map((row) => (
                  <TR
                    key={row.id}
                    className={cn(props.rowHref && 'cursor-pointer hover:bg-accent/60')}
                    onClick={props.rowHref ? () => navigate(props.rowHref!(row.original)) : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const c = colByKey.get(cell.column.id)!;
                      return (
                        <TD key={cell.id} className={cn(NUMERIC.includes(c.type ?? 'text') && 'num', c.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TD>
                      );
                    })}
                  </TR>
                ))}
          </TBody>
          {props.footer && query.data?.data.length ? props.footer(query.data.data) : null}
        </Table>
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {!query.isLoading && !query.isError && total === 0 ? (
          <EmptyState title={props.emptyTitle ?? 'No records'} hint={props.emptyHint ?? (q ? 'Try a different search.' : undefined)} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString('en-IN')}` : '0 records'}
        </span>
        <div className="flex items-center gap-2">
          <Select
            className="h-8 w-20"
            value={pageSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPageSize(n);
              prefs.set(`dt:${props.id}:ps`, n);
              setPage(1);
            }}
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span>
            Page {page} / {pages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
