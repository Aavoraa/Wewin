import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';
import { env } from '../config/env';
import { AppError } from './errors/app-error';

/**
 * Where uploaded and generated files live. Keys are always server-generated and validated by the
 * calling module (YYYY/MM/<uuid>.<ext>); this layer only stores bytes.
 * - disk (default): STORAGE_DIR/<area>/<key> — servers with a persistent disk (VM, Render).
 * - blob: Vercel Blob, private access (reads need the store token; no public URLs) — used on Vercel,
 *   whose functions have no persistent disk.
 */
export type StorageArea = 'attachments' | 'scans' | 'exports';

export const storageDriver = (): 'disk' | 'blob' => (env.STORAGE_DRIVER === 'blob' || (env.STORAGE_DRIVER === '' && !!process.env.BLOB_READ_WRITE_TOKEN && !!process.env.VERCEL) ? 'blob' : 'disk');

function diskPath(area: StorageArea, key: string) {
  const root = path.resolve(env.STORAGE_DIR, area);
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new AppError('VALIDATION_ERROR', 'Invalid file key', 400);
  return p;
}

export const fileStore = {
  async put(area: StorageArea, key: string, data: Buffer, contentType: string): Promise<void> {
    if (storageDriver() === 'blob') {
      await put(`${area}/${key}`, data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
      return;
    }
    const p = diskPath(area, key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx', mode: 0o600 });
  },

  async get(area: StorageArea, key: string): Promise<Buffer> {
    if (storageDriver() === 'blob') {
      const r = await get(`${area}/${key}`, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) throw new AppError('NOT_FOUND', 'The file is no longer available', 404);
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    }
    return readFile(diskPath(area, key));
  },

  async remove(area: StorageArea, key: string): Promise<void> {
    if (storageDriver() === 'blob') {
      await del(`${area}/${key}`).catch(() => undefined);
      return;
    }
    await rm(diskPath(area, key), { force: true });
  },
};
