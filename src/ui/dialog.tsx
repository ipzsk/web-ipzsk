import type { ComponentProps, ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { cn } from './cn'
import { IconButton } from './button'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({ className, title, description, children, ...props }: ComponentProps<typeof D.Content> & {
  title: ReactNode; description?: ReactNode
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/40 motion-safe:animate-fade-in" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-card p-6 shadow-2xl outline-none motion-safe:animate-fade-in',
          className,
        )}
        {...props}
      >
        <D.Title className="pr-8 text-lg font-bold">{title}</D.Title>
        {description ? <D.Description className="mt-2 text-sm leading-6 text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        <div className="mt-5">{children}</div>
        <D.Close asChild><IconButton label="关闭" size="icon-sm" className="absolute right-4 top-4"><X className="size-4" /></IconButton></D.Close>
      </D.Content>
    </D.Portal>
  )
}

export const DialogFooter = ({ className, ...props }: ComponentProps<'div'>) =>
  <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />
