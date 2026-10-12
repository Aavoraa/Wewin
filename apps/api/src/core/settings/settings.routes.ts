import { Router } from 'express';
import { z } from 'zod';
import { zCompanySettings, zListQuery } from '@wewin/shared';
import { requirePermission } from '../auth/auth.middleware';
import { ListResult, handle } from '../http';
import { audit } from '../audit/audit.service';
import { settingsService } from './settings.service';

/** /api/v1/settings and /api/v1/audit */
export const settingsRouter = Router();

settingsRouter.get('/settings/company', requirePermission('settings.view'), handle({}, () => settingsService.getCompany()));
settingsRouter.put(
  '/settings/company',
  requirePermission('settings.edit'),
  handle({ body: zCompanySettings }, ({ body }) => settingsService.updateCompany(body)),
);
settingsRouter.get('/settings/business', requirePermission('settings.view'), handle({}, () => settingsService.listWithMeta()));
settingsRouter.put(
  '/settings/business/:key',
  requirePermission('settings.edit'),
  handle({ params: z.object({ key: z.string() }), body: z.object({ value: z.unknown() }) }, ({ params, body }) =>
    settingsService.set(params.key, body.value),
  ),
);
settingsRouter.get('/settings/series', requirePermission('settings.view'), handle({}, () => settingsService.listSeries()));
settingsRouter.get(
  '/settings/number-series',
  requirePermission('settings.view'),
  handle({}, () => settingsService.listNumberSeries()),
);
settingsRouter.put(
  '/settings/series/:code',
  requirePermission('settings.edit'),
  handle(
    {
      params: z.object({ code: z.string() }),
      body: z.object({
        prefix: z.string().trim().regex(/^[A-Z0-9-]{1,8}$/, 'Upper-case letters/digits, max 8'),
        padding: z.number().int().min(3).max(8),
        isActive: z.boolean(),
      }),
    },
    ({ params, body }) => settingsService.updateSeries(params.code, body),
  ),
);

const zAuditQuery = zListQuery.extend({
  tableName: z.string().optional(),
  recordId: z.string().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
});

settingsRouter.get(
  '/audit',
  requirePermission('audit.view'),
  handle({ query: zAuditQuery }, async ({ query }) => {
    const [rows, total] = await audit.list({
      ...query,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return new ListResult(
      rows.map((r) => ({ ...r, id: r.id.toString() })),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }),
);
