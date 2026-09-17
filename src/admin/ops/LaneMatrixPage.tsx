import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useBlocker, useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AlertTriangle, GripVertical, Plus, RefreshCw, SearchX } from 'lucide-react'
import { Badge, Button, Checkbox, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, Skeleton, cn, focusRing, toast } from '@/ui'
import { ApiError } from '@/shared/api'
import { queryClient } from '@/shared/query'
import { useCan } from '../App'
import { Confirm, Drawer, FilterInput, PageHeader, Select, adminErrorText } from '../ui'
import { laneApi } from './laneApi'
import { opsApi } from './opsApi'
import { fmtCny as fmtMoney, isLowBalance } from './lib'
import { BalanceText } from './ChannelsPage'
import { applyPatch, applyReorder, canRemoveFromLane, cellIds, changeCount, diffRows, effectiveChannels, rowChannelIds, toChanges, type Draft } from './laneDraft'
import type { LaneChannel, LaneMatrix } from './types'

type Row = LaneMatrix['rows'][number]
type Price = Row['prices'][string]
type ProbeNote = { state: 'failed' | 'unsupported'; message: string }

const KEY = ['admin', 'ops', 'lane-matrix'] as const
const MODALITY: Record<string, string> = { image: '图片', video: '视频', text: '文本' }
const RESOLUTIONS = ['480p', '720p', '1080p']
const DURATIONS = [5, 10]
const ROW_H = 60, GROUP_H = 30, MODEL_W = 220, LANE_W = 230, HEALTH_W = 120

const STATUS: Record<number, { label: string; dot: string }> = {
  1: { label: '启用', dot: 'bg-success' },
  2: { label: '已停用', dot: 'bg-muted/50' },
  3: { label: '自动禁用', dot: 'bg-danger' },
}
const Dot = ({ status }: { status: number }) => <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', STATUS[status]?.dot)} />

const fmtCny = (n: number) => `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
const fmtPrice = (p: Price | undefined) => p ? `${fmtCny(p.cny)}/${p.unit}` : '无价格'
function fmtAgo(unix: number | null, now = Date.now()) {
  if (unix == null) return '未检查'
  const m = Math.max(0, Math.round((now / 1000 - unix) / 60))
  return m < 1 ? '刚刚' : m < 60 ? `${m}分钟前` : m < 1440 ? `${Math.floor(m / 60)}小时前` : `${Math.floor(m / 1440)}天前`
}
const opsErrorText = (e: unknown) => {
  if (e instanceof ApiError && e.code === 'lanehub_unavailable') return 'lanehub 未配置或不可用。'
  if (e instanceof ApiError && e.code === 'lanehub_api_failed') return 'lanehub 拒绝了这次操作。'
  return adminErrorText(e)
}
const lanehubDetail = (e: unknown) => {
  const b = e instanceof ApiError ? e.body as { detail?: string; error?: { detail?: string } } | null : null
  return b?.error?.detail ?? b?.detail ?? null
}
const balanceHint = (c: LaneChannel) => isLowBalance(c) ? `余额低 ${fmtMoney(c.balance_cny)}` : null

export function LaneMatrixPage() {
  const writable = useCan('ops.write')
  const [sp, setSp] = useSearchParams()
  const set = (k: string, v: string) => setSp(cur => { const p = new URLSearchParams(cur); if (v) p.set(k, v); else p.delete(k); return p }, { replace: true })
  const scenario = { resolution: sp.get('resolution') ?? '', duration: sp.get('duration') ?? '' }
  const modalities = (sp.get('modality') ?? '').split(',').filter(Boolean)
  const vendor = sp.get('vendor') ?? '', configured = sp.get('configured') === '1'

  const [text, setText] = useState(sp.get('q') ?? '')
  useEffect(() => { if (text.trim() === (sp.get('q') ?? '')) return; const t = setTimeout(() => set('q', text.trim()), 250); return () => clearTimeout(t) }) // eslint-disable-line react-hooks/exhaustive-deps

  const q = useQuery({ queryKey: [...KEY, scenario], queryFn: () => laneApi.matrix(scenario), placeholderData: keepPreviousData })
  const m = q.data

  const [draft, setDraft] = useState<Draft>({})
  const n = changeCount(draft)
  const chans = useMemo(() => m ? effectiveChannels(m, draft) : {}, [m, draft])

  const [probeNotes, setProbeNotes] = useState<Record<number, ProbeNote>>({})
  const [probing, setProbing] = useState<Set<number>>(new Set())
  const probe = async (id: number) => {
    setProbing(s => new Set(s).add(id))
    try {
      const r = await opsApi.probe(id)
      if (r.state === 'ok') {
        queryClient.setQueriesData<LaneMatrix>({ queryKey: KEY }, old => old?.channels[id] ? { ...old, channels: { ...old.channels, [id]: { ...old.channels[id]!, balance_cny: r.balance_cny, balance_raw: r.balance_raw, balance_unit: r.balance_unit, balance_checked_at: r.checked_at } } } : old)
        setProbeNotes(({ [id]: _, ...rest }) => rest)
      } else setProbeNotes(s => ({ ...s, [id]: { state: r.state as ProbeNote['state'], message: r.message } }))
    } catch (e) {
      setProbeNotes(s => ({ ...s, [id]: { state: 'failed', message: opsErrorText(e) } }))
    } finally { setProbing(s => { const x = new Set(s); x.delete(id); return x }) }
  }

  const save = useMutation({
    mutationFn: () => laneApi.save(toChanges(draft)),
    onSuccess: r => { setDraft({}); setCompare(false); toast({ title: `已保存 ${r.results.length} 个渠道的改动`, tone: 'success' }); void queryClient.invalidateQueries({ queryKey: KEY }) },
    onError: e => toast({ title: '保存失败，改动仍保留', description: [opsErrorText(e), lanehubDetail(e)].filter(Boolean).join(' '), tone: 'error' }),
  })
  const [compare, setCompare] = useState(false)
  const [discard, setDiscard] = useState(false)

  const blocker = useBlocker(({ currentLocation, nextLocation }) => n > 0 && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!n) return
    const on = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', on)
    return () => removeEventListener('beforeunload', on)
  }, [n])

  const vendors = useMemo(() => [...new Set(m?.rows.flatMap(r => r.vendors) ?? [])].sort(), [m])
  const kw = (sp.get('q') ?? '').toLowerCase()
  /** Rows grouped by first vendor; items are group headers or rows. */
  const items = useMemo(() => {
    if (!m) return []
    const rows = m.rows.filter(r => (!kw || r.model.toLowerCase().includes(kw))
      && (!modalities.length || r.modalities.some(x => modalities.includes(x)))
      && (!vendor || r.vendors.includes(vendor))
      && (!configured || m.lanes.some(l => cellIds(r, l.symbol, chans).length)))
    const groups = new Map<string, Row[]>()
    for (const r of rows) { const v = r.vendors[0] ?? '其他'; groups.set(v, [...(groups.get(v) ?? []), r]) }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).flatMap(([v, rs]) => [{ group: v, count: rs.length } as const, ...rs.map(row => ({ row }))])
  }, [m, chans, kw, modalities.join(), vendor, configured]) // eslint-disable-line react-hooks/exhaustive-deps

  const scroller = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: i => 'group' in items[i]! ? GROUP_H : ROW_H, getItemKey: i => { const it = items[i]!; return 'group' in it ? `g-${it.group}` : it.row.model }, overscan: 8 })
  const width = m ? `max(${MODEL_W + m.lanes.length * LANE_W + HEALTH_W}px, 100%)` : 0
  const cols = m ? `${MODEL_W}px repeat(${m.lanes.length}, ${LANE_W}px) minmax(${HEALTH_W}px, 1fr)` : ''

  const cellKey = sp.get('cell') // `${lane}|${model}`
  const [cellLane, cellModel] = cellKey?.split('|') ?? []
  const openRow = m?.rows.find(r => r.model === cellModel)
  const openLane = m?.lanes.find(l => l.symbol === cellLane)

  const toggleModality = (x: string) => set('modality', (modalities.includes(x) ? modalities.filter(y => y !== x) : [...modalities, x]).join(','))
  const scenarioValue = m ? `${scenario.resolution || m.scenario.resolution}|${scenario.duration || m.scenario.duration}` : ''

  return (
    <section aria-labelledby="lane-title" className="pb-20">
      <PageHeader title="线路矩阵">
        <Select label="场景" value={scenarioValue} onChange={e => { const [r, d] = e.target.value.split('|'); setSp(cur => { const p = new URLSearchParams(cur); p.set('resolution', r!); p.set('duration', d!); return p }, { replace: true }) }}>
          {RESOLUTIONS.flatMap(r => DURATIONS.map(d => <option key={`${r}|${d}`} value={`${r}|${d}`}>{r} · {d}s</option>))}
        </Select>
        {q.isFetching && !q.isPending && <span className="text-xs text-muted" role="status">更新中…</span>}
      </PageHeader>
      <h2 id="lane-title" className="sr-only">模型 × 档位</h2>

      <div role="search" className="mb-3 flex flex-wrap items-end gap-3">
        <FilterInput label="模型" type="search" value={text} onChange={e => setText(e.target.value)} placeholder="搜索模型…" className="w-56" />
        <div className="grid gap-1 text-xs font-semibold text-muted">
          <span id="modality-label">类型</span>
          <div role="group" aria-labelledby="modality-label" className="flex h-9 items-center gap-1">
            {Object.entries(MODALITY).map(([k, label]) => (
              <Button key={k} size="sm" variant="secondary" aria-pressed={modalities.includes(k)} onClick={() => toggleModality(k)}>{label}</Button>
            ))}
          </div>
        </div>
        <Select label="厂商" value={vendor} onChange={e => set('vendor', e.target.value)}>
          <option value="">全部厂商</option>
          {vendors.map(x => <option key={x} value={x}>{x}</option>)}
        </Select>
        <div className="flex h-9 items-center"><Checkbox label="只看已配置" checked={configured} onCheckedChange={c => set('configured', c ? '1' : '')} /></div>
        {m && <span className="ml-auto pb-2 text-sm text-muted tabular-nums">{items.filter(i => 'row' in i).length} / {m.rows.length} 个模型</span>}
      </div>

      {q.isError ? <ErrorState reason={`线路矩阵加载失败：${opsErrorText(q.error)}`} action={{ label: '重试', onClick: () => void q.refetch() }} />
        : !m ? <div className="grid gap-1">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
        : !items.length ? <EmptyState icon={SearchX} text="没有符合筛选的模型" action={{ label: '清除筛选', onClick: () => { setText(''); setSp(cur => { const p = new URLSearchParams(); for (const k of ['resolution', 'duration']) if (cur.get(k)) p.set(k, cur.get(k)!); return p }, { replace: true }) } }} />
        : (
          <div ref={scroller} role="table" aria-label="线路矩阵" aria-rowcount={items.length + 1} className="h-[calc(100dvh-250px)] min-h-96 overflow-auto rounded-card border border-line bg-card">
            <div role="row" className="sticky top-0 z-20 grid h-10 border-b border-line bg-card text-xs font-semibold text-muted" style={{ gridTemplateColumns: cols, width }}>
              <span role="columnheader" className="sticky left-0 z-10 flex items-center bg-card px-3">模型</span>
              {m.lanes.map(l => <span key={l.symbol} role="columnheader" className="flex items-center gap-1.5 border-l border-line px-3"><span className="text-ink">{l.name}</span><span className="tabular-nums">×{l.ratio}</span></span>)}
              <span role="columnheader" className="flex items-center border-l border-line px-3">健康</span>
            </div>
            <div role="rowgroup" style={{ height: v.getTotalSize(), width, position: 'relative' }}>
              {v.getVirtualItems().map(vi => {
                const it = items[vi.index]!
                const style: CSSProperties = { position: 'absolute', top: 0, left: 0, width, height: vi.size, transform: `translateY(${vi.start}px)` }
                if ('group' in it) return (
                  <div key={`g-${it.group}`} role="row" style={style} className="border-b border-line bg-subtle/60">
                    <span role="rowheader" className="sticky left-0 flex h-full w-fit items-center gap-2 px-3 text-xs font-bold uppercase tracking-wide text-ink/80">{m.vendor_icons[it.group] && <img src={m.vendor_icons[it.group]} alt="" className="size-4" />}{it.group}<span className="font-normal text-muted">{it.count}</span></span>
                  </div>
                )
                const r = it.row
                return (
                  <div key={r.model} role="row" style={{ ...style, gridTemplateColumns: cols }} className="grid border-b border-line text-sm">
                    <span role="rowheader" className="sticky left-0 z-10 flex min-w-0 flex-col justify-center bg-card px-3">
                      <span className="truncate font-semibold">{r.model}</span>
                      <span className="text-xs text-muted">{r.modalities.map(x => MODALITY[x] ?? x).join(' · ')}</span>
                    </span>
                    {m.lanes.map(l => <Cell key={l.symbol} row={r} lane={l} chans={chans} server={m} active={cellKey === `${l.symbol}|${r.model}`} onOpen={() => setSp(cur => { const p = new URLSearchParams(cur); p.set('cell', `${l.symbol}|${r.model}`); return p })} />)}
                    <Health row={r} lanes={m.lanes.map(l => l.symbol)} chans={chans} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

      {m && openRow && openLane && (
        <CellDrawer
          m={m} row={openRow} lane={openLane} chans={chans} writable={writable} dirty={n}
          probeNotes={probeNotes} probing={probing} onProbe={probe}
          onClose={() => set('cell', '')}
          patch={(id, p) => setDraft(d => applyPatch(d, m.channels[id]!, p))}
          reorder={ids => setDraft(d => applyReorder(d, m, ids))}
        />
      )}

      {writable && n > 0 && (
        <div role="region" aria-label="未保存的改动" className="sticky bottom-4 z-30 mt-4 flex flex-wrap items-center gap-2 rounded-card bg-ink px-4 py-2.5 text-sm text-acid shadow-xl">
          <span className="font-semibold" aria-live="polite">{n} 处改动未保存</span>
          <span className="text-xs text-card/70">涉及 {Object.keys(draft).length} 个渠道</span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setCompare(true)}>查看对比</Button>
            <Button size="sm" variant="ghost" className="text-acid hover:bg-card/10" onClick={() => setDiscard(true)}>放弃</Button>
            <Button size="sm" className="border-acid bg-acid hover:bg-acid/90" loading={save.isPending} loadingText="保存中" onClick={() => save.mutate()}>保存</Button>
          </span>
        </div>
      )}

      {m && (
        <Dialog open={compare} onOpenChange={setCompare}>
          <DialogContent title="改动对比" description="保存时一次提交，每个渠道一条；优先级是渠道级的，会在它所在的每一档同时生效。" className="max-w-2xl">
            <CompareTable m={m} draft={draft} />
            {save.isError && <p role="alert" className="mt-3 text-sm text-danger">{opsErrorText(save.error)} {lanehubDetail(save.error)}</p>}
            <DialogFooter>
              <Button onClick={() => setCompare(false)}>继续编辑</Button>
              <Button variant="primary" loading={save.isPending} loadingText="保存中" onClick={() => save.mutate()}>保存 {n} 处改动</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Confirm open={discard} onOpenChange={setDiscard} title="放弃全部改动？" description={`${n} 处未保存的改动会被丢弃。`} confirmLabel="放弃改动" danger onConfirm={async () => setDraft({})} />
      <Confirm
        open={blocker.state === 'blocked'} onOpenChange={o => { if (!o) blocker.reset?.() }}
        title="离开前保存吗？" description="线路矩阵有未保存的改动，离开后会丢失。" confirmLabel="放弃改动并离开" danger
        onConfirm={async () => blocker.proceed?.()}
      />
    </section>
  )
}

function Cell({ row, lane, chans, server, active, onOpen }: { row: Row; lane: LaneMatrix['lanes'][number]; chans: Record<string, LaneChannel>; server: LaneMatrix; active: boolean; onOpen: () => void }) {
  const ids = cellIds(row, lane.symbol, chans)
  const changed = ids.join() !== cellIds(row, lane.symbol, server.channels).join() || ids.some(id => chans[id]!.status !== server.channels[id]!.status)
  const primary = chans[ids.find(id => chans[id]!.status === 1) ?? ids[0]!]
  const hint = primary && balanceHint(primary)
  const label = primary ? `${row.model} · ${lane.name}：首选 ${primary.name}，共 ${ids.length} 个渠道` : `${row.model} · ${lane.name}：待采购`
  return (
    <button type="button" role="cell" aria-label={label} onClick={onOpen}
      className={cn('relative flex min-w-0 flex-col justify-center gap-0.5 border-l border-line px-3 text-left hover:bg-subtle', focusRing, 'focus-visible:outline-offset-[-2px]', active && 'bg-subtle')}>
      {changed && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-acid-deep" title="有未保存改动" />}
      {primary ? <>
        <span className="flex min-w-0 items-center gap-1.5">
          <Dot status={primary.status} />
          <span className={cn('truncate font-medium', primary.status !== 1 && 'text-muted line-through')}>{primary.name}</span>
          {ids.length > 1 && <span className="shrink-0 text-xs text-muted">+{ids.length - 1}</span>}
          <span className="ml-auto shrink-0 text-xs tabular-nums">{fmtPrice(row.prices[primary.id])}</span>
        </span>
        {hint ? <span className="text-[11px] text-warning">{hint}</span> : <span className="text-[11px] text-muted"><BalanceText c={primary} inButton className="text-[11px] text-muted" />{primary.balance_supported && !!primary.balance_checked_at && ` · ${fmtAgo(primary.balance_checked_at)}`}</span>}
      </> : <span className="text-xs text-muted">待采购</span>}
    </button>
  )
}

function Health({ row, lanes, chans }: { row: Row; lanes: string[]; chans: Record<string, LaneChannel> }) {
  const used = [...new Set(lanes.flatMap(l => cellIds(row, l, chans)))].map(id => chans[id]!)
  const ok = used.filter(c => c.status === 1)
  const checked = Math.max(...ok.map(c => c.balance_checked_at ?? 0))
  const tone = !ok.length ? 'text-danger' : ok.length < used.length ? 'text-warning' : 'text-success'
  return (
    <span role="cell" className="flex flex-col justify-center border-l border-line px-3 text-xs">
      <span className={cn('font-semibold tabular-nums', tone)}>{ok.length}/{used.length} 可用</span>
      <span className="text-muted">{checked > 0 ? fmtAgo(checked) : '未检查'}</span>
    </span>
  )
}

function CellDrawer({ m, row, lane, chans, writable, dirty, probeNotes, probing, onProbe, onClose, patch, reorder }: {
  m: LaneMatrix; row: Row; lane: LaneMatrix['lanes'][number]; chans: Record<string, LaneChannel>; writable: boolean; dirty: number
  probeNotes: Record<number, ProbeNote>; probing: Set<number>; onProbe: (id: number) => void; onClose: () => void
  patch: (id: number, p: { lanes?: string[]; status?: 1 | 2 }) => void; reorder: (ids: number[]) => void
}) {
  const ids = cellIds(row, lane.symbol, chans)
  const others = rowChannelIds(row).filter(id => chans[id] && !ids.includes(id))
  const laneName = (s: string) => m.lanes.find(l => l.symbol === s)?.name ?? s

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const where = (id: UniqueIdentifier | undefined) => { const i = ids.indexOf(Number(id)); return i < 0 ? '' : `「${chans[ids[i]!]!.name}」（第 ${i + 1} / ${ids.length} 位）` }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `已拿起${where(active.id)}`,
    onDragOver: ({ active, over }) => !over ? `${where(active.id)}不在可放置区域` : over.id === active.id ? `已拿起${where(active.id)}，当前在原位` : `${where(active.id)}移到${where(over.id)}的位置`,
    onDragEnd: ({ active, over }) => over ? `已放下${where(active.id)}，放到${where(over.id)}的位置，优先级已调整` : `已放下${where(active.id)}`,
    onDragCancel: ({ active }) => `已取消拖动，${where(active.id)}回到原位`,
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    reorder(arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id))))
  }

  const rowProps = (id: number) => ({ c: chans[id]!, price: row.prices[id], writable, note: probeNotes[id], probing: probing.has(id), onProbe: () => onProbe(id), onStatus: () => patch(id, { status: chans[id]!.status === 1 ? 2 : 1 }), laneName })

  return (
    <Drawer open onClose={onClose} wide title={<>{row.model} <span className="font-normal text-muted">· {lane.name} ×{lane.ratio} · {m.scenario.resolution} · {m.scenario.duration}s</span></>}
      footer={<>{dirty > 0 && <span className="mr-auto self-center text-sm text-muted">{dirty} 处改动未保存，在页面底部保存</span>}<Button onClick={onClose}>完成</Button></>}>
      <section aria-labelledby="in-lane">
        <h3 id="in-lane" className="mb-1 text-sm font-bold">本档渠道 <span className="font-normal text-muted">{ids.length}</span></h3>
        {writable && ids.length > 1 && <p className="mb-2 text-xs text-muted">从上到下依次尝试。拖动 ⋮⋮ 调整顺序（键盘：聚焦手柄按空格拿起，方向键移动，空格放下）。</p>}
        {!ids.length ? <p className="rounded-control bg-subtle px-3 py-4 text-sm text-muted">待采购：这一档还没有渠道{writable && others.length ? '，从下方加入' : ''}。</p> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '按空格拿起，用方向键移动，再按空格放下' }, announcements }}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={!writable}>
              <ul className="grid gap-1.5">
                {ids.map(id => (
                  <SortableChannel key={id} id={id} writable={writable}>
                    {handle => <ChannelRow {...rowProps(id)} handle={handle} action={writable && (canRemoveFromLane(chans[id]!)
                      ? <Button size="sm" variant="ghost" onClick={() => patch(id, { lanes: chans[id]!.lanes.filter(l => l !== lane.symbol) })}>移出</Button>
                      : null)} />}
                  </SortableChannel>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>
      <section aria-labelledby="other-lane" className="mt-6">
        <h3 id="other-lane" className="mb-2 text-sm font-bold">其他可用渠道 <span className="font-normal text-muted">{others.length}</span></h3>
        {!others.length ? <p className="text-sm text-muted">能服务这个模型的渠道都已在本档。</p> : (
          <ul className="grid gap-1.5">
            {others.map(id => <li key={id}><ChannelRow {...rowProps(id)} action={writable && <Button size="sm" icon={<Plus />} onClick={() => patch(id, { lanes: [...chans[id]!.lanes, lane.symbol] })}>加入</Button>} /></li>)}
          </ul>
        )}
      </section>
    </Drawer>
  )
}

function SortableChannel({ id, writable, children }: { id: number; writable: boolean; children: (handle: ReactNode) => ReactNode }) {
  const s = useSortable({ id })
  const style: CSSProperties = { transform: s.transform ? `translate3d(0, ${s.transform.y}px, 0)` : undefined, transition: s.transition, position: 'relative', zIndex: s.isDragging ? 5 : undefined }
  const handle = writable && (
    <button type="button" aria-label="拖动排序" className={cn('grid size-8 shrink-0 cursor-grab place-items-center rounded-[8px] text-muted hover:bg-subtle active:cursor-grabbing', focusRing)} {...s.attributes} {...s.listeners}>
      <GripVertical />
    </button>
  )
  return <li ref={s.setNodeRef} style={style} className={cn(s.isDragging && 'opacity-90 shadow-lg')}>{children(handle)}</li>
}

function ChannelRow({ c, price, writable, note, probing, onProbe, onStatus, handle, action, laneName }: {
  c: LaneChannel; price: Price | undefined; writable: boolean; note?: ProbeNote; probing: boolean; onProbe: () => void; onStatus: () => void
  handle?: ReactNode; action?: ReactNode; laneName: (s: string) => string
}) {
  const unsupported = !c.balance_supported || note?.state === 'unsupported'
  const hint = balanceHint(c)
  return (
    <div className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-control border border-line bg-card px-2 py-2', c.status !== 1 && 'bg-subtle/50')}>
      <span className={cn('flex items-center gap-1', !handle && 'pl-2')}>{handle}<Dot status={c.status} /></span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className={cn('truncate font-semibold', c.status !== 1 && 'text-muted')}>{c.name}</span>
          <span className="text-xs text-muted">#{c.id}</span>
          {c.status !== 1 && <Badge tone={c.status === 3 ? 'danger' : 'outline'} className="h-5">{STATUS[c.status]!.label}</Badge>}
          <span className="tabular-nums">{fmtPrice(price)}</span>
          <span className="text-xs text-muted tabular-nums">优先级 {c.priority}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {unsupported ? <span className="rounded-[4px] bg-subtle px-1.5 text-muted">无余额接口</span>
            : <span className={cn('tabular-nums', hint && 'text-warning')}>余额 <BalanceText c={c} className={cn(hint && 'text-warning')} />{!!c.balance_checked_at && ` · ${fmtAgo(c.balance_checked_at)}`}</span>}
          {note?.state === 'failed' && <span role="alert" className="text-danger">探测失败：{note.message}</span>}
          {c.lanes.length > 1 && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle className="size-3" aria-hidden />同时在 {c.lanes.length} 档（{c.lanes.map(laneName).join('、')}），改动会一起生效</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {writable && !unsupported && <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={probing} loadingText="探测中" onClick={onProbe} aria-label={`探测 ${c.name} 余额`}>探测</Button>}
        {writable && <Button size="sm" variant="ghost" onClick={onStatus} aria-label={`${c.status === 1 ? '停用' : '启用'} ${c.name}`}>{c.status === 1 ? '停用' : '启用'}</Button>}
        {action}
      </div>
    </div>
  )
}

function CompareTable({ m, draft }: { m: LaneMatrix; draft: Draft }) {
  const laneName = (s: string) => m.lanes.find(l => l.symbol === s)?.name ?? s
  const lanesText = (xs: string[]) => xs.length ? xs.map(laneName).join('、') : '无档位'
  const th = 'border-b border-line py-2 pr-3 text-left text-xs font-semibold text-muted'
  const td = 'border-b border-line py-2 pr-3 align-top'
  const Change = ({ on, before, after }: { on: boolean; before: ReactNode; after: ReactNode }) =>
    on ? <span><span className="text-muted line-through">{before}</span> → <strong>{after}</strong></span> : <span className="text-muted">{after}</span>
  return (
    <div className="max-h-[60dvh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead><tr><th className={th}>渠道</th><th className={th}>档位</th><th className={th}>优先级</th><th className={th}>状态</th></tr></thead>
        <tbody>
          {diffRows(m, draft).map(({ id, name, before, after, patch }) => (
            <tr key={id}>
              <td className={td}><span className="font-semibold">{name}</span> <span className="text-xs text-muted">#{id}</span></td>
              <td className={td}><Change on={!!patch.lanes} before={lanesText(before.lanes)} after={lanesText(after.lanes)} /></td>
              <td className={cn(td, 'tabular-nums')}><Change on={patch.priority != null} before={before.priority} after={after.priority} /></td>
              <td className={td}><Change on={patch.status != null} before={STATUS[before.status]!.label} after={STATUS[after.status]!.label} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
