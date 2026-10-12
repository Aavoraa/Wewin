import { type Router } from 'express';
import { type ZodTypeAny, type z } from 'zod';
import { type PermissionKey, zIdParam, zReason } from '@wewin/shared';
import { requirePermission } from './auth/auth.middleware';
import { type CurrentUser } from './auth/auth.types';
import { HANDLED, ListResult, handle } from './http';

interface DocService<C, U> {
  list(q: never): Promise<{ rows: unknown[]; total: number; p: { page: number; pageSize: number } }>;
  get(id: string): Promise<unknown>;
  create(input: C, user: CurrentUser): Promise<unknown>;
  update(id: string, input: U): Promise<unknown>;
  remove(id: string): Promise<void>;
  post(id: string, user: CurrentUser): Promise<unknown>;
  cancel(id: string, reason: string, user: CurrentUser): Promise<unknown>;
  close?(id: string, reason: string, user: CurrentUser): Promise<unknown>;
}

/**
 * Standard document endpoints (A§8): GET list, GET :id (+ /print), POST (draft), PATCH :id (draft,
 * with version), DELETE :id (draft), POST :id/post, :id/cancel (reason), :id/close (reason).
 * The service enforces every state transition; this only maps HTTP to one service call.
 */
export function mountDocRoutes<Q extends ZodTypeAny, C extends ZodTypeAny, U extends ZodTypeAny>(
  router: Router,
  path: string,
  o: {
    perms: { view: PermissionKey; create: PermissionKey; post: PermissionKey; cancel: PermissionKey; close?: PermissionKey };
    listQuery: Q;
    createBody: C;
    updateBody: U;
    svc: DocService<z.output<C>, z.output<U>>;
  },
) {
  const { perms, svc } = o;
  const id = { params: zIdParam };
  router.get(path, requirePermission(perms.view), handle({ query: o.listQuery }, async ({ query }) => {
    const r = await svc.list(query as never);
    return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
  }));
  router.get(`${path}/:id`, requirePermission(perms.view), handle(id, ({ params }) => svc.get(params.id)));
  router.get(`${path}/:id/print`, requirePermission(perms.view), handle(id, ({ params }) => svc.get(params.id)));
  router.post(path, requirePermission(perms.create), handle({ body: o.createBody }, ({ body, user }) => svc.create(body as z.output<C>, user), { status: 201 }));
  router.patch(`${path}/:id`, requirePermission(perms.create), handle({ params: zIdParam, body: o.updateBody }, ({ params, body }) => svc.update(params.id, body as z.output<U>)));
  router.delete(`${path}/:id`, requirePermission(perms.create), handle(id, async ({ params, res }) => {
    await svc.remove(params.id);
    res.status(204).end();
    return HANDLED;
  }));
  router.post(`${path}/:id/post`, requirePermission(perms.post), handle(id, ({ params, user }) => svc.post(params.id, user)));
  router.post(`${path}/:id/cancel`, requirePermission(perms.cancel), handle({ params: zIdParam, body: zReason }, ({ params, body, user }) => svc.cancel(params.id, body.reason, user)));
  if (svc.close && perms.close) {
    const close = svc.close.bind(svc);
    router.post(`${path}/:id/close`, requirePermission(perms.close), handle({ params: zIdParam, body: zReason }, ({ params, body, user }) => close(params.id, body.reason, user)));
  }
}
