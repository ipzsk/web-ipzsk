import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Flag, Heart, ImageOff, Layers, LayoutDashboard, Type, WandSparkles } from 'lucide-react'
import { Badge, Button, Dialog, DialogContent, EmptyState, IconButton, Skeleton, cn, focusRing } from '@/ui'
import { MediaCard, MediaImage } from '@/media'
import { toggleFavorite, useCase, useFavorites, useSimilar } from './api'
import { caseAspect, copyrightLabel, takedownHref, type CaseItem } from './lib'
import { addCaseToCanvas, caseAsset, copyPrompt, fillComposer } from './actions'

type Props = {
  id: string | null
  /** The feed's loaded items, for ←/→. */
  list: CaseItem[]
  hasMore: boolean
  loadMore: () => void
  onClose: () => void
  onNavigate: (id: string) => void
}

export function CaseDetail({ id, list, hasMore, loadMore, onClose, onNavigate }: Props) {
  const { data: c, isPending, isError, refetch } = useCase(id)
  const favs = useFavorites()
  const scroller = useRef<HTMLDivElement>(null)

  const index = id ? list.findIndex((x) => x.id === id) : -1
  const prev = index > 0 ? list[index - 1] : undefined
  const next = index >= 0 ? list[index + 1] : undefined
  useEffect(() => { if (index >= 0 && index >= list.length - 3 && hasMore) loadMore() }, [index, list.length, hasMore, loadMore])
  useEffect(() => { scroller.current?.scrollTo(0, 0) }, [id])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, [contenteditable="true"]')) return
    if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onNavigate(prev.id) }
    if (e.key === 'ArrowRight' && next) { e.preventDefault(); onNavigate(next.id) }
  }

  const act = (promptOnly: boolean) => { if (c) { fillComposer(c, promptOnly); onClose() } }
  const fav = !!c && favs.has(c.id)
  const outOfList = '这个案例不在当前列表里'

  return (
    <Dialog open={!!id} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        ref={scroller}
        title={c?.title ?? '案例详情'}
        onKeyDown={onKeyDown}
        // The view restores focus to the card itself (it may have changed via ←/→).
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Focus the dialog itself, not the first button: a focused IconButton shows a tooltip that would eat the first Esc.
        onOpenAutoFocus={(e) => { e.preventDefault(); scroller.current?.focus() }}
        className={cn(
          'max-h-[92dvh] max-w-6xl overflow-y-auto',
          'max-md:left-0 max-md:top-0 max-md:h-dvh max-md:max-h-none max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:p-4',
        )}
      >
        {isPending && id ? (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" aria-busy>
            <Skeleton className="aspect-[3/4] w-full rounded-card" />
            <div className="grid content-start gap-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-40 w-full" /><Skeleton className="h-10 w-1/2" /></div>
          </div>
        ) : isError ? (
          <EmptyState icon={ImageOff} text="案例加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void refetch() }} />
        ) : !c ? (
          <EmptyState icon={ImageOff} text="案例不存在或已下架" action={{ label: '返回灵感', onClick: onClose }} />
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <div className="md:sticky md:top-0 md:self-start">
                <ZoomImage c={c} />
              </div>

              <div className="grid min-w-0 content-start gap-5">
                <div className="flex items-center gap-1">
                  <Badge tone="outline">{c.category_zh ?? c.category}</Badge>
                  <span className="ml-auto" />
                  <IconButton label="上一个（←）" size="icon-sm" disabled={!prev} disabledReason={index < 0 ? outOfList : '已经是第一个'} onClick={() => prev && onNavigate(prev.id)}><ChevronLeft /></IconButton>
                  <IconButton label="下一个（→）" size="icon-sm" disabled={!next} disabledReason={index < 0 ? outOfList : hasMore ? '正在加载更多' : '已经是最后一个'} onClick={() => next && onNavigate(next.id)}><ChevronRight /></IconButton>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<WandSparkles />} onClick={() => act(false)}>做同款</Button>
                  <Button icon={<Type />} onClick={() => act(true)}>只用提示词</Button>
                  <Button icon={<LayoutDashboard />} onClick={() => addCaseToCanvas(c)}>放到画布</Button>
                  <Button aria-pressed={fav} icon={<Heart className={cn(fav && 'fill-current')} />} onClick={() => toggleFavorite(c.id)}>{fav ? '已收藏' : '收藏'}</Button>
                </div>

                <section className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold">提示词</h3>
                    <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => void copyPrompt(c)}>复制</Button>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-card bg-subtle p-3 font-sans text-[13px] leading-6 text-ink">{c.prompt}</pre>
                </section>

                <section className="grid gap-2">
                  <h3 className="text-[13px] font-semibold">型号与参数</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {c.model && <Badge>{c.model}</Badge>}
                    {Object.entries(c.params ?? {}).map(([k, v]) => <Badge key={k} tone="outline">{k === 'aspect_ratio' ? '比例' : k} {String(v)}</Badge>)}
                    <Badge tone="outline">{c.image.width ?? '?'}×{c.image.height ?? '?'}</Badge>
                  </div>
                </section>

                {c.template && (
                  <section className="grid gap-2">
                    <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Layers aria-hidden />套图模板 · {c.template.items.reduce((n, it) => n + (it.count ?? 1), 0)} 张</h3>
                    <ul className="grid gap-1 text-[13px] text-muted">
                      {c.template.items.map((it, i) => (
                        <li key={it.key ?? i}><span className="font-semibold text-ink">{it.label}</span> ×{it.count ?? 1}{it.description && ` · ${it.description}`}{!!it.references?.length && ` · 需要放入：${it.references.map((r) => r.slot).join('、')}`}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {c.tags.length > 0 && (
                  <section className="grid gap-2">
                    <h3 className="text-[13px] font-semibold">标签</h3>
                    <div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                  </section>
                )}

                <section className="grid gap-1.5 border-t border-line pt-4 text-xs leading-5 text-muted">
                  <p>{copyrightLabel(c).detail}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {c.author_url && <a className={cn('inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline', focusRing)} href={c.author_url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden className="size-3.5" />作者主页</a>}
                    {c.source_url && <a className={cn('inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline', focusRing)} href={c.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden className="size-3.5" />原帖 / 来源</a>}
                    <a className={cn('inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline', focusRing)} href={takedownHref(c)}><Flag aria-hidden className="size-3.5" />请求下架</a>
                  </div>
                </section>
              </div>
            </div>

            <Similar id={c.id} onNavigate={onNavigate} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Click to zoom 2.5× at the pointer; move the pointer (or finger) to pan; click again to reset. */
function ZoomImage({ c }: { c: CaseItem }) {
  const [zoom, setZoom] = useState(false)
  const [origin, setOrigin] = useState('50% 50%')
  useEffect(() => setZoom(false), [c.id])
  const aim = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect()
    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`)
  }
  const ratio = 1 / caseAspect(c.image)
  return (
    <button
      type="button"
      aria-label={zoom ? '还原图片' : '放大查看'}
      aria-pressed={zoom}
      onClick={(e) => { aim(e); setZoom((z) => !z) }}
      onPointerMove={zoom ? (e: RPointerEvent<HTMLButtonElement>) => aim(e) : undefined}
      className={cn('relative mx-auto block overflow-hidden rounded-card bg-subtle touch-none', zoom ? 'cursor-zoom-out' : 'cursor-zoom-in', focusRing)}
      style={{ width: `min(100%, ${(78 * ratio).toFixed(2)}dvh)` }}
    >
      <div className="transition-transform duration-base ease-standard motion-reduce:transition-none" style={{ transform: zoom ? 'scale(2.5)' : undefined, transformOrigin: origin }}>
        {/* thumb (usually cached from the feed) under the full image, so something shows instantly */}
        <MediaImage urls={{ orig: c.image.urls.w480 ?? c.image.urls.w960 ?? c.image.urls.orig }} width={c.image.width} height={c.image.height} alt="" hideBadge className="w-full" />
        <MediaImage urls={{ orig: c.image.urls.orig }} width={c.image.width} height={c.image.height} alt={c.title} sizes="orig" priority hideBadge className="absolute inset-0 w-full bg-transparent" />
      </div>
    </button>
  )
}

function Similar({ id, onNavigate }: { id: string; onNavigate: (id: string) => void }) {
  const { data, isPending } = useSimilar(id)
  if (!isPending && !data?.length) return null
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h3 className="mb-3 text-[15px] font-semibold">相似案例</h3>
      {/* Small, bounded list → CSS columns are enough; heights come from aspect ratios so nothing shifts. */}
      <div className="columns-2 gap-2 sm:columns-3 md:gap-4 lg:columns-5">
        {isPending
          ? Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="mb-2 w-full rounded-card md:mb-4" style={{ aspectRatio: i % 2 ? '3 / 4' : '1 / 1' }} />)
          : data!.map((s) => (
            // Same card as the main feed (title on hover), with its clamped aspect so heights match.
            <div key={s.id} className="mb-2 break-inside-avoid md:mb-4" style={{ aspectRatio: `1 / ${caseAspect(s.image)}` }}>
              <MediaCard asset={caseAsset(s)} title={s.title} onOpen={() => onNavigate(s.id)} />
            </div>
          ))}
      </div>
    </section>
  )
}
