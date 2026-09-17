import { Toast as T } from 'radix-ui'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { cn } from './cn'
import { buttonVariants, focusRing } from './button'

export interface ToastInput {
  title: string
  description?: string
  tone?: 'default' | 'error' | 'success'
  /** e.g. { label: '撤销', onClick } */
  action?: { label: string; onClick: () => void }
  duration?: number
}
interface ToastItem extends ToastInput { id: number; open: boolean }

let seq = 0
const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
const MAX = 3

/** §4.5: bottom-right, max 3, 4s, pauses on hover (Radix), optional action. */
export function toast(input: ToastInput) {
  const id = ++seq
  useToasts.setState(s => ({ items: [...s.items, { ...input, id, open: true }].slice(-MAX) }))
  return id
}
const remove = (id: number) => useToasts.setState(s => ({ items: s.items.filter(t => t.id !== id) }))

export function Toaster() {
  const items = useToasts(s => s.items)
  return (
    <T.Provider duration={4000} label="通知" swipeDirection="up">
      {items.map(t => (
        <T.Root
          key={t.id}
          duration={t.duration}
          onOpenChange={open => { if (!open) remove(t.id) }}
          className={cn(
            'relative flex w-full items-start gap-3 rounded-card border border-line bg-card p-4 pr-10 text-sm text-ink shadow-xl motion-safe:animate-fade-in',
            t.tone === 'error' && 'border-danger/40',
          )}
        >
          <div className="min-w-0 flex-1">
            <T.Title className={cn('font-semibold', t.tone === 'error' && 'text-danger', t.tone === 'success' && 'text-success')}>{t.title}</T.Title>
            {t.description && <T.Description className="mt-1 text-muted">{t.description}</T.Description>}
          </div>
          {t.action && (
            <T.Action altText={t.action.label} asChild>
              <button type="button" className={buttonVariants({ variant: 'secondary', size: 'sm' })} onClick={t.action.onClick}>{t.action.label}</button>
            </T.Action>
          )}
          <T.Close aria-label="关闭" className={cn('absolute right-2 top-2 grid size-7 place-items-center rounded-[8px] text-muted hover:bg-subtle', focusRing)}>
            <X className="size-4" />
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="fixed left-1/2 top-4 z-[60] flex w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 flex-col gap-2 outline-none" />
    </T.Provider>
  )
}
