import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Copy, ScrollText } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, IconButton, Skeleton, cn, focusRing, toast } from '@/ui'
import { opsApi } from './opsApi'
import { LOG_KEYS, LOG_TEXT_KEYS, LOG_TYPE, fmtCny, fmtInt, fmtLatency, fmtUnix, logQueryFromParams, opsErrorText, withParam } from './lib'
import type { LogEntry } from './types'
import { Drawer, FilterInput, KV, PageHeader, Select } from '../ui'

const typeTone = { 1: 'success', 2: 'neutral', 3: 'warning', 4: 'outline' } as const
const TEXT_LABEL: Record<(typeof LOG_TEXT_KEYS)[number], [string, string, string]> = {
  model: ['模型', 'seedream-4.0', 'w-36'], username: ['用户名', '精确匹配', 'w-28'], channel_id: ['渠道 id', '123', 'w-20'],
  request_id: ['request_id', '精确匹配', 'w-36'], upstream_request_id: ['上游 request_id', '精确匹配', 'w-36'],
}
const th = 'sticky top-0 z-10 border-b border-line bg-card py-2 pr-3 text-left text-xs font-semibold text-muted whitespace-nowrap'
const td = 'border-b border-line py-1.5 pr-3 whitespace-nowrap'

export function LogsPage() {
  const [sp, setSp] = useSearchParams()
  const q = useMemo(() => logQueryFromParams(sp), [sp])
  const setParam = (k: string, v: string | null) => setSp(cur => withParam(cur, k, v), { replace: k !== 'page' })
  const [text, setText] = useState(() => Object.fromEntries(LOG_TEXT_KEYS.map(k => [k, sp.get(k) ?? ''])) as Record<(typeof LOG_TEXT_KEYS)[number], string>)
  useEffect(() => {
    const t = setTimeout(() => { for (const k of LOG_TEXT_KEYS) if (text[k].trim() !== (sp.get(k) ?? '')) setParam(k, text[k].trim()) }, 300)
    return () => clearTimeout(t)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({ queryKey: ['admin', 'ops', 'logs', q], queryFn: () => opsApi.logs(q), placeholderData: keepPreviousData })
  const { page: _p, size: _s, ...filter } = q
  const stat = useQuery({ queryKey: ['admin', 'ops', 'logs-stat', filter], queryFn: () => opsApi.logStat(q) })
  const [open, setOpen] = useState<LogEntry | null>(null)
  const rows = list.data?.items ?? []

  return (
    <section>
      <PageHeader title="日志">
        <span className="text-sm text-muted tabular-nums" aria-live="polite">
          {list.data && <>共 {fmtInt(list.data.total)} 条 · </>}合计 {stat.isError ? '—' : stat.data ? <b className="text-ink">{fmtCny(stat.data.amount_cny)}</b> : '…'}
        </span>
      </PageHeader>
      <div role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <FilterInput label="从" type="date" className="w-36" value={sp.get('from') ?? ''} max={sp.get('to') || undefined} onChange={e => setParam('from', e.target.value)} />
        <FilterInput label="到" type="date" className="w-36" value={sp.get('to') ?? ''} min={sp.get('from') || undefined} onChange={e => setParam('to', e.target.value)} />
        <Select label="类型" value={sp.get('type') ?? ''} onChange={e => setParam('type', e.target.value)}>
          <option value="">全部类型</option>
          {Object.entries(LOG_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        {LOG_TEXT_KEYS.map(k => (
          <FilterInput key={k} label={TEXT_LABEL[k][0]} placeholder={TEXT_LABEL[k][1]} className={TEXT_LABEL[k][2]} inputMode={k === 'channel_id' ? 'numeric' : undefined}
            value={text[k]} onChange={e => setText(t => ({ ...t, [k]: e.target.value }))} />
        ))}
        {LOG_KEYS.some(k => sp.get(k)) && <Button size="sm" variant="ghost" onClick={() => { setText(t => Object.fromEntries(Object.keys(t).map(k => [k, ''])) as typeof t); setSp({}, { replace: true }) }}>清除筛选</Button>}
      </div>

      {list.isError ? <ErrorState reason={opsErrorText(list.error)} action={{ label: '重试', onClick: () => void list.refetch() }} />
        : list.isPending ? <div className="grid gap-1">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        : !rows.length ? <EmptyState icon={ScrollText} text="没有符合筛选的日志" />
        : (
          <div className={cn('max-h-[calc(100dvh-280px)] min-h-80 overflow-auto rounded-card border border-line bg-card pl-3', list.isPlaceholderData && 'opacity-60')}>
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
              <thead><tr>
                {['时间', '类型', '用户 / 令牌', '模型', '渠道'].map(h => <th key={h} className={th}>{h}</th>)}
                {['收入 / 成本', 'tokens', '耗时'].map(h => <th key={h} className={cn(th, 'text-right')}>{h}</th>)}
                <th className={th}>流式</th>
              </tr></thead>
              <tbody>
                {rows.map(l => (
                  <tr key={l.id} tabIndex={0} onClick={() => setOpen(l)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(l) } }}
                    className={cn('cursor-pointer hover:bg-subtle', focusRing, 'focus-visible:outline-offset-[-2px]', open?.id === l.id && 'bg-acid-soft hover:bg-acid-soft')}>
                    <td className={cn(td, 'text-xs text-muted tabular-nums')}>{fmtUnix(l.created_at)}</td>
                    <td className={td}><Badge tone={typeTone[l.type]}>{LOG_TYPE[l.type]}</Badge></td>
                    <td className={td}>{l.username}{l.token_name && <span className="text-xs text-muted"> / {l.token_name}</span>}</td>
                    <td className={cn(td, 'max-w-48 truncate')}>{l.model || <span className="text-muted">—</span>}</td>
                    <td className={cn(td, 'max-w-44 truncate text-xs')} title={l.channel?.name}>{l.channel ? <><span className="text-muted tabular-nums">#{l.channel.id}</span> {l.channel.name}</> : <span className="text-muted">—</span>}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{fmtCny(l.amount_cny)} <span className="text-xs text-muted">/ {fmtCny(l.cost_cny)}{l.cost_source === 'estimated' && '*'}</span></td>
                    <td className={cn(td, 'text-right text-xs tabular-nums')}>{l.prompt_tokens || l.completion_tokens ? `${fmtInt(l.prompt_tokens)} → ${fmtInt(l.completion_tokens)}` : '—'}</td>
                    <td className={cn(td, 'text-right tabular-nums', l.latency_ms >= 60_000 && 'text-warning')}>{l.latency_ms ? fmtLatency(l.latency_ms) : '—'}</td>
                    <td className={cn(td, 'text-xs text-muted')}>{l.is_stream ? '流式' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {list.data && <Pager page={q.page} size={q.size} total={list.data.total} onPage={p => setParam('page', p > 1 ? String(p) : null)} note="* 成本为估算" />}

      <LogDrawer entry={open} onClose={() => setOpen(null)} />
    </section>
  )
}

export function Pager({ page, size, total, onPage, note }: { page: number; size: number; total: number; onPage: (p: number) => void; note?: string }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <nav aria-label="分页" className="mt-3 flex items-center gap-2 text-sm text-muted tabular-nums">
      {note && <span className="text-xs">{note}</span>}
      <span className="ml-auto">第 {page} / {pages} 页</span>
      <IconButton label="上一页" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></IconButton>
      <IconButton label="下一页" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight /></IconButton>
    </nav>
  )
}

function LogDrawer({ entry: l, onClose }: { entry: LogEntry | null; onClose: () => void }) {
  return (
    <Drawer open={!!l} onClose={onClose} title={l ? `日志 #${l.id}` : '日志'}>
      {l && (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone={typeTone[l.type]}>{LOG_TYPE[l.type]}</Badge>{fmtUnix(l.created_at)}
          </div>
          <dl>
            <KV k="用户 / 令牌">{l.username}{l.token_name && ` / ${l.token_name}`}</KV>
            <KV k="模型">{l.model || '—'}</KV>
            <KV k="渠道">{l.channel ? `#${l.channel.id} ${l.channel.name}` : '—'}</KV>
            <KV k="收入">{fmtCny(l.amount_cny)}</KV>
            <KV k="成本">{fmtCny(l.cost_cny)} {l.cost_source && <span className="text-xs text-muted">{l.cost_source === 'real' ? '实际' : '估算'}</span>}</KV>
            <KV k="毛利">{fmtCny(l.cost_cny == null ? null : l.amount_cny - l.cost_cny)}</KV>
            <KV k="tokens">输入 {fmtInt(l.prompt_tokens)} · 输出 {fmtInt(l.completion_tokens)}</KV>
            <KV k="耗时">{fmtLatency(l.latency_ms)}{l.is_stream && ' · 流式'}</KV>
            <KV k="request_id"><Mono v={l.request_id} /></KV>
            <KV k="上游 request"><Mono v={l.upstream_request_id} /></KV>
          </dl>
          <section>
            <h3 className="mb-1 text-sm font-bold">内容</h3>
            <p className="whitespace-pre-wrap break-words rounded-control bg-subtle p-3 font-mono text-xs leading-5">{l.content || '—'}</p>
          </section>
        </div>
      )}
    </Drawer>
  )
}

function Mono({ v }: { v: string }) {
  if (!v) return <span className="text-muted">—</span>
  const copy = () => navigator.clipboard.writeText(v).then(() => toast({ title: '已复制', tone: 'success' }), () => toast({ title: '复制失败', tone: 'error' }))
  return (
    <span className="inline-flex items-center gap-1">
      <code className="break-all text-xs">{v}</code>
      <button type="button" aria-label={`复制 ${v}`} onClick={copy} className={cn('grid size-6 shrink-0 place-items-center rounded-[6px] text-muted hover:bg-subtle', focusRing)}><Copy className="size-3.5" /></button>
    </span>
  )
}
