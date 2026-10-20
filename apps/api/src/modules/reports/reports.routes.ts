import { Router } from 'express';
import { z } from 'zod';
import { zIdParam } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { HANDLED, handle } from '../../core/http';
import { reportsService as s } from './reports.service';

/** /api/v1/dashboard, /reports-catalogue, /reports/run/:key, /report-exports (A8). */
export const reportsRouter = Router();
const key = z.object({ key: z.string().regex(/^[a-z0-9-]{2,60}$/) });

reportsRouter.get('/dashboard', requirePermission('dashboard.view'), handle({}, ({ user }) => s.dashboard(user)));
reportsRouter.get('/reports-catalogue', requirePermission('reports.view'), handle({}, async ({ user }) => s.catalogue(user)));
// The report's own module permission is checked in the service (each report differs).
reportsRouter.get('/reports/run/:key', requirePermission('reports.view'), handle({ params: key }, ({ params, req, user }) => s.run(params.key, req.query as Record<string, unknown>, user)));
reportsRouter.post('/report-exports', requirePermission('reports.view', 'reports.export'), handle({ body: z.object({ reportKey: z.string().max(60), params: z.record(z.string(), z.string().max(100).nullable()).default({}) }) }, ({ body, user }) => s.requestExport(body.reportKey, body.params, user), { status: 202 }));
reportsRouter.get('/report-exports', requirePermission('reports.export'), handle({}, ({ user }) => s.listExports(user)));
reportsRouter.get('/report-exports/:id/download', requirePermission('reports.export'), handle({ params: zIdParam }, async ({ params, user, res }) => {
  const f = await s.download(params.id, user);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(f.buf);
  return HANDLED;
}));
