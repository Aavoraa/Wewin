import { type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom border-collapse text-sm', className)} {...p} />;
}
export function THead({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('sticky top-0 z-10 bg-muted', className)} {...p} />;
}
export function TBody(p: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...p} />;
}
export function TFoot({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={cn('border-t-2 bg-muted/60 font-semibold', className)} {...p} />;
}
export function TR({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b last:border-0', className)} {...p} />;
}
export function TH({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('h-8 whitespace-nowrap px-2.5 text-left text-xs font-semibold text-muted-foreground', className)}
      {...p}
    />
  );
}
export function TD({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-2.5 py-1.5 align-middle', className)} {...p} />;
}
