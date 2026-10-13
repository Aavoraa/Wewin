import { Router } from 'express';
import { zAlertCheck, zAlertListQuery, zIdParam } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { ListResult, handle } from '../../core/http';
import { alertsService } from './alerts.service';

/** /api/v1/alerts (A§10): list, summary, acknowledge, run a check now. */
export const alertsRouter = Router();
alertsRouter.get('/alerts', requirePermission('alerts.view'), handle({ query: zAlertListQuery }, async ({ query }) => {
  const r = await alertsService.list(query);
  return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
}));
alertsRouter.get('/alerts/summary', requirePermission('alerts.view'), handle({}, () => alertsService.summary()));
alertsRouter.post('/alerts/:id/acknowledge', requirePermission('alerts.manage'), handle({ params: zIdParam }, ({ params, user }) => alertsService.acknowledge(params.id, user)));
alertsRouter.post('/alerts/check', requirePermission('alerts.manage'), handle({ body: zAlertCheck }, ({ body }) =>
  body.kind === 'DC' ? alertsService.checkDcs() : alertsService.checkPayments(),
));
