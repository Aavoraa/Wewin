import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_OWNERS, type AttachmentOwner } from '@wewin/shared';
import { env } from '../../config/env';
import { withTx } from '../../core/db';
import { AppError, notFound } from '../../core/errors/app-error';
import { assertPermission } from '../../core/auth/auth.middleware';
import { type CurrentUser } from '../../core/auth/auth.types';
import { attachmentsRepo as repo } from './attachments.repo';

type Kind = 'application/pdf' | 'image/jpeg' | 'image/png' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXT: Record<Kind, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
const root = () => path.resolve(env.STORAGE_DIR, 'attachments');

/** Identify by content: PDF, JPEG, PNG, or an Office Open XML workbook (zip with xl/ parts). */
export function sniffAttachment(buf: Buffer): Kind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const s = buf.toString('latin1');
    if (s.includes('[Content_Types].xml') && s.includes('xl/')) {
      // Macro-enabled workbooks (vbaProject) are refused.
      return s.includes('vbaProject') ? null : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }
  return null;
}

function keyPath(key: string) {
  if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|jpg|png|xlsx)$/.test(key)) throw new AppError('VALIDATION_ERROR', 'Invalid file key', 400);
  return path.resolve(root(), key);
}

function canSee(user: CurrentUser, ownerType: AttachmentOwner) {
  assertPermission(user, ATTACHMENT_OWNERS[ownerType]);
}

export const attachmentsService = {
  async list(ownerType: AttachmentOwner, ownerId: string, user: CurrentUser) {
    canSee(user, ownerType);
    const rows = await repo.list(ownerType, ownerId);
    const names = new Map((await repo.uploaderNames([...new Set(rows.map((r) => r.uploadedById))])).map((u) => [u.id, u.fullName]));
    return rows.map(({ fileKey: _k, ...r }) => ({ ...r, uploadedBy: names.get(r.uploadedById) ?? '' }));
  },

  async upload(ownerType: AttachmentOwner, ownerId: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, user: CurrentUser) {
    assertPermission(user, 'attachments.upload');
    canSee(user, ownerType);
    if (!file || !file.size) throw new AppError('VALIDATION_ERROR', 'Choose a file to attach', 400);
    if (file.size > ATTACHMENT_MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'The file is larger than 10 MB', 400);
    const kind = sniffAttachment(file.buffer);
    if (!kind) throw new AppError('VALIDATION_ERROR', 'Only PDF, JPG, PNG and XLSX (no macros) files can be attached', 400);
    if (kind === 'application/pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(file.buffer.toString('latin1'))) {
      throw new AppError('VALIDATION_ERROR', 'This PDF contains scripts or embedded files and cannot be accepted', 400);
    }
    if (!(await repo.ownerExists(ownerType, ownerId))) throw notFound('Document');
    const now = new Date();
    const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXT[kind]}`;
    const p = keyPath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      return await withTx(
        (tx) =>
          repo.create(tx, {
            ownerType,
            ownerId,
            fileKey: key,
            originalName: path.basename(file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || `file.${EXT[kind]}`,
            mimeType: kind,
            sizeBytes: file.size,
            uploadedById: user.id,
          }),
        { isolation: 'ReadCommitted' },
      );
    } catch (err) {
      await rm(p, { force: true });
      throw err;
    }
  },

  async file(id: string, user: CurrentUser) {
    const a = await repo.get(id);
    if (!a) throw notFound('Attachment');
    canSee(user, a.ownerType as AttachmentOwner);
    return { buf: await readFile(keyPath(a.fileKey)), mime: a.mimeType, name: a.originalName };
  },

  /** Remove: the uploader, or anyone allowed to upload, while seeing the document (row audit records it). */
  async remove(id: string, user: CurrentUser) {
    assertPermission(user, 'attachments.upload');
    const a = await repo.get(id);
    if (!a) throw notFound('Attachment');
    canSee(user, a.ownerType as AttachmentOwner);
    await withTx((tx) => repo.remove(tx, id), { isolation: 'ReadCommitted' });
    await rm(keyPath(a.fileKey), { force: true });
  },
};
