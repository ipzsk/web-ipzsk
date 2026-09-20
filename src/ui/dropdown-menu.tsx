import type { ComponentProps } from 'react'
import { DropdownMenu as M } from 'radix-ui'
import { Check } from 'lucide-react'
import { cn } from './cn'

export const DropdownMenu = M.Root
export const DropdownMenuTrigger = M.Trigger

// Exported so the states page can render each item state statically.
export const menuItemClass = cn(
  'relative flex h-9 cursor-pointer select-none items-center gap-2 rounded-[8px] px-2.5 text-sm text-ink outline-none',
  'transition-colors duration-(--duration-fast) hover:bg-subtle data-highlighted:bg-subtle',
  'data-disabled:cursor-not-allowed data-disabled:opacity-45 data-disabled:hover:bg-transparent',
  'aria-checked:font-semibold',
)

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-44 rounded-card border border-line bg-card p-1 shadow-xl motion-safe:animate-fade-in', className)}
        {...props}
      />
    </M.Portal>
  )
}

export function DropdownMenuItem({ className, danger, ...props }: ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return <M.Item className={cn(menuItemClass, danger && 'text-danger', className)} {...props} />
}

export function DropdownMenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(menuItemClass, 'pr-8', className)} {...props}>
      {children}
      <M.ItemIndicator className="absolute right-2.5"><Check className="size-4" /></M.ItemIndicator>
    </M.CheckboxItem>
  )
}

export const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof M.Separator>) =>
  <M.Separator className={cn('my-1 h-px bg-line', className)} {...props} />

export const DropdownMenuLabel = ({ className, ...props }: ComponentProps<typeof M.Label>) =>
  <M.Label className={cn('px-2.5 py-1.5 text-xs text-muted', className)} {...props} />
