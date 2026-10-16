import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Highlight {
  page: number;
  box: [number, number, number, number];
}

/**
 * The original document, fetched with the user's token (never a public URL), rendered with pdf.js
 * or as an image. The selected field's source region is outlined on the page.
 */
export function DocumentPreview({ fileUrl, mime, highlight, pageCount }: { fileUrl: string; mime: string; highlight: Highlight | null; pageCount: number | null }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const isPdf = mime === 'application/pdf';
  const pages = pdf?.numPages ?? pageCount ?? 1;

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    api
      .blob(fileUrl.replace(/^\/api\/v1/, ''))
      .then(async (b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setBlobUrl(url);
        if (isPdf) setPdf(await pdfjs.getDocument({ data: new Uint8Array(await b.arrayBuffer()), isEvalSupported: false }).promise);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileUrl, isPdf]);

  // Images: re-measure after zoom so the highlight box scales with the picture.
  useEffect(() => {
    if (isPdf || !imgRef.current) return;
    const id = requestAnimationFrame(() => imgRef.current && imgRef.current.complete && setSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight }));
    return () => cancelAnimationFrame(id);
  }, [zoom, blobUrl, isPdf]);

  // Jump to the page of the selected value.
  useEffect(() => {
    if (highlight?.page && highlight.page !== page) setPage(highlight.page);
  }, [highlight, page]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !wrapRef.current) return;
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const p = await pdf.getPage(Math.min(page, pdf.numPages));
      const base = p.getViewport({ scale: 1 });
      const width = Math.max(320, wrapRef.current!.clientWidth - 18) * zoom;
      const vp = p.getViewport({ scale: width / base.width });
      const dpr = window.devicePixelRatio || 1;
      const c = canvasRef.current!;
      c.width = Math.floor(vp.width * dpr);
      c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      if (cancelled) return;
      task = p.render({ canvas: c, viewport: p.getViewport({ scale: (width / base.width) * dpr }) });
      await task.promise.catch(() => undefined);
      if (!cancelled) setSize({ w: vp.width, h: vp.height });
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom]);

  // Keep the highlighted region in view.
  useEffect(() => {
    if (!highlight || !size || !wrapRef.current) return;
    const el = wrapRef.current;
    el.scrollTo({ top: Math.max(0, highlight.box[1] * size.h - el.clientHeight / 3), left: Math.max(0, highlight.box[0] * size.w - 40), behavior: 'smooth' });
  }, [highlight, size]);

  const showBox = highlight && highlight.page === page && size;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b bg-card px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft />
          </Button>
          <span className="text-xs tabular-nums">
            Page {page} / {pages}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" disabled={zoom <= 0.6} onClick={() => setZoom((z) => Math.round((z - 0.2) * 10) / 10)}>
            <ZoomOut />
          </Button>
          <span className="w-10 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.round((z + 0.2) * 10) / 10)}>
            <ZoomIn />
          </Button>
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-auto p-0">
        {error ? <p className="p-4 text-sm text-destructive">{error}</p> : null}
        <div className="relative inline-block">
          {isPdf ? (
            <canvas ref={canvasRef} className="block bg-white" />
          ) : blobUrl ? (
            <img
              ref={imgRef}
              src={blobUrl}
              alt="Uploaded invoice"
              style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              className="block bg-white"
              onLoad={(e) => setSize({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })}
            />
          ) : null}
          {showBox ? (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-sm border-2 border-amber-500 bg-amber-300/25 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]"
              style={{
                left: highlight.box[0] * size.w - 3,
                top: highlight.box[1] * size.h - 3,
                width: (highlight.box[2] - highlight.box[0]) * size.w + 6,
                height: (highlight.box[3] - highlight.box[1]) * size.h + 6,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
