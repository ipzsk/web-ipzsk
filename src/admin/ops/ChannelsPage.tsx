import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { RefreshCw, Server } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, Skeleton, Tooltip, cn, toast } from '@/ui'
import { queryClient } from '@/shared/query'
import { opsApi, type ChannelQuery } from './opsApi'
import { CHANNEL_STATUS, fmtAgo, fmtCny, fmtLatency, withParam } from './lib'
import type { ChannelSummary, Page, Probe } from './types'
import { FilterInput, PageHeader, Select, adminErrorText } from '../ui'
import { useCan } from '../App'
import { Pager } from './LogsPage'

const SIZE = 100
const KEY = ['admin', 'ops', 'channels'] as const
const dot = { 1: 'bg-success', 2: 'bg-muted', 3: 'bg-danger' } as const
const th = 'border-b border-line py-2 pr-3 text-left text-xs font-semibold text-muted whitespace-nowrap'
const td = 'border-b border-line py-2 pr-3 whitespace-nowrap'

export function ChannelsPage() {
  // ponytail: gateway gates probe on operator+ (「ops.write」); no such cap in lib.ts yet, generations.act is the same role set. Add `ops.write` when roles diverge.
  const canProbe = useCan('generations.act')
  const [sp, setSp] = useSearchParams()
  const q: ChannelQuery = useMemo(() => ({
    page: Math.max(1, Number(sp.get('page')) || 1), size: SIZE,
    status: sp.get('status') ?? '', type: sp.get('type') ?? '', group: sp.get('group') ?? '', keyword: sp.get('keyword') ?? '',
  }), [sp])
  const setParam = (k: string, v: string | null) => setSp(cur => withParam(cur, k, v), { replace: k !== 'page' })
  const [text, setText] = useState({ keyword: q.keyword ?? '', group: q.group ?? '', type: q.type ?? '' })
  useEffect(() => {
    const t = setTimeout(() => { for (const k of ['keyword', 'group', 'type'] as const) if (text[k].trim() !== (sp.get(k) ?? '')) setParam(k, text[k].trim()) }, 300)
    return () => clearTimeout(t)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({ queryKey: [...KEY, q], queryFn: () => opsApi.channels(q), placeholderData: keepPreviousData })
  const rows = list.data?.items ?? []
  const [failures, setFailures] = useState<Record<number, string>>({})

  const probe = useMutation({
    mutationFn: (id: number) => opsApi.probe(id),
    onSuccess: (p: Probe) => {
      queryClient.setQueriesData<Page<ChannelSummary>>({ queryKey: KEY }, old => old && {
        ...old,
        items: old.items.map(c => c.id !== p.channel_id ? c
          : p.state === 'ok' ? { ...c, balance_cny: p.balance_cny, balance_checked_at: p.checked_at }
          : p.state === 'unsupported' ? { ...c, balance_supported: false }
          : c),
      })
      setFailures(f => { const { [p.channel_id]: _, ...rest } = f; return p.state === 'failed' ? { ...rest, [p.channel_id]: p.message || '探测失败' } : rest })
      if (p.state === 'ok') toast({ title: `余额 ${fmtCny(p.balance_cny)} · ${fmtLatency(p.latency_ms)}`, tone: 'success' })
    },
    onError: e => toast({ title: '探测失败', description: adminErrorText(e), tone: 'error' }),
  })

  return (
    <section>
      <PageHeader title="渠道">{list.data && <span className="text-sm text-muted tabular-nums">共 {list.data.total} 个</span>}</PageHeader>
      <div role="search" className="mb-4 flex flex-wrap items-end gap-3">
        <FilterInput label="搜索" placeholder="名称或 id" className="w-48" value={text.keyword} onChange={e => setText(t => ({ ...t, keyword: e.target.value }))} />
        <Select label="状态" value={q.status} onChange={e => setParam('status', e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(CHANNEL_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <FilterInput label="类型 id" placeholder="如 1" inputMode="numeric" className="w-24" value={text.type} onChange={e => setText(t => ({ ...t, type: e.target.value }))} />
        <FilterInput label="分组" placeholder="如 official" className="w-36" value={text.group} onChange={e => setText(t => ({ ...t, group: e.target.value }))} />
        {['keyword', 'status', 'type', 'group'].some(k => sp.get(k)) && <Button size="sm" variant="ghost" onClick={() => { setText({ keyword: '', group: '', type: '' }); setSp({}, { replace: true }) }}>清除筛选</Button>}
      </div>

      {list.isError ? <ErrorState reason="渠道加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void list.refetch() }} />
        : list.isPending ? <div className="grid gap-1">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : !rows.length ? <EmptyState icon={Server} text="没有符合筛选的渠道" />
        : (
          <div className={cn('overflow-x-auto rounded-card border border-line bg-card pl-3', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-[13px]">
              <thead><tr>
                {['渠道', '类型', '档位'].map(h => <th key={h} className={th}>{h}</th>)}
                {['优先级', '权重'].map(h => <th key={h} className={cn(th, 'text-right')}>{h}</th>)}
                <th className={th}>余额</th>
                {['已用', '模型'].map(h => <th key={h} className={cn(th, 'text-right')}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.id} className="hover:bg-subtle">
                    <td className={td}>
                      <span className="inline-flex items-center gap-2">
                        <span role="img" aria-label={CHANNEL_STATUS[c.status]} title={CHANNEL_STATUS[c.status]} className={cn('size-2 shrink-0 rounded-full', dot[c.status])} />
                        <span className={cn('font-medium', c.status !== 1 && 'text-muted')}>{c.name}</span>
                        <span className="text-xs text-muted tabular-nums">#{c.id}</span>
                        {c.status !== 1 && <span className="text-xs text-muted">{CHANNEL_STATUS[c.status]}</span>}
                      </span>
                    </td>
                    <td className={cn(td, 'text-xs')}>{c.vendor} <span className="text-muted tabular-nums">· {c.type}</span></td>
                    <td className={td}><span className="flex gap-1">{c.lanes.length ? c.lanes.map(l => <Badge key={l} tone="outline" className="h-5 px-2 font-mono">{l}</Badge>) : <span className="text-xs text-muted">未分档</span>}</span></td>
                    <td className={cn(td, 'text-right tabular-nums')}>{c.priority}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{c.weight}</td>
                    <td className={td}>
                      <span className="flex w-60 items-center justify-between gap-2">
                        {!c.balance_supported ? <span className="text-xs text-muted">无余额接口</span>
                          : <span className="tabular-nums">{fmtCny(c.balance_cny)} <span className="text-xs text-muted">· {fmtAgo(c.balance_checked_at)}</span></span>}
                        {canProbe && c.balance_supported && (
                          <Button size="sm" variant="ghost" icon={<RefreshCw />} className="h-7 px-2"
                            loading={probe.isPending && probe.variables === c.id} loadingText="探测中" disabled={probe.isPending && probe.variables !== c.id}
                            onClick={() => probe.mutate(c.id)}>探测</Button>
                        )}
                      </span>
                      {failures[c.id] && <Tooltip content={failures[c.id]}><p tabIndex={0} className="mt-0.5 max-w-72 truncate text-xs text-danger">{failures[c.id]}</p></Tooltip>}
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmtCny(c.used_cny)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{c.models_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {list.data && list.data.total > SIZE && <Pager page={q.page} size={SIZE} total={list.data.total} onPage={p => setParam('page', p > 1 ? String(p) : null)} />}
    </section>
  )
}
