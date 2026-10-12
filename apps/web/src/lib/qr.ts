import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** QR code as a data URL (bundle tickets, roll and carton labels — A§11). */
export function useQr(text: string, size = 160): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [text, size]);
  return url;
}
