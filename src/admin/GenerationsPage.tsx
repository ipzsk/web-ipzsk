import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Ban, Copy, ListX, RefreshCw } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, Skeleton, Textarea, cn, focusRing, toast } from '@/ui'
import { MediaImage, MissingMedia } from '@/media'
import { queryClient } from '@/shared/query'
import { fetchModels } from '@/studio/api/catalog'
import { adminApi, type AdminGenerationDetail, type GenerationQuery } from './api'
import { FAILURE_LABEL, GEN_STATUS_LABEL, cancelBlockReason, fmtPoints, fmtTime, type GenStatus } from './lib'
import { Confirm, Drawer, FilterInput, KV, PageHeader, Select, adminErrorText } from './ui'
import { useCan } from './App'

const KEYS = ['user', 'model', 'status', 'kind', 'from', 'to'] as const
const statusTone = (s: GenStatus) => (s === 'succeeded' ? 'success' : s === 'failed' ? 'danger' : s === 'cancelled' ? 'outline' : 'warning') as 'success'
const ROW = 52
const COLS = 'grid min-w-[820px] grid-cols-[150px_minmax(0,1fr)_200px_150px_90px_100px] items-center gap-3 px-3'

export function GenerationsPage() {
  const [sp, setSp] = useSearchParams()
  const filter: GenerationQuery = useMemo(() => Object.fromEntries(KEYS.map(k => [k, sp.get(k) ?? ''])), [sp])
  const setParam = (k: string, v: string | null) => setSp(cur => { const p = new URLSearchParams(cur); if (v) p.set(k, v); else p.delete(k); return p }, { replace: k !== 'id' })
  const [user, setUser] = useState(filter.user ?? '')
  useEffect(() => { if (user.trim() === filter.user) return; const t = setTimeout(() => setParam('user', user.trim()), 300); return () => clearTimeout(t) }) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useInfiniteQuery({
    queryKey: ['admin', 'generations', filter],
    queryFn: ({ pageParam }) => adminApi.generations.list({ ...filter, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.next_cursor,
  })
  const models = useQuery({ queryKey: ['models'], queryFn: fetchModels, staleTime: 10 * 60_000 })
  const rows = useMemo(() => list.data?.pages.flatMap(p => p.items) ?? [], [list.data])

  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 10 })
  const vItems = v.getVirtualItems()
  const last = vItems.at(-1)?.index ?? 0
  useEffect(() => { if (last >= rows.length - 20 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage() }, [last, rows.length, list])

  // Arrow keys move between rows (virtualized: scroll first, then focus).
  const onRowKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : -1
    if (to < 0 || to >= rows.length) return
    e.preventDefault()
    v.scrollToIndex(to)
    requestAnimationFrame(() => scroller.current?.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus())
  }

  return (
    <section>
      <PageHeader title="生成记录" />
      <div role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <FilterInput label="用户" value={user} onChange={e => setUser(e.target.value)} placeholder="邮箱或用户 id" className="w-56" />
        <Select label="型号" value={filter.model} onChange={e => setParam('model', e.target.value)}>
          <option value="">全部型号</option>
          {models.data?.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
        </Select>
        <Select label="状态" value={filter.status} onChange={e => setParam('status', e.target.value)}>
          <option value="">全部状态</option>
          {(Object.keys(GEN_STATUS_LABEL) as GenStatus[]).map(s => <option key={s} value={s}>{GEN_STATUS_LABEL[s]}</option>)}
          <option value="queued,running">进行中</option>
        </Select>
        <Select label="类型" value={filter.kind} onChange={e => setParam('kind', e.target.value)}>
          <option value="">图片与视频</option><option value="image">图片</option><option value="video">视频</option>
        </Select>
        <FilterInput label="从" type="date" value={filter.from} max={filter.to || undefined} onChange={e => setParam('from', e.target.value)} />
        <FilterInput label="到" type="date" value={filter.to} min={filter.from || undefined} onChange={e => setParam('to', e.target.value)} />
        {KEYS.some(k => filter[k]) && <Button size="sm" variant="ghost" onClick={() => { setUser(''); setSp({}, { replace: true }) }}>清除筛选</Button>}
      </div>

      {list.isError ? <ErrorState reason="记录加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void list.refetch() }} />
        : list.isPending ? <div className="grid gap-1">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        : !rows.length ? <EmptyState icon={ListX} text="没有符合筛选的生成记录" />
        : (
          <div role="table" aria-label="生成记录" aria-rowcount={rows.length} className="overflow-x-auto rounded-card border border-line bg-card">
            <div role="row" className={cn(COLS, 'h-10 border-b border-line text-xs font-semibold text-muted')}>
              {['时间', '提示词', '用户', '型号', '状态', '扣点'].map(h => <span key={h} role="columnheader">{h}</span>)}
            </div>
            <div ref={scroller} className="h-[calc(100dvh-300px)] min-h-80 overflow-y-auto">
              <div role="rowgroup" style={{ height: v.getTotalSize(), position: 'relative' }}>
                {vItems.map(vi => {
                  const r = rows[vi.index]!
                  return (
                    <div
                      key={r.id} role="row" data-index={vi.index} tabIndex={0} aria-rowindex={vi.index + 2}
                      onClick={() => setParam('id', r.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setParam('id', r.id) } else onRowKey(e, vi.index) }}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW, transform: `translateY(${vi.start}px)` }}
                      className={cn(COLS, 'cursor-pointer border-b border-line text-sm hover:bg-subtle', focusRing, 'focus-visible:outline-offset-[-2px]', sp.get('id') === r.id && 'bg-subtle')}
                    >
                      <span role="cell" className="text-xs text-muted tabular-nums">{fmtTime(r.created_at)}</span>
                      <span role="cell" className="truncate">{r.prompt}</span>
                      <span role="cell" className="truncate text-xs text-muted">{r.user.email}</span>
                      <span role="cell" className="truncate text-xs">{r.model}</span>
                      <span role="cell"><Badge tone={statusTone(r.status)}>{GEN_STATUS_LABEL[r.status]}</Badge></span>
                      <span role="cell" className="text-xs tabular-nums">{fmtPoints(r.charged_points)}</span>
                    </div>
                  )
                })}
              </div>
              {list.isFetchingNextPage && <p className="py-2 text-center text-xs text-muted">加载中…</p>}
            </div>
          </div>
        )}

      <GenerationDrawer id={sp.get('id')} onClose={() => setParam('id', null)} />
    </section>
  )
}

function GenerationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const canAct = useCan('generations.act')
  const key = ['admin', 'generation', id]
  const q = useQuery({ queryKey: key, queryFn: () => adminApi.generations.get(id!), enabled: !!id })
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const r = q.data

  const resync = useMutation({
    mutationFn: () => adminApi.generations.resync(id!),
    onSuccess: d => { queryClient.setQueryData(key, d); void queryClient.invalidateQueries({ queryKey: ['admin', 'generations'] }); toast({ title: `已同步 · ${GEN_STATUS_LABEL[d.status]}`, tone: 'success' }) },
    onError: e => toast({ title: '同步失败', description: adminErrorText(e), tone: 'error' }),
  })

  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast({ title: '已复制', tone: 'success' }), () => toast({ title: '复制失败', tone: 'error' }))
  const block = r ? cancelBlockReason(r) : null
  const syncable = r && (r.status === 'queued' || r.status === 'running' || (r.status === 'succeeded' && r.charged_points == null))

  return (
    <Drawer
      open={!!id} onClose={onClose} wide title={r ? `记录 ${r.id}` : '生成记录'}
      footer={canAct && r && <>
        <Button icon={<RefreshCw />} loading={resync.isPending} loadingText="同步中" disabled={!syncable} disabledReason="已结束且已结算的记录不需要同步" onClick={() => resync.mutate()}>重新同步</Button>
        <Button variant="danger-ghost" icon={<Ban />} disabled={!!block} disabledReason={block ?? undefined} onClick={() => setCancelOpen(true)}>标记为已取消</Button>
      </>}
    >
      {q.isError ? <ErrorState reason="记录加载失败" action={{ label: '重试', onClick: () => void q.refetch() }} />
        : !r ? <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-40" /></div>
        : (
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(r.status)}>{GEN_STATUS_LABEL[r.status]}</Badge>
              {r.deleted_at && <Badge tone="outline">用户已删除</Badge>}
              <span className="text-sm text-muted">{r.user.email} · {fmtTime(r.created_at)}</span>
            </div>
            {r.status === 'failed' && (
              <div role="alert" className="rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
                <p className="font-semibold text-danger">{FAILURE_LABEL[r.failure_code ?? ''] ?? '失败'} <code className="ml-1 text-xs">{r.failure_code}</code></p>
                {r.failure_message && <p className="mt-1 font-mono text-xs text-muted">{r.failure_message}</p>}
              </div>
            )}
            <section>
              <h3 className="mb-1 text-sm font-bold">提示词</h3>
              <p className="whitespace-pre-wrap rounded-control bg-subtle p-3 text-sm leading-6">{r.prompt}</p>
            </section>
            <dl>
              <KV k="型号">{r.model}（{r.kind === 'video' ? '视频' : '图片'} · 来源 {r.source}）</KV>
              <KV k="参数">{Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}</KV>
              <KV k="扣点">{r.charged_points == null ? <Badge tone="warning">结算中</Badge> : fmtPoints(r.charged_points)} <span className="text-xs text-muted">· {r.billing.mode} {r.billing.state}</span></KV>
              <KV k="request_id"><Mono v={r.request_id} copy={copy} /></KV>
              <KV k="上游 request"><Mono v={r.upstream.request_id} copy={copy} /></KV>
              <KV k="上游 task"><Mono v={r.upstream.task_id} copy={copy} /> <span className="text-xs text-muted">{r.upstream.task_status}{r.upstream.last_synced_at && ` · 同步于 ${fmtTime(r.upstream.last_synced_at)}`}</span></KV>
              <KV k="幂等键"><Mono v={r.idempotency_key} copy={copy} /></KV>
            </dl>
            <Thumbs title="参考图" items={r.references} />
            <Thumbs title="结果" items={r.results} />
          </div>
        )}
      <Confirm
        open={cancelOpen} onOpenChange={o => { setCancelOpen(o); if (!o) setReason('') }} danger
        title="标记为已取消？" confirmLabel="标记取消" loadingText="处理中"
        description="只改本地记录状态，释放用户的「进行中」名额。不会退款、不改扣点：lanehub 模式下扣费和退回都在 lanehub 完成。"
        onConfirm={async () => {
          if (!reason.trim()) throw new Error('请填写原因')
          // Optimistic (§6): flip status now, roll back if the server refuses.
          const prev = queryClient.getQueryData<AdminGenerationDetail>(key)
          queryClient.setQueryData<AdminGenerationDetail>(key, old => old && { ...old, status: 'cancelled', failure_code: 'admin_cancelled' })
          try {
            queryClient.setQueryData(key, await adminApi.generations.cancel(id!, reason.trim()))
            void queryClient.invalidateQueries({ queryKey: ['admin', 'generations'] })
            toast({ title: '已标记为取消', tone: 'success' })
          } catch (e) { queryClient.setQueryData(key, prev); throw e }
        }}
      >
        <Textarea label="原因（写入审计日志）" value={reason} onChange={e => setReason(e.target.value)} maxLength={200} placeholder="例如：上游任务已丢失，用户反馈卡住" />
      </Confirm>
    </Drawer>
  )
}

function Mono({ v, copy }: { v: string | null; copy: (s: string) => void }) {
  if (!v) return <span className="text-muted">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      <code className="break-all text-xs">{v}</code>
      <button type="button" aria-label={`复制 ${v}`} onClick={() => copy(v)} className={cn('grid size-6 place-items-center rounded-[6px] text-muted hover:bg-subtle', focusRing)}><Copy className="size-3.5" /></button>
    </span>
  )
}

function Thumbs({ title, items }: { title: string; items: AdminGenerationDetail['results'] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold">{title} <span className="font-normal text-muted">{items.length}</span></h3>
      {items.length ? (
        <ul className="flex flex-wrap gap-2">
          {items.map(a => 'missing' in a ? <li key={a.id} className="w-32"><MissingMedia className="rounded-[8px]" /></li> : <li key={a.id} className="w-32"><a href={a.urls.orig} target="_blank" rel="noopener noreferrer" className={cn('block rounded-[8px]', focusRing)}><MediaImage asset={a} alt={title} className="rounded-[8px]" hideBadge /></a></li>)}
        </ul>
      ) : <p className="text-sm text-muted">无</p>}
    </section>
  )
}
