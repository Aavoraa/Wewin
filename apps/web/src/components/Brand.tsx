import { cn } from '@/lib/utils';

/**
 * Wewin Knit Fashions' own logo (the file supplied by Wewin, white background made transparent).
 * `onDark` uses the variant whose black lettering is white, for the charcoal sidebar and panels.
 */
const LOGO = { light: '/brand/wewin-logo.png', dark: '/brand/wewin-logo-on-dark.png' };
const MARK = { light: '/brand/wewin-mark.png', dark: '/brand/wewin-mark-on-dark.png' };

/** The W mark alone (collapsed sidebar, phone header, small places). */
export function WewinMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return <img src={onDark ? MARK.dark : MARK.light} alt="" className={cn('h-6 w-auto shrink-0 object-contain', className)} />;
}

/** The full logo: the W mark, "Wewin Knit Fashions" and "Manufacturers & Exporters of Hosiery Garments". */
export function WewinBrand({
  onDark = false,
  compact = false,
  tight = false,
  className,
}: {
  onDark?: boolean;
  compact?: boolean;
  /** Narrow places (the sidebar). */
  tight?: boolean;
  className?: string;
}) {
  if (compact) return <WewinMark onDark={onDark} className={className} />;
  return (
    <img
      src={onDark ? LOGO.dark : LOGO.light}
      alt="Wewin Knit Fashions — Manufacturers & Exporters of Hosiery Garments"
      className={cn('block w-auto max-w-full object-contain object-left', tight ? 'h-[22px]' : 'h-9', className)}
    />
  );
}
