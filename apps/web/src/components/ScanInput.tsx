import { useEffect, useRef, useState } from 'react';
import { Camera, ScanLine } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/**
 * Barcode / QR scan field (A§9). USB scanners type like keyboards and end with Enter; phone users can
 * type the code or scan it with the camera (where the browser can read barcodes). Calls `onScan`
 * with the trimmed code and clears itself for the next scan.
 */
export function ScanInput({
  onScan,
  placeholder = 'Scan or type code, then Enter',
  autoFocus,
  disabled,
}: {
  onScan: (code: string) => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [v, setV] = useState('');
  const [camera, setCamera] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const canCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  return (
    <div className="flex gap-1.5">
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          ref={ref}
          className="pl-8 font-mono"
          value={v}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          autoComplete="off"
          inputMode="text"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              const code = v.trim();
              if (!code) return;
              setV('');
              await onScan(code);
              ref.current?.focus();
            }
          }}
        />
      </div>
      {canCamera ? (
        <Button type="button" variant="outline" size="icon" disabled={disabled} onClick={() => setCamera(true)} aria-label="Scan with camera" title="Scan with camera">
          <Camera />
        </Button>
      ) : null}
      {camera ? (
        <CameraScanner
          onClose={() => setCamera(false)}
          onCode={async (code) => {
            setCamera(false);
            await onScan(code);
          }}
        />
      ) : null}
    </div>
  );
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Camera view that reads the first QR / barcode it sees (browser BarcodeDetector; Chrome on Android). */
function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
        const tick = async () => {
          if (done || !video.current) return;
          try {
            const found = await detector.detect(video.current);
            const code = found[0]?.rawValue?.trim();
            if (code) {
              done = true;
              cb.current(code);
              return;
            }
          } catch {
            // frame not ready — try the next one
          }
          timer = setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was refused.' : 'The camera could not be started.');
      }
    })();
    return () => {
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" title="Scan with camera" description="Point the camera at the QR code or barcode.">
        {error ? (
          <div className="rounded bg-red-50 p-3 text-sm text-destructive">{error}</div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
