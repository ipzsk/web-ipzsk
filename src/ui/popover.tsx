import type { ComponentProps } from 'react'
import { Popover as P } from 'radix-ui'
import { cn } from './cn'

export const Popover = P.Root
export const PopoverTrigger = P.Trigger
export const PopoverClose = P.Close

export function PopoverContent({ className, sideOffset = 8, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        className={cn('z-50 w-72 rounded-card border border-line bg-card p-4 text-sm text-ink shadow-xl outline-none motion-safe:animate-fade-in', className)}
        {...props}
      />
    </P.Portal>
  )
}
