import { type ComponentProps } from 'react';
import * as P from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;

export function PopoverContent({ className, ...p }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={4}
        align="start"
        className={cn('z-50 rounded-md border bg-card p-0 shadow-lg outline-none', className)}
        {...p}
      />
    </P.Portal>
  );
}
