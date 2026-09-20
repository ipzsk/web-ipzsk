import {
  useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type ReactNode, type Ref,
} from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ImageOff, RotateCw } from 'lucide-react'
import { cn } from './cn'

/* Decision (see F2 report): @virtuoso.dev/masonry 1.4.3 exposes no imperative handle (no scrollToIndex),
   no endReached, and measures DOM to place items, so a deep scroll lands items in different columns than a
   sequential scroll. We use @tanstack/react-virtual `lanes`: heights are known up front (estimateSize is exact,
   nothing is measured), so its shortest-lane placement is deterministic and scrollToIndex works. */

export const columnsFor = (width: number) =>
  width >= 1600 ? 6 : width >= 1280 ? 5 : width >= 1024 ? 4 : width >= 768 ? 3 : 2
export const gapFor = (width: number) => (width >= 768 ? 16 : 8)

const SKELETON_RATIOS = [4 / 3, 1, 3 / 2, 9 / 16, 16 / 9, 5 / 4] // 3:4 1:1 2:3 16:9 9:16 4:5

export type MasonryGridHandle = { scrollToIndex: (index: number, align?: 'start' | 'center' | 'auto') => void }

type Props<T> = {
  /** Keep referentially stable between renders (memo / query data): a new array re-places every item. */
  items: T[]
  getKey: (item: T) => string
  /** height / width. null → square. */
  getAspect: (item: T) => number | null
  renderItem: (item: T, index: number, size: { width: number; height: number }) => ReactNode
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onEndReached?: () => void
  empty?: ReactNode
  /** Width breakpoints use the grid's own width (the doc's px thresholds). */
  className?: string
  ref?: Ref<MasonryGridHandle>
  'aria-label'?: string
}

export function MasonryGrid<T>({ items, getKey, getAspect, renderItem, loading, error, onRetry, onEndReached, empty, className, ref, ...aria }: Props<T>) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    const el = box.current!
    const read = () => { const r = el.getBoundingClientRect(); setWidth(r.width); setTop(r.top + window.scrollY) }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const lanes = columnsFor(width)
  const gap = gapFor(width)
  const colW = width ? (width - gap * (lanes - 1)) / lanes : 0
  const skeletons = loading ? (items.length ? lanes * 2 : lanes * 4) : 0
  const count = items.length + skeletons
  const aspectAt = (i: number) => (i < items.length ? getAspect(items[i]!) ?? 1 : SKELETON_RATIOS[i % SKELETON_RATIOS.length]!)

  const keyFn = useRef(getKey)
  keyFn.current = getKey
  // Stable per items array: virtual-core recomputes all positions whenever getItemKey changes identity.
  const getItemKey = useCallback((i: number) => (i < items.length ? keyFn.current(items[i]!) : `skeleton-${i}`), [items])

  const v = useWindowVirtualizer({
    count,
    estimateSize: (i) => Math.round(colW * aspectAt(i)),
    getItemKey,
    lanes,
    gap,
    overscan: lanes * 3,
    scrollMargin: top,
  })

  // Sizes or data changed → drop the cached lane assignments and re-place from index 0 (deterministic).
  useLayoutEffect(() => { v.measure() }, [colW, items, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index, align = 'center') => v.scrollToIndex(index, { align }),
  }), [v])

  // Infinite load: fire when within 2 viewports of the end, once per item count.
  const total = v.getTotalSize()
  const offset = v.scrollOffset ?? 0
  const viewport = typeof window === 'undefined' ? 0 : window.innerHeight
  const nearEnd = width > 0 && items.length > 0 && total - (offset - top + viewport) < viewport * 2
  const firedFor = useRef(-1)
  useEffect(() => {
    if (nearEnd && !loading && !error && onEndReached && firedFor.current !== items.length) {
      firedFor.current = items.length
      onEndReached()
    }
  }, [nearEnd, loading, error, onEndReached, items.length])

  // Arrow keys: move focus to the spatially nearest card.
  const onKeyDown = (e: KeyboardEvent) => {
    const dir = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' } as const)[e.key as 'ArrowUp']
    if (!dir) return
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-masonry-index]')
    if (!cell || !box.current?.contains(cell)) return
    const target = nearestIndex(v.measurementsCache, Number(cell.dataset.masonryIndex), dir, items.length)
    if (target == null) return
    e.preventDefault()
    v.scrollToIndex(target, { align: 'auto' })
    const focus = (tries: number) => {
      const el = box.current?.querySelector<HTMLElement>(`[data-masonry-index="${target}"]`)
      const f = el?.querySelector<HTMLElement>('[tabindex="0"]') ?? el
      if (f) f.focus({ preventScroll: true })
      else if (tries > 0) requestAnimationFrame(() => focus(tries - 1))
    }
    requestAnimationFrame(() => focus(10))
  }

  const showEmpty = !loading && !error && items.length === 0
  const showError = !!error

  return (
    <div className={className}>
      <div
        ref={box}
        role="list"
        aria-label={aria['aria-label']}
        aria-busy={loading || undefined}
        onKeyDown={onKeyDown}
        className="relative w-full"
        style={{ height: count ? total : undefined }}
      >
        {width > 0 && v.getVirtualItems().map((row) => {
          const i = row.index
          const style = {
            position: 'absolute' as const, top: 0, left: 0, width: colW, height: row.size,
            transform: `translate3d(${row.lane * (colW + gap)}px, ${row.start - top}px, 0)`,
          }
          if (i >= items.length) {
            return <div key={row.key} aria-hidden style={style} className="animate-pulse rounded-card bg-subtle motion-reduce:animate-none" />
          }
          return (
            <div key={row.key} role="listitem" data-masonry-index={i} style={style}>
              {renderItem(items[i]!, i, { width: colW, height: row.size })}
            </div>
          )
        })}
      </div>
      {showEmpty && (empty ?? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted">
          <ImageOff size={32} aria-hidden />
          <p className="text-sm">这里还没有内容</p>
        </div>
      ))}
      {showError && (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle size={32} className="text-danger" aria-hidden />
          <p className="text-sm text-ink">{error}</p>
          {onRetry && (
            <button
              type="button" onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink transition-[background-color,transform] duration-fast hover:bg-subtle active:scale-[.98] motion-reduce:active:scale-100"
            >
              <RotateCw size={14} aria-hidden />重试
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type Cell = { index: number; start: number; end: number; lane: number }

/** Exported for tests. Up/down: same lane neighbour. Left/right: adjacent lane, closest vertical centre. */
export function nearestIndex(cells: readonly Cell[], from: number, dir: 'up' | 'down' | 'left' | 'right', limit: number): number | null {
  const cur = cells[from]
  if (!cur) return null
  const mid = (c: Cell) => (c.start + c.end) / 2
  let best: Cell | null = null
  let bestScore = Infinity
  for (let i = 0; i < Math.min(cells.length, limit); i++) {
    const c = cells[i]!
    if (i === from) continue
    let score: number
    if (dir === 'up' || dir === 'down') {
      if (c.lane !== cur.lane) continue
      const d = dir === 'down' ? c.start - cur.start : cur.start - c.start
      if (d <= 0) continue
      score = d
    } else {
      if (c.lane !== cur.lane + (dir === 'right' ? 1 : -1)) continue
      score = Math.abs(mid(c) - mid(cur))
    }
    if (score < bestScore) { bestScore = score; best = c }
  }
  return best?.index ?? null
}
