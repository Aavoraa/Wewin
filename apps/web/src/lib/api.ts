import { type ApiErrorBody, type ListMeta } from '@wewin/shared';

/** Error thrown for any non-2xx API response; carries the stable error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onAuthLost: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}
export function setOnAuthLost(fn: () => void) {
  onAuthLost = fn;
}

/** One refresh at a time (several 401s in parallel share it). */
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) return false;
      const body = (await res.json()) as { data: { accessToken: string } };
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

export function toQueryString(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

interface RequestOpts {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

async function raw(method: string, path: string, opts: RequestOpts = {}, retried = false): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api/v1${path}${toQueryString(opts.query)}`, {
    method,
    headers,
    credentials: 'same-origin',
    signal: opts.signal,
    body:
      opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshAccessToken()) return raw(method, path, opts, true);
    onAuthLost?.();
  }
  return res;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

/** Typed API client: unwraps { data } and { data, meta }. */
export const api = {
  async get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return (await parse<{ data: T }>(await raw('GET', path, { query, signal }))).data;
  },
  async list<T>(path: string, query?: Query, signal?: AbortSignal): Promise<{ data: T[]; meta: ListMeta }> {
    return parse<{ data: T[]; meta: ListMeta }>(await raw('GET', path, { query, signal }));
  },
  async post<T>(path: string, body?: unknown): Promise<T> {
    return (await parse<{ data: T }>(await raw('POST', path, { body: body ?? {} })))?.data;
  },
  async patch<T>(path: string, body: unknown): Promise<T> {
    return (await parse<{ data: T }>(await raw('PATCH', path, { body }))).data;
  },
  async put<T>(path: string, body: unknown): Promise<T> {
    return (await parse<{ data: T }>(await raw('PUT', path, { body }))).data;
  },
  async del(path: string): Promise<void> {
    await parse(await raw('DELETE', path));
  },
  /** Download a file (Excel exports, attachments) with auth, then save it. */
  async download(path: string, query?: Query, fallbackName = 'export.xlsx'): Promise<void> {
    const res = await raw('GET', path, { query });
    if (!res.ok) await parse(res);
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
  },
};

/** Human message for an error (used by toasts and error states). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && e.details && typeof e.details === 'object') {
      const d = e.details as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
      const first = Object.entries(d.fieldErrors ?? {})[0];
      if (first) return `${first[0]}: ${first[1][0]}`;
      if (d.formErrors?.[0]) return d.formErrors[0];
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Unexpected error';
}
