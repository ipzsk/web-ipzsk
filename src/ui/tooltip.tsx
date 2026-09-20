import type { ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from './cn'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={300} skipDelayDuration={200}>{children}</T.Provider>
)

export function Tooltip({ content, children, side = 'top', open, className }: {
  content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; open?: boolean; className?: string
}) {
  return (
    <T.Root open={open}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn('z-50 max-w-64 rounded-control bg-ink px-2.5 py-1.5 text-xs leading-5 text-card shadow-lg motion-safe:animate-fade-in', className)}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
