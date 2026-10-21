import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';

const blob = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(async () => ({ statusCode: 200, stream: new Blob([Buffer.from('%PDF-1.4 hello')]).stream() })),
  del: vi.fn(async () => undefined),
}));
vi.mock('@vercel/blob', () => blob);

const { fileStore, storageDriver } = await import('./storage');

describe('file storage on Vercel Blob', () => {
  beforeAll(() => {
    env.STORAGE_DRIVER = 'blob';
  });
  afterAll(() => {
    env.STORAGE_DRIVER = '';
  });

  it('stores, reads and removes files as private blobs under <area>/<key>, never public', async () => {
    expect(storageDriver()).toBe('blob');
    await fileStore.put('attachments', '2026/10/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf', Buffer.from('%PDF-1.4 hello'), 'application/pdf');
    expect(blob.put).toHaveBeenCalledWith('attachments/2026/10/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf', expect.any(Buffer), expect.objectContaining({ access: 'private', addRandomSuffix: false, allowOverwrite: false }));
    const buf = await fileStore.get('attachments', '2026/10/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf');
    expect(buf.toString()).toBe('%PDF-1.4 hello');
    expect(blob.get).toHaveBeenCalledWith('attachments/2026/10/1b4e28ba-2fa1-11d2-883f-0016d3cca427.pdf', expect.objectContaining({ access: 'private' }));
    await fileStore.remove('exports', 'abc.xlsx');
    expect(blob.del).toHaveBeenCalledWith('exports/abc.xlsx');
  });

  it('reports a missing blob as not found', async () => {
    blob.get.mockResolvedValueOnce(null as never);
    await expect(fileStore.get('scans', '2026/10/x.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
