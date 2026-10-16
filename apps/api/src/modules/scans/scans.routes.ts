import { type RequestHandler, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { SCAN_TARGETS, TARGET_SPECS, zAliasListQuery, zApplyScan, zIdParam, zReason, zReviewPatch, zScanListQuery } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { AppError } from '../../core/errors/app-error';
import { HANDLED, ListResult, handle } from '../../core/http';
import { MAX_SCAN_BYTES } from './scans.storage';
import { scansService as s } from './scans.service';

/** /api/v1/invoice-scans (upload → extract → review → draft) and /vendor-item-aliases (learned descriptions). */
export const scansRouter = Router();
const view = requirePermission('scans.view');
const work = requirePermission('scans.upload');
const id = { params: zIdParam };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SCAN_BYTES, files: 1, fields: 5, fieldSize: 1024 } });
const singleFile: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new AppError('VALIDATION_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 10 MB' : 'Upload one PDF, JPG or PNG file in the "file" field', 400));
    }
    next(err);
  });

scansRouter.get('/invoice-scans/mapping', view, handle({}, async () => TARGET_SPECS));
scansRouter.get('/invoice-scans', view, handle({ query: zScanListQuery }, async ({ query }) => {
  const r = await s.list(query);
  return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
}));
scansRouter.post('/invoice-scans', work, singleFile, handle({ body: z.object({ target: z.enum(SCAN_TARGETS).optional() }) }, ({ req, body, user }) => s.upload(req.file, body.target ?? null, user), { status: 201 }));
scansRouter.get('/invoice-scans/:id', view, handle(id, ({ params }) => s.get(params.id)));
scansRouter.get('/invoice-scans/:id/layout', view, handle(id, ({ params }) => s.layout(params.id)));
scansRouter.get('/invoice-scans/:id/events', view, handle(id, ({ params }) => s.events(params.id)));
scansRouter.get('/invoice-scans/:id/sources', work, handle(id, async ({ params }) => s.sourceCandidates(params.id)));
scansRouter.get('/invoice-scans/:id/file', view, handle(id, async ({ params, user, res }) => {
  const f = await s.file(params.id, user);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(f.buf);
  return HANDLED;
}));
scansRouter.patch('/invoice-scans/:id/review', work, handle({ params: zIdParam, body: zReviewPatch }, ({ params, body, user }) => s.patchReview(params.id, body, user)));
scansRouter.post('/invoice-scans/:id/reprocess', work, handle({ params: zIdParam, body: z.object({ mode: z.enum(['auto', 'local', 'ai']).default('auto') }) }, ({ params, body, user }) => s.reprocess(params.id, body.mode, user)));
scansRouter.post('/invoice-scans/:id/discard', work, handle({ params: zIdParam, body: zReason }, ({ params, body, user }) => s.discard(params.id, body.reason, user)));
scansRouter.post('/invoice-scans/:id/apply', requirePermission('scans.apply'), handle({ params: zIdParam, body: zApplyScan }, ({ params, body, user }) => s.apply(params.id, body, user)));

scansRouter.get('/vendor-item-aliases', view, handle({ query: zAliasListQuery }, async ({ query }) => {
  const r = await s.listAliases(query);
  return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
}));
const decide = z.object({ version: z.number().int().min(1) });
scansRouter.post('/vendor-item-aliases/:id/approve', requirePermission('scans.aliases.approve'), handle({ params: zIdParam, body: decide }, ({ params, body, user }) => s.decideAlias(params.id, body.version, 'APPROVED', user)));
scansRouter.post('/vendor-item-aliases/:id/reject', requirePermission('scans.aliases.approve'), handle({ params: zIdParam, body: decide }, ({ params, body, user }) => s.decideAlias(params.id, body.version, 'REJECTED', user)));
