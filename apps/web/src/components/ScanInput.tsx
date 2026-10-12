import { useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Input } from './ui/input';

/**
 * Barcode / QR scan field (A§9). USB scanners type like keyboards and end with Enter; phone users can
 * type the code. Calls `onScan` with the trimmed code and clears itself for the next scan.
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
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
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
  );
}
