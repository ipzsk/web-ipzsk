import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Checkbox as C, ToggleGroup } from 'radix-ui'
import { Check, LogIn, WifiOff, type LucideIcon } from 'lucide-react'
import { cn } from './cn'
import { Button, focusRing } from './button'
import { Tooltip } from './tooltip'

export const Skeleton = ({ className, ...props }: ComponentProps<'div'>) =>
  <div aria-hidden className={cn('rounded-control bg-subtle motion-safe:animate-pulse', className)} {...props} />

const badgeVariants = cva('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-subtle text-ink',
      acid: 'bg-acid-soft text-label',
      ink: 'bg-ink text-white',
      success: 'bg-success/12 text-success',
      warning: 'bg-warning/12 text-warning',
      danger: 'bg-danger/10 text-danger',
      outline: 'border border-line text-muted',
    },
  },
  defaultVariants: { tone: 'neutral' },
})
export const Badge = ({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) =>
  <span className={cn(badgeVariants({ tone }), className)} {...props} />

const fieldClass = cn(
  'w-full rounded-control border border-line bg-card px-3 text-sm text-ink placeholder:text-muted',
  'transition-colors duration-(--duration-fast) hover:border-muted',
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line',
  'aria-invalid:border-danger aria-invalid:hover:border-danger',
  focusRing, 'focus-visible:outline-offset-0 focus:border-acid focus:ring-3 focus:ring-acid/10',
)

type FieldExtras = { label?: string; error?: string; hint?: string; disabledReason?: string }

function Field({ id, label, error, hint, disabled, disabledReason, children }: FieldExtras & { id: string; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      {label && <label htmlFor={id} className="text-[13px] font-semibold text-ink">{label}</label>}
      {disabled && disabledReason ? <Tooltip content={disabledReason}><span className="grid" tabIndex={0}>{children}</span></Tooltip> : children}
      {error ? <p id={`${id}-msg`} className="text-xs text-danger">{error}</p> : hint ? <p id={`${id}-msg`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'> & FieldExtras>(function Input(
  { className, label, error, hint, disabledReason, id, ...props }, ref,
) {
  const auto = useId(); const fid = id ?? auto
  return (
    <Field id={fid} label={label} error={error} hint={hint} disabled={props.disabled} disabledReason={disabledReason}>
      <input ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error || hint ? `${fid}-msg` : undefined} className={cn(fieldClass, 'h-10', className)} {...props} />
    </Field>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'> & FieldExtras>(function Textarea(
  { className, label, error, hint, disabledReason, id, ...props }, ref,
) {
  const auto = useId(); const fid = id ?? auto
  return (
    <Field id={fid} label={label} error={error} hint={hint} disabled={props.disabled} disabledReason={disabledReason}>
      <textarea ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error || hint ? `${fid}-msg` : undefined} className={cn(fieldClass, 'min-h-20 py-2 leading-6 [field-sizing:content] max-h-[calc(8lh+1rem)]', className)} {...props} />
    </Field>
  )
})

export function Checkbox({ label, className, disabledReason, ...props }: ComponentProps<typeof C.Root> & { label: ReactNode; disabledReason?: string }) {
  const id = useId()
  const box = (
    <span className={cn('inline-flex items-center gap-2 text-sm', props.disabled && 'cursor-not-allowed opacity-45')}>
      <C.Root
        id={id}
        className={cn(
          'grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-[5px] border border-muted bg-card transition-colors duration-(--duration-fast)',
          'hover:border-ink data-[state=checked]:border-acid data-[state=checked]:bg-acid data-[state=checked]:text-white disabled:cursor-not-allowed',
          'aria-invalid:border-danger',
          focusRing, className,
        )}
        {...props}
      >
        <C.Indicator><Check className="size-3.5" strokeWidth={2.5} /></C.Indicator>
      </C.Root>
      <label htmlFor={id} className={props.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>{label}</label>
    </span>
  )
  return props.disabled && disabledReason ? <Tooltip content={disabledReason}><span tabIndex={0} className="inline-flex">{box}</span></Tooltip> : box
}

export interface SegmentOption<V extends string> { value: V; label: string; icon?: LucideIcon; disabledReason?: string }

export function SegmentedControl<V extends string>({ value, onValueChange, options, label, className }: {
  value: V; onValueChange: (v: V) => void; options: SegmentOption<V>[]; label: string; className?: string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={v => { if (v) onValueChange(v as V) }}
      className={cn('inline-flex h-9 items-center gap-0.5 rounded-control border border-line bg-card p-0.5', className)}
    >
      {options.map(o => {
        const Icon = o.icon
        const item = (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            disabled={!!o.disabledReason}
            className={cn(
              'inline-flex h-full cursor-pointer items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-semibold text-ink',
              'transition-colors duration-(--duration-fast) hover:bg-subtle',
              'data-[state=on]:bg-acid-soft data-[state=on]:text-label',
              'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent',
              focusRing,
            )}
          >
            {Icon && <Icon className="size-4" />}{o.label}
          </ToggleGroup.Item>
        )
        return o.disabledReason
          ? <Tooltip key={o.value} content={o.disabledReason}><span tabIndex={0} className="inline-flex h-full rounded-[8px]">{item}</span></Tooltip>
          : item
      })}
    </ToggleGroup.Root>
  )
}

/** §4.1 empty: 32px icon + one sentence + one primary action. */
/** Designer stickers (assets/stickers, 320px webp derived from the PNG originals). [width, height] reserve the box before load. */
const STICKERS = { board: [320, 345], brain: [320, 267], brush: [320, 293], camera: [320, 214], video: [320, 214] } as const
export type StickerName = keyof typeof STICKERS

/** Decorative: alt="" and lazy; ≤160px wide; only a fade (no movement), which reduced motion shortens to ~0. */
export function Sticker({ name }: { name: StickerName }) {
  return <img src={`/assets/stickers/sticker-${name}-320.webp`} alt="" width={STICKERS[name][0]} height={STICKERS[name][1]} loading="lazy" decoding="async" draggable={false} className="h-auto w-32 max-w-40 select-none motion-safe:animate-fade-in md:w-40" />
}

export function EmptyState({ icon: Icon, text, action, illustration }: { icon: LucideIcon; text: string; action?: { label: string; onClick: () => void }; illustration?: StickerName }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {illustration
        ? <Sticker name={illustration} />
        : <Icon className="size-8 text-muted" />}
      <p className="text-sm text-muted">{text}</p>
      {action && <Button variant="primary" size="sm" onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}

/** §4.2 long task without server progress: a moving sliver, never a percentage. Reduced motion → static faint track. */
export function IndeterminateBar({ label, className }: { label: string; className?: string }) {
  return (
    <div role="progressbar" aria-label={label} className={cn('h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-subtle', className)}>
      <div className="h-full w-2/5 rounded-full bg-ink motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:opacity-25" />
    </div>
  )
}

/** §4.1 error: reason (中文) + next step, shown in place. */
export function ErrorState({ reason, action }: { reason: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
      <span className="min-w-0 flex-1">{reason}</span>
      {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}

/** 401 during a signed-in session: same slot as the offline bar, one place for every view. */
export function SessionExpiredBanner({ loginHref }: { loginHref: string }) {
  return (
    <div role="alert" className="flex h-8 items-center justify-center gap-2 bg-danger text-xs text-card">
      <LogIn className="size-4" />登录已失效，需要重新登录才能继续生成和保存
      <a href={loginHref} className={cn('font-bold underline underline-offset-2', focusRing)}>重新登录</a>
    </div>
  )
}

export function OfflineBanner() {
  return (
    <div role="status" className="flex h-8 items-center justify-center gap-2 bg-ink text-xs text-white">
      <WifiOff className="size-4" />网络已断开，操作会在恢复后同步
    </div>
  )
}
