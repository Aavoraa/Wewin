import { AppError } from './errors/app-error';

export interface Paging {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

export function paging(q: { page: number; pageSize: number }): Paging {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize, page: q.page, pageSize: q.pageSize };
}

/**
 * Translate `?sort=field` / `?sort=-field` into a Prisma orderBy using a whitelist
 * (field name → orderBy object), so clients cannot sort on arbitrary columns.
 */
export function orderBy<T>(sort: string | undefined, allowed: Record<string, (dir: 'asc' | 'desc') => T>, fallback: T): T {
  if (!sort) return fallback;
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const key = sort.replace(/^-/, '');
  const f = allowed[key];
  if (!f) throw new AppError('VALIDATION_ERROR', `Cannot sort by ${key}`, 400);
  return f(dir);
}

/** `active` filter: default true for pickers; 'all' shows everything. */
export function activeFilter(active?: 'true' | 'false' | 'all'): { isActive?: boolean } {
  if (active === 'all' || active === undefined) return {};
  return { isActive: active === 'true' };
}

export function codeNameSearch(q?: string) {
  if (!q) return {};
  return {
    OR: [{ code: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }],
  };
}
