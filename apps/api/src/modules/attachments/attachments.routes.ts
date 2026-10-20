import { type RequestHandler, Router } from 'express';
import multer from 'multer';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_OWNERS, type AttachmentOwner, zAttachmentOwner, zIdParam } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { AppError } from '../../core/errors/app-error';
import { HANDLED, handle } from '../../core/http';
import { attachmentsService as s } from './attachments.service';

/**
 * /api/v1/attachments — files on documents (≤ 10 MB; PDF, JPG, PNG, XLSX). Access follows the
 * owning document's view permission (checked in the service).
 */
export const attachmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1, fields: 4 } });
const single: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) return next(new AppError('VALIDATION_ERROR', err.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 10 MB' : 'Upload one file in the "file" field', 400));
    next(err);
  });

/** The owning document's view permission, read from the request (list / upload). */
const requireOwnerView: RequestHandler = (req, res, next) => {
  const type = (req.query.ownerType ?? (req.body as { ownerType?: string } | undefined)?.ownerType) as AttachmentOwner | undefined;
  const perm = type ? ATTACHMENT_OWNERS[type] : undefined;
  if (!perm) return next(new AppError('VALIDATION_ERROR', 'Unknown document type', 400));
  return requirePermission(perm)(req, res, next);
};
// File and delete routes: the owner is known only after loading the attachment; the service checks it.
const authenticated = requirePermission();

attachmentsRouter.get('/attachments', requireOwnerView, handle({ query: zAttachmentOwner }, ({ query, user }) => s.list(query.ownerType, query.ownerId, user)));
attachmentsRouter.post('/attachments', requirePermission('attachments.upload'), single, requireOwnerView, handle({ body: zAttachmentOwner }, ({ body, req, user }) => s.upload(body.ownerType, body.ownerId, req.file, user), { status: 201 }));
attachmentsRouter.get('/attachments/:id/file', authenticated, handle({ params: zIdParam }, async ({ params, user, res }) => {
  const f = await s.file(params.id, user);
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${f.mime.startsWith('image/') || f.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(f.buf);
  return HANDLED;
}));
attachmentsRouter.delete('/attachments/:id', requirePermission('attachments.upload'), handle({ params: zIdParam }, async ({ params, user, res }) => {
  await s.remove(params.id, user);
  res.status(204).end();
  return HANDLED;
}));
