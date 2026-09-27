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

/**
 * §4.5: top-center under the header, max 3, 4s, pauses on hover (Radix), optional action.
 * 同标题的只留最新一条：连点几个案例会叠出一摞一模一样的「已填入输入框」。
 * 不能简单只留 1 条——带「撤销」的 toast（删除结果/素材/主体/模板）会被下一条顶掉，
 * 而删除已经落库，用户就没有撤销窗口了。
 */
export function toast(input: ToastInput) {
  const id = ++seq
  useToasts.setState(s => ({ items: [...s.items.filter(t => t.title !== input.title || t.action), { ...input, id, open: true }].slice(-MAX) }))
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
          // 整块上色，不只是标题：一行绿字在白底上根本不显眼，而 toast 的全部价值就是被看见。
          className={cn(
            'relative flex w-full items-start gap-3 rounded-card border p-4 pr-10 text-sm shadow-xl motion-safe:animate-fade-in',
            t.tone === 'error' ? 'border-transparent bg-danger text-white'
              : t.tone === 'success' ? 'border-transparent bg-success text-white'
                : 'border-line bg-card text-ink',
          )}
        >
          <div className="min-w-0 flex-1">
            <T.Title className="font-semibold">{t.title}</T.Title>
            {t.description && <T.Description className={cn('mt-1', !t.tone || t.tone === 'default' ? 'text-muted' : 'opacity-90')}>{t.description}</T.Description>}
          </div>
          {t.action && (
            <T.Action altText={t.action.label} asChild>
              <button type="button" className={buttonVariants({ variant: 'secondary', size: 'sm' })} onClick={t.action.onClick}>{t.action.label}</button>
            </T.Action>
          )}
          <T.Close aria-label="关闭" className={cn('absolute right-2 top-2 grid size-7 place-items-center rounded-[8px] opacity-70 hover:bg-card/20 hover:opacity-100', focusRing)}>
            <X className="size-4" />
          </T.Close>
        </T.Root>
      ))}
      {/* Clears the sticky SiteHeader (h-16 / h-[104px] under 720px — keep both in sync with SiteHeader). */}
      <T.Viewport className="fixed left-1/2 top-[76px] max-[720px]:top-[116px] embed:top-4! z-[60] flex w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 flex-col gap-2 outline-none" />
    </T.Provider>
  )
}
