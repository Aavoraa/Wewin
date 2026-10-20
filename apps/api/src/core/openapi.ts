import { type RequestHandler, type Router } from 'express';
import { type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * OpenAPI 3.1 document built from the live routers: every route registered with handle() carries its
 * shared Zod schemas, and requirePermission() its permission keys, so the document cannot drift from
 * the code. Response bodies follow the standard envelope ({ data } or { data, meta }).
 */
interface HandlerMeta {
  schemas: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };
  status: number;
  public: boolean;
}

const handlerMeta = new WeakMap<RequestHandler, HandlerMeta>();
const permissionMeta = new WeakMap<RequestHandler, string[]>();

export function tagHandler(fn: RequestHandler, meta: HandlerMeta) {
  handlerMeta.set(fn, meta);
}
export function tagPermission(fn: RequestHandler, keys: string[]) {
  permissionMeta.set(fn, keys);
}

interface RouteLayer {
  method?: string;
  handle: RequestHandler;
}
interface Layer {
  route?: { path: unknown; stack: RouteLayer[] };
}

type JsonSchema = Record<string, unknown>;
const toJson = (s: ZodTypeAny): JsonSchema => {
  const { $schema: _s, ...rest } = zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' }) as JsonSchema;
  return rest;
};

/** Query and path schemas become parameters; anything not an object becomes a single "value". */
function parameters(schema: ZodTypeAny | undefined, where: 'query' | 'path'): JsonSchema[] {
  if (!schema) return [];
  const j = toJson(schema);
  const props = (j.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((j.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, s]) => ({ name, in: where, required: where === 'path' || required.has(name), schema: s, ...(s.description ? { description: s.description } : {}) }));
}

const tagOf = (path: string) => path.split('/').filter(Boolean)[0]?.replace(/^:.*/, '') || 'root';

export function buildOpenApi(mounts: { prefix: string; router: Router }[], info: { title: string; version: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const { prefix, router } of mounts) {
    for (const layer of router.stack as unknown as Layer[]) {
      const route = layer.route;
      if (!route || typeof route.path !== 'string') continue;
      const full = `${prefix}${route.path}`.replace(/:(\w+)/g, '{$1}');
      const method = route.stack.find((l) => l.method)?.method;
      if (!method) continue;
      const handler = route.stack.map((l) => handlerMeta.get(l.handle)).find(Boolean);
      const perms = route.stack.flatMap((l) => permissionMeta.get(l.handle) ?? []);
      const pathParamNames = [...full.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
      const params = handler?.schemas.params ? parameters(handler.schemas.params, 'path') : pathParamNames.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
      const status = String(handler?.status ?? 200);
      const isPublic = handler?.public ?? false;
      const op: Record<string, unknown> = {
        tags: [tagOf(route.path)],
        operationId: `${method}_${full.replace(/[{}]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}`,
        description: perms.length ? `Requires permission: ${perms.map((p) => `\`${p}\``).join(', ')}` : isPublic ? 'Public' : 'Any signed-in user',
        parameters: [...params, ...parameters(handler?.schemas.query, 'query')],
        responses: {
          [status]: { description: status === '204' ? 'No content' : 'Success', ...(status === '204' ? {} : { content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } }) },
          '400': { $ref: '#/components/responses/Error' },
          ...(isPublic ? {} : { '401': { $ref: '#/components/responses/Error' } }),
          ...(perms.length ? { '403': { $ref: '#/components/responses/Error' } } : {}),
        },
        ...(isPublic ? { security: [] } : {}),
      };
      if (handler?.schemas.body) op.requestBody = { required: true, content: { 'application/json': { schema: toJson(handler.schemas.body) } } };
      (paths[full] ??= {})[method] = op;
    }
  }
  return {
    openapi: '3.1.0',
    info: { ...info, description: 'Wewin ERP API. All business endpoints sit under /api/v1 and need a Bearer access token from POST /api/v1/auth/login. Lists accept ?format=xlsx&cols=[...] for an Excel export.' },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Envelope: { type: 'object', properties: { data: {}, meta: { type: 'object', properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' } } } }, required: ['data'] },
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } } },
      },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
    },
  };
}
