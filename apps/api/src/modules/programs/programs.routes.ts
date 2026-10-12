import { Router } from 'express';
import { zIdParam, zProgramInput, zProgramListQuery, zProgramUpdate, zReason, zTrimsBomInput } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { programsController as c } from './programs.controller';

/** /api/v1/programs (+ trims BOM per order, Q-030). */
export const programsRouter = Router();
const view = requirePermission('programs.view');
const edit = requirePermission('programs.edit');

programsRouter.get('/programs', view, handle({ query: zProgramListQuery }, c.list));
programsRouter.get('/programs/:id', view, handle({ params: zIdParam }, c.get));
programsRouter.get('/programs/:id/processes', view, handle({ params: zIdParam }, c.processes));
programsRouter.post('/programs', edit, handle({ body: zProgramInput }, c.create, { status: 201 }));
programsRouter.patch('/programs/:id', edit, handle({ params: zIdParam, body: zProgramUpdate }, c.update));
programsRouter.delete('/programs/:id', edit, handle({ params: zIdParam }, c.remove));
programsRouter.post('/programs/:id/approve', requirePermission('programs.approve'), handle({ params: zIdParam }, c.approve));
programsRouter.post('/programs/:id/cancel', requirePermission('programs.approve'), handle({ params: zIdParam, body: zReason }, c.cancel));
programsRouter.get('/orders/:id/trims-bom', view, handle({ params: zIdParam }, c.getBom));
programsRouter.put('/orders/:id/trims-bom', edit, handle({ params: zIdParam, body: zTrimsBomInput }, c.saveBom));
