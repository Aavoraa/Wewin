import { Router } from 'express';
import { z } from 'zod';
import { zExporterCreate, zExporterUpdate, zSetActive, zUnitCreate, zUnitUpdate } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { unitsService } from './units.service';

const zId = z.object({ id: z.string().uuid() });

/** /api/v1/exporters and /api/v1/units — Exporters & Units master (Q-085). */
export const unitsRouter = Router();

unitsRouter.get('/exporters', requirePermission('settings.view'), handle({}, () => unitsService.listExporters()));
unitsRouter.post('/exporters', requirePermission('settings.edit'), handle({ body: zExporterCreate }, ({ body }) => unitsService.createExporter(body)));
unitsRouter.put('/exporters/:id', requirePermission('settings.edit'), handle({ params: zId, body: zExporterUpdate }, ({ params, body }) => unitsService.updateExporter(params.id, body)));
unitsRouter.post(
  '/exporters/:id/active',
  requirePermission('settings.edit'),
  handle({ params: zId, body: zSetActive }, ({ params, body }) => unitsService.setExporterActive(params.id, body.isActive)),
);
unitsRouter.post('/units', requirePermission('settings.edit'), handle({ body: zUnitCreate }, ({ body }) => unitsService.createUnit(body)));
unitsRouter.put('/units/:id', requirePermission('settings.edit'), handle({ params: zId, body: zUnitUpdate }, ({ params, body }) => unitsService.updateUnit(params.id, body)));
unitsRouter.post(
  '/units/:id/active',
  requirePermission('settings.edit'),
  handle({ params: zId, body: zSetActive }, ({ params, body }) => unitsService.setUnitActive(params.id, body.isActive)),
);
