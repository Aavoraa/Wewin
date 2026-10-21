import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from '../../core/errors/app-error';
import { fileStore } from '../../core/storage';

export const MAX_SCAN_BYTES = 10 * 1024 * 1024;

export type ScanMime = 'application/pdf' | 'image/jpeg' | 'image/png';

/** Identify the file by its content (magic bytes), never by the name or the browser's MIME claim. */
export function sniff(buf: Buffer): ScanMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

const EXT: Record<ScanMime, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
/** Only server-generated keys are accepted (path traversal and foreign keys refused). */
function checkKey(key: string): string {
  if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(key)) throw new AppError('VALIDATION_ERROR', 'Invalid file key', 400);
  return key;
}

/**
 * Validate and store an upload under a server-generated name (YYYY/MM/<uuid>.<ext>) in private
 * storage. Rejects empty, oversized, mislabelled and unsupported files.
 */
export async function storeUpload(file: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
  if (!file.size || !file.buffer.length) throw new AppError('VALIDATION_ERROR', 'The file is empty', 400);
  if (file.size > MAX_SCAN_BYTES) throw new AppError('VALIDATION_ERROR', 'The file is larger than 10 MB', 400);
  const mime = sniff(file.buffer);
  if (!mime) throw new AppError('VALIDATION_ERROR', 'Only PDF, JPG and PNG files can be scanned', 400);
  const claimed = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
  if (claimed && claimed !== 'application/octet-stream' && claimed !== mime) {
    throw new AppError('VALIDATION_ERROR', `The file content is ${EXT[mime].toUpperCase()} but it was sent as ${file.mimetype}`, 400);
  }
  if (mime === 'application/pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(file.buffer.toString('latin1'))) {
    throw new AppError('VALIDATION_ERROR', 'This PDF contains scripts or embedded files and cannot be accepted', 400);
  }
  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXT[mime]}`;
  await fileStore.put('scans', checkKey(key), file.buffer, mime);
  return {
    key,
    mime,
    size: file.size,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
    // Keep a display name only: no path parts, control characters or overlong names.
    originalName: path.basename(file.originalname).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || `invoice.${EXT[mime]}`,
  };
}

export const readStored = (key: string) => fileStore.get('scans', checkKey(key));
export const removeStored = (key: string) => fileStore.remove('scans', checkKey(key));
