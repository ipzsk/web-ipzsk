import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from './cn'

// Focus opens a tooltip only right after keyboard navigation (Tab / arrows). Focus from a click, or handed
// back by a closing dialog, never does — otherwise the tip stays up over buttons the pointer has left.
let navKey = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => { navKey = e.key === 'Tab' || e.key.startsWith('Arrow') }, true)
  window.addEventListener('pointerdown', () => { navKey = false }, true)
}

// Non-hoverable content: the tip never holds itself open or sits between the pointer and other buttons.
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={300} skipDelayDuration={200} disableHoverableContent>{children}</T.Provider>
)

export function Tooltip({ content, children, side = 'top', open: forced, className }: {
  content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; open?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null) // asChild: any element, typed as Radix's default
  // The tip is positioned once; scrolling would leave it floating over something else.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', close, { capture: true })
  }, [open])
  const onOpenChange = (next: boolean) => {
    if (next && trigger.current && !trigger.current.matches(':hover') && !navKey) return
    setOpen(next)
  }
  return (
    <T.Root open={forced ?? open} onOpenChange={onOpenChange}>
      <T.Trigger asChild ref={trigger}>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn('pointer-events-none z-50 max-w-64 rounded-control bg-ink px-2.5 py-1.5 text-xs leading-5 text-card shadow-lg motion-safe:animate-fade-in', className)}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
