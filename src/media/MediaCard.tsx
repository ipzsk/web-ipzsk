import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { AlertCircle, Check, LoaderCircle, RotateCw } from 'lucide-react'
import { Tooltip } from '@/ui/tooltip'
import { cn } from './cn'
import { MediaImage } from './MediaImage'
import { MediaVideo } from './MediaVideo'
import { useMediaDraggable } from './dnd'
import type { MediaAsset } from './types'

export type CardState =
  | { kind: 'uploading'; progress: number }
  | { kind: 'generating' }
  | { kind: 'failed'; reason: string; onRetry?: () => void }

type Mods = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }

type Props = {
  asset: MediaAsset
  title: string
  /** Hover overlay content (bottom gradient): e.g. author + action buttons. */
  overlay?: ReactNode
  state?: CardState
  priority?: boolean
  onOpen?: () => void
  /** Selection: pass both to show the checkbox. */
  selected?: boolean
  onSelect?: (mods: Mods) => void
  /** True when any card is selected: plain click then toggles instead of opening. */
  selectionMode?: boolean
  /** Assets carried when this card is dragged (the whole selection when this card is part of it). Omit to disable drag. */
  dragItems?: MediaAsset[]
  /** Reason string disables the card. */
  disabled?: string
  onExpired?: () => void
  className?: string
}

export function MediaCard({ asset, title, overlay, state, priority, onOpen, selected, onSelect, selectionMode, dragItems, disabled, onExpired, className }: Props) {
  const drag = useMediaDraggable(`card:${asset.id}`, dragItems ?? [], !dragItems || !!disabled || state?.kind === 'uploading')
  const selectable = !!onSelect && !disabled

  const onClick = (e: MouseEvent) => {
    if (disabled) return
    if (selectable && (e.shiftKey || e.metaKey || e.ctrlKey || selectionMode)) onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
    else onOpen?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || disabled) return
    if (e.key === 'Enter') { e.preventDefault(); onOpen?.() }
    else if (e.key === ' ') {
      e.preventDefault()
      const v = e.currentTarget.querySelector('video')
      if (v && !selectionMode) { if (v.paused) v.play().catch(() => {}); else v.pause() }
      else if (selectable) onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey })
    }
  }

  const card = (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      // group, not button: the card holds its own buttons (select, overlay actions) and a button can't contain buttons.
      // Enter opens / Space selects via onKeyDown; selection state is announced by the checkbox.
      role="group"
      tabIndex={0}
      aria-label={title}
      aria-disabled={disabled ? true : undefined}
      aria-roledescription={dragItems ? '可拖拽卡片' : '卡片'}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative block h-full w-full select-none overflow-hidden rounded-card bg-subtle outline-offset-2',
        'transition-[transform,box-shadow,opacity] duration-fast ease-standard',
        'hover:-translate-y-px hover:shadow-[0_9px_24px_rgb(29_113_251/.12)] active:scale-[.98] motion-reduce:transform-none',
        dragItems && !disabled && 'cursor-grab',
        !dragItems && !disabled && 'cursor-pointer',
        selected && 'ring-2 ring-acid shadow-[0_0_0_5px_rgb(29_113_251/.12),0_9px_24px_rgb(29_113_251/.12)]',
        drag.isDragging && 'opacity-40',
        disabled && 'cursor-not-allowed opacity-45 hover:translate-y-0 hover:shadow-none',
        className,
      )}
    >
      {asset.kind === 'video'
        ? <MediaVideo asset={asset} label={title} focusable={false} className="h-full w-full" />
        : <MediaImage asset={asset} alt={title} priority={priority} onExpired={onExpired} className="h-full w-full" hideBadge={!!state} />}

      {/* hover / focus overlay */}
      {(overlay || title) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-ink/90 via-ink/60 to-transparent p-3 pt-10 text-card opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:hidden">
          <p className="truncate text-sm font-medium">{title}</p>
          {overlay && <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{overlay}</div>}
        </div>
      )}

      {onSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!selected}
          aria-label={selected ? `取消选择 ${title}` : `选择 ${title}`}
          disabled={!!disabled}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onSelect({ shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey }) }}
          className={cn(
            'absolute left-2 top-2 grid size-6 place-items-center rounded-full border-2 transition-[opacity,background-color,transform] duration-fast active:scale-[.9] motion-reduce:active:scale-100',
            selected ? 'border-acid bg-acid text-white opacity-100 shadow-[0_4px_12px_rgb(29_113_251/.3)]' : 'border-card bg-ink/30 text-transparent opacity-0 hover:bg-ink/50 group-hover:opacity-100 focus-visible:opacity-100',
            selectionMode && 'opacity-100',
            '[@media(hover:none)]:opacity-100',
          )}
        >
          <Check size={14} strokeWidth={3} aria-hidden />
        </button>
      )}

      {state && <StateBadge state={state} />}
    </div>
  )
  return disabled ? <Tooltip content={disabled}>{card}</Tooltip> : card
}

function StateBadge({ state }: { state: CardState }) {
  if (state.kind === 'failed') {
    return (
      <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/85 p-3 text-center">
        <AlertCircle size={20} className="text-danger" aria-hidden />
        <p className="text-xs text-ink">{state.reason}</p>
        {state.onRetry && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); state.onRetry!() }}
            className="inline-flex items-center gap-1 rounded-control border border-line bg-card px-2 py-1 text-xs text-ink transition-[background-color,transform] duration-fast hover:bg-subtle active:scale-[.98] motion-reduce:active:scale-100"
          >
            <RotateCw size={12} aria-hidden />重试
          </button>
        )}
      </div>
    )
  }
  const uploading = state.kind === 'uploading'
  const pct = uploading ? Math.round(state.progress * 100) : 0
  return (
    <span className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-ink/80 py-0.5 pl-1 pr-2 text-[11px] text-card" aria-live="polite">
      {uploading ? <ProgressRing value={state.progress} /> : <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {uploading ? `上传中 ${pct}%` : '生成中'}
    </span>
  )
}

function ProgressRing({ value }: { value: number }) {
  const r = 5.5
  const c = 2 * Math.PI * r
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="-rotate-90">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--color-acid)" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - value)} className="transition-[stroke-dashoffset] duration-fast" />
    </svg>
  )
}
