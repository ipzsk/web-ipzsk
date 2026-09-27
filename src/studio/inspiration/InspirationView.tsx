import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Clapperboard, Copy, Ellipsis, ExternalLink, Heart, Info, SearchX, UserRound, WandSparkles } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, OptionsCombobox, cn, focusRing, type ComboGroup } from '@/ui'
import { MasonryGrid, MediaCard, type MasonryGridHandle } from '@/media'
import { toggleFavorite, useCases, useCategories, useFavorites } from './api'
import { caseAspect, copyrightLabel, patchParams, readParams, splitCats, toggleCat, type CaseItem, type CaseKind } from './lib'
import { caseAsset, copyPrompt, fillComposer } from './actions'
import { CaseDetail } from './CaseDetail'
import { TemplatesPanel } from '../templates/TemplatesPanel'
import { useComposer } from '../store'
import { ChipScroller } from './ChipScroller'

/** §2.8: pseudo-category showing the user's own templates instead of cases. */
const MY_TEMPLATES = 'my-templates'

const focusCard = (id: string, tries = 10) => {
  const el = document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(id)}"] [role="group"]`)
  if (el) el.focus({ preventScroll: true })
  else if (tries > 0) requestAnimationFrame(() => focusCard(id, tries - 1))
}

type OverlayState = { caseOverlay?: boolean } | null

/* recent searches (localStorage, newest first, max 8) */
const RECENT_KEY = 'ipzsk:studio:recent-searches'
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : [] } catch { return [] } }
function useRecentSearches() {
  const [recent, setRecent] = useState(readRecent)
  const save = (next: string[]) => { setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode: memory only */ } }
  return {
    recent,
    add: (q: string) => { if (q && recent[0] !== q) save([q, ...recent.filter((x) => x !== q)].slice(0, 8)) },
    remove: (q: string) => save(recent.filter((x) => x !== q)),
    clear: () => save([]),
  }
}

export function InspirationView() {
  const kind = useComposer((s) => (s.mode === 'avatar' ? 'avatar' : s.kind))
  return <CaseLibrary kind={kind} />
}

/** The feed follows the composer's kind (图片 / 视频 / 数字人); an open `?case=` loads by id whatever the kind. */
function CaseLibrary({ kind }: { kind: CaseKind }) {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const params = readParams(sp)
  const filter = useMemo(() => ({ cat: params.cat, q: params.q, kind }), [params.cat, params.q, kind])

  const cases = useCases(filter)
  const items = useMemo(() => cases.data?.pages.flatMap((p) => p.items) ?? [], [cases.data])
  const cats = useCategories(params.q, kind)
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
  // 我的模板 is exclusive; 全部 ('') clears; other categories toggle (multi-select → `cat=a,b`).
  // Read the live URL: quick successive toggles must not start from a stale render's `cat`.
  const pickChip = (id: string) => {
    const cur = readParams(window.location.search).cat
    const wasMine = cur === MY_TEMPLATES
    setCat(id === MY_TEMPLATES ? (wasMine ? '' : MY_TEMPLATES) : toggleCat(wasMine ? '' : cur, id))
  }
  const recent = useRecentSearches()
  const commitSearch = () => recent.add(text.trim())
  const clearFilters = () => { setText(''); setSp((cur) => patchParams(cur, { cat: '', q: '', case: null })) }

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = cases
  const onEndReached = useCallback(() => { if (hasNextPage && !isFetchingNextPage) void fetchNextPage() }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const renderItem = useCallback((c: CaseItem, index: number, size: { height: number }) => (
    <CaseCard c={c} priority={index < 10} fav={favs.has(c.id)} onOpen={openCase} short={size.height < 200} />
  ), [favs, openCase])

  const mine = params.cat === MY_TEMPLATES
  const chips = [{ id: '', label: '全部', count: cats.data?.total }, { id: MY_TEMPLATES, label: '我的模板', count: undefined as number | undefined }, ...(cats.data?.categories ?? [])]
  const selectedCats = mine ? [] : splitCats(params.cat)
  const groups: ComboGroup[] = [
    {
      id: 'recent', label: '最近搜索',
      extra: <button type="button" onClick={recent.clear} className={cn('rounded-[6px] px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-ink', focusRing)}>清空</button>,
      options: recent.recent.map((q) => ({ value: q, label: q, action: true, onRemove: () => recent.remove(q) })),
    },
    { id: 'cats', label: '分类（可多选）', options: (cats.data?.categories ?? []).map((c) => ({ value: c.id, label: c.label, count: c.count })) },
  ]

  return (
    <section aria-labelledby="inspiration-title">
      <h1 id="inspiration-title" className="sr-only">灵感</h1>
      <div className="sticky top-16 embed:top-0! z-30 -mx-4 -mt-6 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur-md max-[720px]:top-[104px] md:flex-nowrap md:-mx-8 md:px-8">
        <OptionsCombobox
          label="搜索案例"
          placeholder="搜索标题、提示词、标签"
          value={text}
          onValueChange={setText}
          groups={groups}
          selected={selectedCats}
          onToggle={pickChip}
          onPick={(q) => { setText(q); recent.add(q) }}
          onSubmit={commitSearch}
          onBlur={commitSearch}
          className="w-full md:w-80 md:shrink-0"
        />
        <ChipScroller label="分类" revealKey={`${params.cat}|${chips.length}`}>
          {chips.map((ch) => {
            const on = ch.id ? (ch.id === MY_TEMPLATES ? mine : selectedCats.includes(ch.id)) : !params.cat
            return (
              <button
                key={ch.id || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => pickChip(ch.id)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-[background-color,border-color,transform] duration-(--duration-fast) active:scale-[.98] motion-reduce:active:scale-100',
                  on ? 'border-acid bg-acid text-white' : 'border-line bg-card text-ink hover:border-muted hover:bg-subtle',
                  focusRing,
                )}
              >
                {ch.label}
                {ch.count != null && <span className={cn('tabular-nums text-xs font-normal', on ? 'text-white' : 'text-muted')}>{ch.count}</span>}
              </button>
            )
          })}
        </ChipScroller>
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
        empty={kind !== 'image' && !params.q && !params.cat
          ? <EmptyState
            icon={kind === 'avatar' ? UserRound : Clapperboard}
            text={kind === 'avatar' ? '暂无数字人案例，可以直接在下方输入框开始创作' : '暂无视频案例，可以直接在下方输入框开始创作'}
            action={{ label: '看看图片案例', onClick: () => useComposer.getState().setKind('image') }}
          />
          : <EmptyState icon={SearchX} illustration="brain" text={params.q ? `没有找到与「${params.q}」相关的案例` : '这个分类下还没有案例'} action={{ label: '清除筛选', onClick: clearFilters }} />}
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

/**
 * 点卡片本体 = 把提示词填进输入框（不再开详情）：网页版就是拿来体验的，少一步算一步；
 * 详情走「⋯」菜单（触屏长按也开这个菜单）。
 * `short`: wide/flat cards (≲200px tall) keep only title + 做同款 in the hover overlay, so nothing crowds or truncates.
 */
function CaseCard({ c, priority, fav, onOpen, short }: { c: CaseItem; priority: boolean; fav: boolean; onOpen: (c: CaseItem) => void; short: boolean }) {
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
        onOpen={() => fillComposer(c)}
        overlay={
          <div className="grid gap-1.5">
            {c.author && !short && <p className="truncate text-xs text-card/80">{c.author}</p>}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fillComposer(c)}
                className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control bg-acid px-3 text-[13px] font-semibold text-white transition-[filter,transform] duration-(--duration-fast) hover:brightness-95 active:scale-[.98] motion-reduce:active:scale-100', focusRing, 'focus-visible:outline-card')}
              >
                <WandSparkles aria-hidden />做同款
              </button>
              <button type="button" aria-label={fav ? '取消收藏' : '收藏'} aria-pressed={fav} onClick={() => toggleFavorite(c.id)} className={iconBtn}>
                <Heart aria-hidden className={cn(fav && 'fill-current text-acid')} />
              </button>
              {!short && <p className="ml-auto min-w-0 truncate text-[11px] text-card/70">{copyrightLabel(c).card}</p>}
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
          <DropdownMenuItem onSelect={() => onOpen(c)}><Info aria-hidden />查看详情</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleFavorite(c.id)}><Heart aria-hidden className={cn(fav && 'fill-current')} />{fav ? '取消收藏' : '收藏'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyPrompt(c)}><Copy aria-hidden />复制提示词</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.open(c.video?.urls.orig ?? c.image.urls.orig, '_blank', 'noopener,noreferrer')}><ExternalLink aria-hidden />{c.video ? '新标签打开视频' : '新标签打开原图'}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
