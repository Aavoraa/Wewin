/**
 * Text layer of an uploaded document: words with normalised boxes (0–1, top-left origin) and a
 * confidence per word. Searchable PDF pages use their embedded text; pages without usable text
 * (scans) and images go through OCR. Replaceable: the extractors only see `PageLayout[]`.
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { type LayoutWord, type PageLayout } from '@wewin/shared';
import type * as PdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type * as Tesseract from 'tesseract.js';
import { env } from '../../../config/env';
import { AppError } from '../../../core/errors/app-error';
import { logger } from '../../../core/logger';

/** A page with fewer printable characters than this is treated as a scanned image. */
const MIN_TEXT_CHARS = 25;
/** OCR target width in pixels: small scans are enlarged, huge ones reduced. */
const OCR_WIDTH = 2200;

export interface TextLayer {
  pages: PageLayout[];
  textSource: 'PDF_TEXT' | 'OCR' | 'MIXED';
  warnings: string[];
}

type PdfjsModule = typeof PdfjsLib;
let pdfjs: PdfjsModule | null = null;
async function loadPdfjs() {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

// ───────── OCR ─────────
type Worker = Tesseract.Worker;

async function ocrWorker(): Promise<Worker> {
  const { createWorker } = await import('tesseract.js');
  const cachePath = path.resolve(env.STORAGE_DIR, 'ocr-cache');
  await mkdir(cachePath, { recursive: true });
  return createWorker('eng', 1, { cachePath, ...(env.OCR_LANG_PATH ? { langPath: env.OCR_LANG_PATH } : {}) });
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new AppError('SCAN_TIMEOUT', `${what} took longer than ${Math.round(ms / 1000)} s`, 504)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/** OCR one page image (PNG buffer) into normalised words. */
async function ocrImage(worker: Worker, png: Buffer, width: number, height: number, page: number): Promise<PageLayout> {
  const r = await withTimeout(worker.recognize(png, { rotateAuto: true }, { blocks: true, text: false }), env.SCAN_OCR_TIMEOUT_MS, `OCR of page ${page}`);
  const words: LayoutWord[] = [];
  for (const b of r.data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        for (const w of l.words) {
          const t = w.text.trim();
          if (!t) continue;
          words.push({ t, b: [w.bbox.x0 / width, w.bbox.y0 / height, w.bbox.x1 / width, w.bbox.y1 / height], c: Math.max(0, Math.min(1, w.confidence / 100)) });
        }
      }
    }
  }
  return { page, width, height, ocr: true, words };
}

/** Normalise an image for OCR: decode, scale to a readable width, flatten onto white. */
async function prepareImage(buf: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  let img;
  try {
    img = await loadImage(buf);
  } catch {
    throw new AppError('SCAN_UNREADABLE', 'The image could not be decoded', 422);
  }
  if (img.width < 200 || img.height < 200) throw new AppError('SCAN_UNREADABLE', 'The image is too small to read (under 200 px)', 422);
  const scale = Math.min(3, OCR_WIDTH / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0, w, h);
  return { png: c.toBuffer('image/png'), width: w, height: h };
}

// ───────── PDF text ─────────
interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Split a PDF text run into words, spreading its width over the characters. */
function runToWords(item: TextItem, vt: number[], pageW: number, pageH: number, mul: (a: number[], b: number[]) => number[]): LayoutWord[] {
  const tx = mul(vt, item.transform);
  const fontH = Math.hypot(tx[2]!, tx[3]!);
  const x = tx[4]!;
  const y = tx[5]!;
  const width = item.width * Math.hypot(vt[0]!, vt[1]!);
  const str = item.str;
  const per = str.length ? width / str.length : 0;
  const out: LayoutWord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) {
    const x0 = x + per * m.index;
    const x1 = x0 + per * m[0].length;
    out.push({ t: m[0], b: [x0 / pageW, (y - fontH) / pageH, x1 / pageW, y / pageH], c: 0.99 });
  }
  return out;
}

export async function readTextLayer(buf: Buffer, mime: string): Promise<TextLayer> {
  const warnings: string[] = [];
  if (mime !== 'application/pdf') {
    const { png, width, height } = await prepareImage(buf);
    const worker = await ocrWorker();
    try {
      const page = await ocrImage(worker, png, width, height, 1);
      if (!page.words.length) throw new AppError('SCAN_EMPTY', 'No text could be read from this image (blank or too blurred)', 422);
      return { pages: [page], textSource: 'OCR', warnings };
    } finally {
      await worker.terminate();
    }
  }

  const lib = await loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  } catch (err) {
    const msg = err instanceof Error && /password/i.test(err.message) ? 'The PDF is password-protected' : 'The PDF could not be opened (damaged or unsupported)';
    throw new AppError('SCAN_UNREADABLE', msg, 422);
  }
  const count = doc.numPages;
  if (count > env.SCAN_MAX_PAGES) warnings.push(`Only the first ${env.SCAN_MAX_PAGES} of ${count} pages were read`);
  const pages: PageLayout[] = [];
  let worker: Worker | null = null;
  try {
    for (let n = 1; n <= Math.min(count, env.SCAN_MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const words = (tc.items as TextItem[]).filter((i) => 'str' in i && i.str.trim()).flatMap((i) => runToWords(i, vp.transform, vp.width, vp.height, lib.Util.transform));
      const chars = words.reduce((a, w) => a + w.t.length, 0);
      if (chars >= MIN_TEXT_CHARS) {
        pages.push({ page: n, width: vp.width, height: vp.height, ocr: false, words });
        continue;
      }
      // Scanned page: render and OCR.
      const scale = Math.min(4, OCR_WIDTH / vp.width);
      const rvp = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(rvp.width), Math.ceil(rvp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as never, viewport: rvp, canvas: canvas as never }).promise;
      worker ??= await ocrWorker();
      const ocr = await ocrImage(worker, canvas.toBuffer('image/png'), canvas.width, canvas.height, n);
      pages.push({ ...ocr, width: vp.width, height: vp.height });
    }
  } finally {
    if (worker) await worker.terminate().catch((err: unknown) => logger.warn({ err }, 'OCR worker did not stop cleanly'));
    await doc.destroy();
  }
  const ocrPages = pages.filter((p) => p.ocr).length;
  const textSource = ocrPages === 0 ? 'PDF_TEXT' : ocrPages === pages.length ? 'OCR' : 'MIXED';
  if (pages.every((p) => p.words.length === 0)) throw new AppError('SCAN_EMPTY', 'No text could be read from this document', 422);
  return { pages, textSource, warnings };
}
