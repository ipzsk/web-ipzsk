import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { cn } from './cn'
import { Tooltip } from './tooltip'

// Shared by every clickable control so the §4.1 matrix stays identical everywhere.
export const focusRing = 'outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid-deep'

export const buttonVariants = cva(
  cn(
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold cursor-pointer',
    'transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-(--ease-standard)',
    'motion-safe:active:scale-[.98] aria-disabled:cursor-not-allowed aria-disabled:opacity-45 aria-disabled:active:scale-100',
    'disabled:cursor-not-allowed disabled:opacity-45',
    focusRing,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-acid text-white shadow-[0_8px_19px_rgb(29_113_251/.22)] hover:bg-acid-deep aria-selected:ring-2 aria-selected:ring-acid-deep',
        secondary: 'border border-line bg-card text-ink hover:border-muted hover:bg-subtle aria-pressed:bg-acid-soft aria-pressed:text-label aria-pressed:border-acid',
        ghost: 'text-ink hover:bg-subtle aria-pressed:bg-acid-soft aria-pressed:text-label',
        danger: 'bg-danger text-card hover:bg-danger/90',
        'danger-ghost': 'text-danger hover:bg-danger/8',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-5 text-[15px]',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

/** §4.2: show loading only if it lasts >300ms; once shown, keep it ≥500ms. */
export function useDelayedLoading(loading: boolean, delay = 300, minVisible = 500) {
  const [visible, setVisible] = useState(false)
  const shownAt = useRef(0)
  useEffect(() => {
    if (loading && !visible) {
      const t = setTimeout(() => { shownAt.current = Date.now(); setVisible(true) }, delay)
      return () => clearTimeout(t)
    }
    if (!loading && visible) {
      const t = setTimeout(() => setVisible(false), Math.max(0, minVisible - (Date.now() - shownAt.current)))
      return () => clearTimeout(t)
    }
  }, [loading, visible, delay, minVisible])
  return visible
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean
  /** Progressive label while loading, e.g. 「生成中」. Width never changes. */
  loadingText?: ReactNode
  /** Shown as a tooltip when disabled (§4.1: every disabled control explains why). */
  disabledReason?: string
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, loadingText, disabled, disabledReason, icon, children, onClick, type = 'button', ...props },
  ref,
) {
  const showSpinner = useDelayedLoading(loading)
  const busy = loading || showSpinner
  const blocked = disabled || busy
  const label = (
    <>
      {showSpinner ? <LoaderCircle aria-hidden className="size-[18px] motion-safe:animate-spin-slow" /> : icon}
      {children}
    </>
  )
  const button = (
    <button
      ref={ref}
      type={type}
      // aria-disabled (not disabled) keeps the button hoverable/focusable so the reason tooltip can show.
      aria-disabled={blocked || undefined}
      aria-busy={busy || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={e => { if (blocked) { e.preventDefault(); return } onClick?.(e) }}
      {...props}
    >
      {loadingText !== undefined ? (
        <span className="grid">
          <span className={cn('col-start-1 row-start-1 inline-flex items-center justify-center gap-2', showSpinner && 'invisible')}>{icon}{children}</span>
          <span aria-hidden={!showSpinner} className={cn('col-start-1 row-start-1 inline-flex items-center justify-center gap-2', !showSpinner && 'invisible')}>
            <LoaderCircle aria-hidden className="size-[18px] motion-safe:animate-spin-slow" />{loadingText}
          </span>
        </span>
      ) : label}
    </button>
  )
  return disabled && disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button
})

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon' | 'loadingText'> {
  /** Required: becomes aria-label and the hover tooltip. */
  label: string
  children: ReactNode
  /** Tooltip placement; default top. */
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, size = 'icon', variant = 'ghost', disabled, disabledReason, tooltipSide, ...props },
  ref,
) {
  const button = <Button ref={ref} aria-label={label} size={size} variant={variant} disabled={disabled} {...props}>{children}</Button>
  return <Tooltip side={tooltipSide} content={disabled && disabledReason ? disabledReason : label}>{button}</Tooltip>
})
