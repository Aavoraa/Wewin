import { type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        draft: 'bg-slate-100 text-slate-700 ring-1 ring-slate-300',
        posted: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200',
        closed: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
        cancelled: 'bg-red-50 text-red-700 ring-1 ring-red-200 line-through',
        success: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
        warning: 'bg-amber-50 text-amber-800 ring-1 ring-amber-300',
        danger: 'bg-red-50 text-red-700 ring-1 ring-red-200',
        info: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badge>['variant']>;

export function Badge({ className, variant, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ variant }), className)} {...p} />;
}
