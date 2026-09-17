import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, focusRing } from '@/ui'

const FADE = 36

/**
 * Horizontal chip row for mouse users: chevrons + edge fades only on the overflowing side, vertical wheel scrolls
 * sideways when the row can move that way, and the active (`aria-pressed`) or focused chip is kept in view.
 * `revealKey` changes → re-reveal the last pressed chip.
 */
export function ChipScroller({ label, revealKey, children }: { label: string; revealKey: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = row.current
    if (!el) return
    const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  const reveal = useCallback((chip: HTMLElement | null | undefined) => {
    const el = row.current
    if (!el || !chip) return
    const from = chip.offsetLeft - FADE, to = chip.offsetLeft + chip.offsetWidth + FADE - el.clientWidth
    if (el.scrollLeft > from) el.scrollLeft = Math.max(0, from)
    else if (el.scrollLeft < to) el.scrollLeft = to
  }, [])

  useLayoutEffect(() => {
    const el = row.current!
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(inner.current!) // chips/counts arriving change the content width, not the row's
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const canMove = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 1
      if (!canMove) return // let the page scroll
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel) }
  }, [update])

  useEffect(() => {
    const pressed = row.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]')
    reveal(pressed?.[pressed.length - 1])
  }, [revealKey, reveal])

  const page = (dir: 1 | -1) => {
    const el = row.current!
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: smooth ? 'smooth' : 'auto' })
  }

  const mask = `linear-gradient(to right, ${edge.left ? `transparent, #000 ${FADE}px` : '#000'}, ${edge.right ? `#000 calc(100% - ${FADE}px), transparent` : '#000'})`
  const btn = cn('absolute top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-card text-ink shadow-sm transition-colors duration-(--duration-fast) hover:bg-subtle [@media(hover:none)]:hidden', focusRing)

  return (
    <div className="relative min-w-0 flex-1">
      {edge.left && <button type="button" tabIndex={-1} aria-label="向左滚动分类" onClick={() => page(-1)} className={cn(btn, 'left-0')}><ChevronLeft className="size-4" aria-hidden /></button>}
      <div
        ref={row}
        role="group"
        aria-label={label}
        onScroll={update}
        onFocus={(e) => reveal(e.target.closest<HTMLElement>('button'))}
        style={edge.left || edge.right ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        className="relative overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={inner} className="flex w-max gap-2 px-1">{children}</div>
      </div>
      {edge.right && <button type="button" tabIndex={-1} aria-label="向右滚动分类" onClick={() => page(1)} className={cn(btn, 'right-0')}><ChevronRight className="size-4" aria-hidden /></button>}
    </div>
  )
}
