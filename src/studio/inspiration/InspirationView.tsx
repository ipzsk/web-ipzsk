import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Copy, Ellipsis, ExternalLink, Heart, Search, SearchX, WandSparkles, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, cn, focusRing } from '@/ui'
import { MasonryGrid, MediaCard, type MasonryGridHandle } from '@/media'
import { toggleFavorite, useCases, useCategories, useFavorites } from './api'
import { caseAspect, copyrightLabel, patchParams, readParams, type CaseItem } from './lib'
import { caseAsset, copyPrompt, fillComposer } from './actions'
import { CaseDetail } from './CaseDetail'
import { TemplatesPanel } from '../templates/TemplatesPanel'

/** §2.8: pseudo-category showing the user's own templates instead of cases. */
const MY_TEMPLATES = 'my-templates'

const focusCard = (id: string, tries = 10) => {
  const el = document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(id)}"] [role="button"]`)
  if (el) el.focus({ preventScroll: true })
  else if (tries > 0) requestAnimationFrame(() => focusCard(id, tries - 1))
}

type OverlayState = { caseOverlay?: boolean } | null

export function InspirationView() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const params = readParams(sp)
  const filter = useMemo(() => ({ cat: params.cat, q: params.q }), [params.cat, params.q])

  const cases = useCases(filter)
  const items = useMemo(() => cases.data?.pages.flatMap((p) => p.items) ?? [], [cases.data])
  const cats = useCategories(params.q)
  const favs = useFavorites()
  const grid = useRef<MasonryGridHandle>(null)

  /* search: 200ms debounce → URL; URL changes from back/forward flow back into the input */
  const [text, setText] = useState(params.q)
  const [syncedQ, setSyncedQ] = useState(params.q)
  if (syncedQ !== params.q) { setSyncedQ(params.q); setText(params.q) }
  useEffect(() => {
    if (text.trim() === params.q) return
    const t = setTimeout(() => setSp((cur) => patchParams(cur, { q: text.trim(), case: null })), 200)
    return () => clearTimeout(t)
  }, [text, params.q, setSp])

  // New filter → back to the top of the feed.
  const firstFilter = useRef(true)
  useEffect(() => {
    if (firstFilter.current) { firstFilter.current = false; return }
    window.scrollTo(0, 0)
  }, [filter])

  /* detail open / close with scroll + focus restore */
  const openedFrom = useRef<{ id: string; y: number } | null>(null)
  const openCase = useCallback((c: CaseItem) => {
    openedFrom.current = { id: c.id, y: window.scrollY }
    navigate({ search: `?${patchParams(sp, { case: c.id })}` }, { state: { caseOverlay: true } })
  }, [navigate, sp])
  const closeCase = () => {
    if ((location.state as OverlayState)?.caseOverlay) navigate(-1)
    else setSp((cur) => patchParams(cur, { case: null }), { replace: true })
  }
  const gotoCase = (id: string) => navigate({ search: `?${patchParams(sp, { case: id })}` }, { replace: true, state: location.state })

  const shownCase = useRef(params.case)
  useLayoutEffect(() => {
    const was = shownCase.current
    shownCase.current = params.case
    if (!was || params.case) return
    const from = openedFrom.current
    openedFrom.current = null
    const index = items.findIndex((c) => c.id === was)
    // Wait a frame so the dialog's scroll lock is gone before we scroll.
    requestAnimationFrame(() => {
      if (from?.id === was) window.scrollTo(0, from.y)
      else if (index >= 0) grid.current?.scrollToIndex(index, 'center')
      if (index >= 0) focusCard(was)
    })
  }, [params.case]) // eslint-disable-line react-hooks/exhaustive-deps

  const setCat = (cat: string) => setSp((cur) => patchParams(cur, { cat, case: null }))
  const clearFilters = () => { setText(''); setSp((cur) => patchParams(cur, { cat: '', q: '', case: null })) }

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = cases
  const onEndReached = useCallback(() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage() }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const renderItem = useCallback((c: CaseItem, index: number) => (
    <CaseCard c={c} priority={index < 10} fav={favs.has(c.id)} onOpen={openCase} />
  ), [favs, openCase])

  const mine = params.cat === MY_TEMPLATES
  const chips = [{ id: '', label: '全部', count: cats.data?.total }, { id: MY_TEMPLATES, label: '我的模板', count: undefined as number | undefined }, ...(cats.data?.categories ?? [])]

  return (
    <section aria-labelledby="inspiration-title">
      <h1 id="inspiration-title" className="sr-only">灵感</h1>
      <div className="sticky top-16 z-30 -mx-4 -mt-6 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-md max-[720px]:top-[104px] md:-mx-8 md:px-8">
        <label className="relative w-full md:order-last md:w-64">
          <span className="sr-only">搜索案例</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="搜索标题、提示词、标签"
            className={cn(
              'h-9 w-full rounded-control border border-line bg-card pl-9 pr-9 text-sm text-ink placeholder:text-muted transition-colors duration-(--duration-fast) hover:border-muted focus:border-ink [&::-webkit-search-cancel-button]:hidden',
              focusRing, 'focus-visible:outline-offset-0',
            )}
          />
          {text && (
            <button type="button" aria-label="清空搜索" onClick={() => setText('')} className={cn('absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[8px] text-muted hover:bg-subtle active:scale-[.98]', focusRing)}>
              <X aria-hidden />
            </button>
          )}
        </label>
        <div role="group" aria-label="分类" className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
          {chips.map((ch) => {
            const on = params.cat === ch.id
            return (
              <button
                key={ch.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => setCat(ch.id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-[background-color,border-color,transform] duration-(--duration-fast) active:scale-[.98] motion-reduce:active:scale-100',
                  on ? 'border-ink bg-ink text-acid' : 'border-line bg-card text-ink hover:border-muted hover:bg-subtle',
                  focusRing,
                )}
              >
                {ch.label}
                {ch.count != null && <span className={cn('tabular-nums text-xs font-normal', on ? 'text-acid/70' : 'text-muted')}>{ch.count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {mine ? <TemplatesPanel /> : <MasonryGrid
        ref={grid}
        aria-label="灵感案例"
        items={items}
        getKey={(c) => c.id}
        getAspect={(c) => caseAspect(c.image)}
        renderItem={renderItem}
        loading={cases.isPending || isFetchingNextPage}
        error={cases.isError ? '案例加载失败，请检查网络后重试' : null}
        onRetry={() => void (cases.isFetchNextPageError ? fetchNextPage() : cases.refetch())}
        onEndReached={onEndReached}
        empty={<EmptyState icon={SearchX} illustration="brain" text={params.q ? `没有找到与「${params.q}」相关的案例` : '这个分类下还没有案例'} action={{ label: '清除筛选', onClick: clearFilters }} />}
      />}

      <CaseDetail
        id={params.case}
        list={items}
        hasMore={!!hasNextPage}
        loadMore={() => void fetchNextPage()}
        onClose={closeCase}
        onNavigate={gotoCase}
      />
    </section>
  )
}

function CaseCard({ c, priority, fav, onOpen }: { c: CaseItem; priority: boolean; fav: boolean; onOpen: (c: CaseItem) => void }) {
  const [menu, setMenu] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const longPressed = useRef(false)

  // Touch: long-press (500ms) opens the action menu instead of the detail.
  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') return
    longPressed.current = false
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { longPressed.current = true; setMenu(true) }, 500)
  }
  const cancel = () => clearTimeout(timer.current)
  useEffect(() => () => clearTimeout(timer.current), [])

  const iconBtn = cn('grid size-8 place-items-center rounded-control text-card transition-[background-color,transform] duration-(--duration-fast) hover:bg-card/20 active:scale-[.98] motion-reduce:active:scale-100', focusRing, 'focus-visible:outline-card')

  return (
    <div
      data-case-id={c.id}
      className="group/case relative h-full [-webkit-touch-callout:none]"
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerMove={(e) => { if (e.pointerType !== 'mouse' && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) cancel() }}
      onPointerCancel={cancel}
      onContextMenu={(e) => { if (longPressed.current) e.preventDefault() }}
      onClickCapture={(e) => { if (longPressed.current) { e.stopPropagation(); e.preventDefault(); longPressed.current = false } }}
    >
      <MediaCard
        asset={caseAsset(c)}
        title={c.title}
        priority={priority}
        onOpen={() => onOpen(c)}
        overlay={
          <div className="grid gap-1.5">
            {c.author && <p className="truncate text-xs text-card/80">{c.author}</p>}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fillComposer(c)}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control bg-acid px-3 text-[13px] font-semibold text-ink transition-[filter,transform] duration-(--duration-fast) hover:brightness-95 active:scale-[.98] motion-reduce:active:scale-100', focusRing, 'focus-visible:outline-card')}
              >
                <WandSparkles aria-hidden />做同款
              </button>
              <button type="button" aria-label={fav ? '取消收藏' : '收藏'} aria-pressed={fav} onClick={() => toggleFavorite(c.id)} className={iconBtn}>
                <Heart aria-hidden className={cn(fav && 'fill-current text-acid')} />
              </button>
              <p className="ml-auto min-w-0 truncate text-[11px] text-card/60">{copyrightLabel(c).card}</p>
            </div>
          </div>
        }
      />
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="更多操作"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'absolute right-2 top-2 grid size-8 place-items-center rounded-control bg-ink/55 text-card opacity-0 backdrop-blur-sm transition-[opacity,background-color] duration-(--duration-fast) hover:bg-ink/75',
              'group-hover/case:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-none',
              focusRing,
            )}
          >
            <Ellipsis aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fillComposer(c)}><WandSparkles aria-hidden />做同款</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleFavorite(c.id)}><Heart aria-hidden className={cn(fav && 'fill-current')} />{fav ? '取消收藏' : '收藏'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyPrompt(c)}><Copy aria-hidden />复制提示词</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.open(c.image.urls.orig, '_blank', 'noopener,noreferrer')}><ExternalLink aria-hidden />新标签打开原图</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
