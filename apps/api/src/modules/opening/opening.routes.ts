import { type RequestHandler, Router } from 'express';
import multer from 'multer';
import { OPENING_KINDS, zIdParam, zOpeningListQuery, zOpeningUpload, zReason } from '@wewin/shared';
import { z } from 'zod';
import { requirePermission } from '../../core/auth/auth.middleware';
import { AppError } from '../../core/errors/app-error';
import { HANDLED, ListResult, handle } from '../../core/http';
import { sendWorkbook } from '../../core/excel';
import { buildTemplate } from './opening.excel';
import { openingService as s } from './opening.service';

/** /api/v1/opening-imports — go-live opening data (Q-027). Owner-only by default (`opening.import`). */
export const openingRouter = Router();
const perm = requirePermission('opening.import');
const MAX = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX, files: 1, fields: 4 } });
const single: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) return next(new AppError('VALIDATION_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 5 MB' : 'Upload one file in the "file" field', 400));
    next(err);
  });

openingRouter.get('/opening-imports/templates/:kind', perm, handle({ params: z.object({ kind: z.enum(OPENING_KINDS) }) }, async ({ params, res }) => {
  await sendWorkbook(res, `wewin-opening-${params.kind.toLowerCase().replace('_', '-')}.xlsx`, buildTemplate(params.kind));
  return HANDLED;
}));
openingRouter.get('/opening-imports', perm, handle({ query: zOpeningListQuery }, async ({ query }) => {
  const r = await s.list(query);
  return new ListResult(r.rows, { page: r.p.page, pageSize: r.p.pageSize, total: r.total });
}));
openingRouter.get('/opening-imports/:id', perm, handle({ params: zIdParam }, ({ params }) => s.get(params.id)));
openingRouter.post('/opening-imports', perm, single, handle({ body: zOpeningUpload }, ({ body, req, user }) => s.upload(body.kind, body.asOfDate, req.file, user), { status: 201 }));
openingRouter.delete('/opening-imports/:id', perm, handle({ params: zIdParam }, async ({ params, res }) => {
  await s.remove(params.id);
  res.status(204).end();
  return HANDLED;
}));
openingRouter.post('/opening-imports/:id/post', perm, handle({ params: zIdParam }, ({ params, user }) => s.post(params.id, user)));
openingRouter.post('/opening-imports/:id/cancel', perm, handle({ params: zIdParam, body: zReason }, ({ params, body, user }) => s.cancel(params.id, body.reason, user)));
