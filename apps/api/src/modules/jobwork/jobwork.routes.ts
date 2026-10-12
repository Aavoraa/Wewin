import { Router } from 'express';
import {
  zIdParam,
  zInwardDcInput,
  zInwardDcUpdate,
  zInwardListQuery,
  zOutwardDcInput,
  zOutwardDcUpdate,
  zOutwardListQuery,
  zReason,
} from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { jobworkController as c, zRollParam, zVendorQuery } from './jobwork.controller';

/** /api/v1/outward-dcs, /inward-dcs (A§8: post, cancel, close; link inward ↔ outward). */
export const jobworkRouter = Router();
const view = requirePermission('jobwork.view');
const create = requirePermission('jobwork.create');
const id = { params: zIdParam };

jobworkRouter.get('/outward-dcs', view, handle({ query: zOutwardListQuery }, c.listOutward));
jobworkRouter.get('/outward-dcs/pending', view, handle({ query: zVendorQuery }, c.pending));
jobworkRouter.get('/outward-dcs/:id', view, handle(id, c.getOutward));
jobworkRouter.get('/outward-dcs/:id/print', view, handle(id, c.getOutward));
jobworkRouter.get('/outward-dcs/:id/loss', view, handle(id, c.lossOf));
jobworkRouter.get('/outward-dcs/:id/movements', requirePermission('jobwork.view', 'stock.view'), handle(id, c.outwardMovements));
jobworkRouter.post('/outward-dcs', create, handle({ body: zOutwardDcInput }, c.createOutward, { status: 201 }));
jobworkRouter.patch('/outward-dcs/:id', create, handle({ params: zIdParam, body: zOutwardDcUpdate }, c.updateOutward));
jobworkRouter.delete('/outward-dcs/:id', create, handle(id, c.deleteOutward));
jobworkRouter.post('/outward-dcs/:id/post', requirePermission('jobwork.post'), handle(id, c.postOutward));
jobworkRouter.post('/outward-dcs/:id/cancel', requirePermission('jobwork.cancel'), handle({ params: zIdParam, body: zReason }, c.cancelOutward));
jobworkRouter.post('/outward-dcs/:id/close', requirePermission('jobwork.close'), handle({ params: zIdParam, body: zReason }, c.closeOutward));

jobworkRouter.get('/inward-dcs', view, handle({ query: zInwardListQuery }, c.listInward));
jobworkRouter.get('/inward-dcs/:id', view, handle(id, c.getInward));
jobworkRouter.get('/inward-dcs/:id/print', view, handle(id, c.getInward));
jobworkRouter.get('/inward-dcs/:id/movements', requirePermission('jobwork.view', 'stock.view'), handle(id, c.inwardMovements));
jobworkRouter.post('/inward-dcs', create, handle({ body: zInwardDcInput }, c.createInward, { status: 201 }));
jobworkRouter.patch('/inward-dcs/:id', create, handle({ params: zIdParam, body: zInwardDcUpdate }, c.updateInward));
jobworkRouter.delete('/inward-dcs/:id', create, handle(id, c.deleteInward));
jobworkRouter.post('/inward-dcs/:id/post', requirePermission('jobwork.post'), handle(id, c.postInward));
jobworkRouter.post('/inward-dcs/:id/cancel', requirePermission('jobwork.cancel'), handle({ params: zIdParam, body: zReason }, c.cancelInward));

jobworkRouter.get('/rolls/:rollNo', requirePermission('stock.view'), handle({ params: zRollParam }, c.roll));
