import { type ComponentProps } from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;

export function DropdownMenuContent({ className, ...p }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={4} className={cn('z-50 min-w-40 rounded-md border bg-card p-1 text-sm shadow-lg', className)} {...p} />
    </M.Portal>
  );
}

export function DropdownMenuItem({ className, ...p }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4',
        className,
      )}
      {...p}
    />
  );
}

export function DropdownMenuCheckboxItem({ className, children, ...p }: ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem
      className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent', className)}
      {...p}
    >
      <span className="inline-flex size-4 items-center justify-center rounded border text-[10px]">
        <M.ItemIndicator>✓</M.ItemIndicator>
      </span>
      {children}
    </M.CheckboxItem>
  );
}

export function DropdownMenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ className, ...p }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2 py-1 text-xs text-muted-foreground', className)} {...p} />;
}
