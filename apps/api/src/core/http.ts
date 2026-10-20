import { type Request, type RequestHandler, type Response } from 'express';
import { type z, type ZodTypeAny } from 'zod';
import { type ListMeta } from '@wewin/shared';
import { AppError } from './errors/app-error';
import { type CurrentUser } from './auth/auth.types';
import { tagHandler } from './openapi';
import { EXPORT_MAX_ROWS, buildWorkbook, sendWorkbook, zExportColumns } from './excel';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type Out<S, K extends keyof Schemas> = S extends Record<K, infer T extends ZodTypeAny> ? z.output<T> : undefined;

export interface HandlerInput<S extends Schemas> {
  body: Out<S, 'body'>;
  query: Out<S, 'query'>;
  params: Out<S, 'params'>;
  user: CurrentUser;
  req: Request;
  res: Response;
}

/** A list result is sent as { data, meta }; anything else as { data }. */
export class ListResult<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: ListMeta,
  ) {}
}

/** Raw responses (files, redirects) — the controller has already written to `res`. */
export const HANDLED = Symbol('handled');

/**
 * Wraps a controller: validates params/query/body with shared Zod schemas, requires an authenticated
 * user (set by `authenticate`) and serialises the result in the standard envelope.
 */
export function handle<S extends Schemas>(
  schemas: S,
  fn: (input: HandlerInput<S>) => Promise<unknown>,
  opts: { status?: number; public?: boolean } = {},
): RequestHandler {
  const h: RequestHandler = async (req, res) => {
    const params = schemas.params ? schemas.params.parse(req.params) : undefined;
    const query = schemas.query ? schemas.query.parse(req.query) : undefined;
    const body = schemas.body ? schemas.body.parse(req.body ?? {}) : undefined;
    const user = req.user;
    if (!user && !opts.public) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
    // Generic register export: any list endpoint + ?format=xlsx&cols=[{key,header,type}]
    const xlsx = req.method === 'GET' && req.query.format === 'xlsx';
    if (xlsx && query && typeof query === 'object' && 'pageSize' in query) {
      Object.assign(query, { page: 1, pageSize: EXPORT_MAX_ROWS });
    }
    const result = await fn({ body, query, params, user: user as CurrentUser, req, res } as HandlerInput<S>);
    if (result === HANDLED) return;
    if (xlsx && result instanceof ListResult) {
      let cols;
      try {
        cols = zExportColumns.parse(JSON.parse(String(req.query.cols ?? '[]')));
      } catch {
        throw new AppError('VALIDATION_ERROR', 'cols must be a JSON array of {key, header, type}', 400);
      }
      const title = String(req.query.title ?? 'Export').slice(0, 60);
      const wb = await buildWorkbook({ title, columns: cols, rows: result.data });
      await sendWorkbook(res, `${title}-${new Date().toISOString().slice(0, 10)}.xlsx`, wb);
      return;
    }
    if (result instanceof ListResult) {
      res.status(opts.status ?? 200).json({ data: result.data, meta: result.meta });
      return;
    }
    res.status(opts.status ?? 200).json({ data: result ?? null });
  };
  tagHandler(h, { schemas, status: opts.status ?? 200, public: opts.public ?? false });
  return h;
}
