import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { EmptyState, ErrorState, SegmentedControl, Skeleton, cn } from '@/ui'
import { opsApi } from './opsApi'
import { RANGE_LABEL, daysBetween, fmtCny, fmtInt, fmtLatency, opsErrorText, rangeOf, totalsByDay, totalsByKey, type DayTotal, type RangePreset } from './lib'
import { PageHeader } from '../ui'

const TOP_N = 10
const th = 'border-b border-line py-2 pr-3 text-left text-xs font-semibold text-muted'
const td = 'border-b border-line py-2 pr-3 tabular-nums'

export function DashboardPage() {
  const [sp, setSp] = useSearchParams()
  const range = (['today', '7d', '30d'] as const).find(p => p === sp.get('range')) ?? '7d'
  const groupBy = sp.get('group_by') === 'channel' ? 'channel' : 'model'
  const set = (k: string, v: string) => setSp(cur => { const p = new URLSearchParams(cur); p.set(k, v); return p }, { replace: true })

  // refetchIntervalInBackground defaults to false: polling pauses while the tab is hidden.
  const rt = useQuery({ queryKey: ['admin', 'ops', 'realtime'], queryFn: opsApi.realtime, refetchInterval: 60_000 })
  // Window is fixed per preset+hour so the query key doesn't change every render.
  const hour = Math.floor(Date.now() / 3600_000)
  const win = useMemo(() => rangeOf(range), [range, hour]) // eslint-disable-line react-hooks/exhaustive-deps
  const period = useQuery({ queryKey: ['admin', 'ops', 'period', range, groupBy, hour], queryFn: () => opsApi.period({ ...win, group_by: groupBy }) })
  const days = useMemo(() => totalsByDay(period.data?.rows ?? [], daysBetween(win.start, win.end)), [period.data, win])
  const keys = useMemo(() => totalsByKey(period.data?.rows ?? []), [period.data])

  return (
    <section>
      <PageHeader title="仪表盘">
        {rt.dataUpdatedAt > 0 && <span className="text-xs text-muted tabular-nums">实时数据每分钟刷新 · {new Date(rt.dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>}
      </PageHeader>

      {rt.isError ? <ErrorState reason={opsErrorText(rt.error)} action={{ label: '重试', onClick: () => void rt.refetch() }} /> : (
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1" aria-busy={rt.isPending}>
          <Tile label="RPM" hint="每分钟请求" value={rt.data && fmtInt(rt.data.rpm)} />
          <Tile label="TPM" hint="每分钟 token" value={rt.data && fmtInt(rt.data.tpm)} />
          <Tile label="每分钟花费" hint="上游成本" value={rt.data && fmtCny(rt.data.cost_per_min_cny)} />
        </div>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">区间统计</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <SegmentedControl label="时间范围" value={range} onValueChange={v => set('range', v)} options={(Object.keys(RANGE_LABEL) as RangePreset[]).map(v => ({ value: v, label: RANGE_LABEL[v] }))} />
          <SegmentedControl label="分组" value={groupBy} onValueChange={v => set('group_by', v)} options={[{ value: 'model', label: '按模型' }, { value: 'channel', label: '按渠道' }]} />
        </div>
      </div>

      {period.isError ? <ErrorState reason={opsErrorText(period.error)} action={{ label: '重试', onClick: () => void period.refetch() }} />
        : period.isPending ? <div className="grid gap-3"><Skeleton className="h-64" /><Skeleton className="h-72" /></div>
        : !keys.length ? <EmptyState icon={BarChart3} text="这段时间没有调用" />
        : (
          <div className="grid gap-4">
            <Trend days={days} />
            <div className="overflow-x-auto rounded-card border border-line bg-card px-4 pb-2 pt-3">
              <h3 className="mb-1 text-sm font-bold">{groupBy === 'model' ? '模型' : '渠道'} Top {Math.min(TOP_N, keys.length)} <span className="font-normal text-muted">按收入排序 · 共 {keys.length} 个</span></h3>
              <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                <thead><tr>
                  <th className={th}>{groupBy === 'model' ? '模型' : '渠道'}</th>
                  {['请求', '收入', '成本', '毛利', '平均耗时'].map(h => <th key={h} className={cn(th, 'text-right')}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {keys.slice(0, TOP_N).map(k => (
                    <tr key={k.key} className="hover:bg-subtle">
                      <td className={cn(td, 'font-medium')}>{k.key}</td>
                      <td className={cn(td, 'text-right')}>{fmtInt(k.requests)}</td>
                      <td className={cn(td, 'text-right')}>{fmtCny(k.amount_cny)}</td>
                      <td className={cn(td, 'text-right text-muted')}>{fmtCny(k.cost_cny)}</td>
                      <td className={cn(td, 'text-right', k.margin_cny != null && k.margin_cny < 0 && 'text-danger')}>
                        {fmtCny(k.margin_cny)}{k.margin_cny != null && k.amount_cny > 0 && <span className="ml-1 text-xs text-muted">{Math.round((k.margin_cny / k.amount_cny) * 100)}%</span>}
                      </td>
                      <td className={cn(td, 'text-right')}>{fmtLatency(k.avg_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </section>
  )
}

function Tile({ label, hint, value }: { label: string; hint: string; value: string | undefined }) {
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted">{label} <span className="font-normal">· {hint}</span></p>
      {value == null ? <Skeleton className="mt-2 h-9 w-28" /> : <p className="mt-1 text-[32px] font-black leading-10 tracking-[-0.5px] tabular-nums">{value}</p>}
    </div>
  )
}

/** Two single-series bar charts sharing one x axis and one hover index (no dual y axis). */
function Trend({ days }: { days: DayTotal[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const h = hover == null ? null : days[hover]!
  const sum = days.reduce((s, d) => ({ requests: s.requests + d.requests, amount: s.amount + d.amount_cny }), { requests: 0, amount: 0 })
  return (
    <div className="rounded-card border border-line bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <h3 className="font-bold">每日趋势</h3>
        <span className="tabular-nums text-muted">{h ? h.date : '合计'} · 请求 <b className="text-ink">{fmtInt(h ? h.requests : sum.requests)}</b> · 收入 <b className="text-ink">{fmtCny(h ? h.amount_cny : sum.amount)}</b></span>
      </div>
      <Bars label="请求数" values={days.map(d => d.requests)} fmt={fmtInt} color="bg-ink" hover={hover} setHover={setHover} />
      <Bars label="收入 ¥" values={days.map(d => d.amount_cny)} fmt={fmtCny} color="bg-label" hover={hover} setHover={setHover} />
      <div className="flex justify-between pl-16 text-[11px] text-muted tabular-nums">
        <span>{days[0]?.date.slice(5)}</span>{days.length > 2 && <span>{days[Math.floor(days.length / 2)]!.date.slice(5)}</span>}{days.length > 1 && <span>{days.at(-1)!.date.slice(5)}</span>}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">查看数据表</summary>
        <table className="mt-2 w-full max-w-md text-left tabular-nums">
          <thead><tr className="text-muted"><th className="py-1">日期</th><th className="text-right">请求</th><th className="text-right">收入</th></tr></thead>
          <tbody>{days.map(d => <tr key={d.date}><td className="py-0.5">{d.date}</td><td className="text-right">{fmtInt(d.requests)}</td><td className="text-right">{fmtCny(d.amount_cny)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  )
}

function Bars({ label, values, fmt, color, hover, setHover }: { label: string; values: number[]; fmt: (n: number) => string; color: string; hover: number | null; setHover: (i: number | null) => void }) {
  const max = Math.max(...values, 0) || 1
  return (
    <div className="grid grid-cols-[56px_1fr] gap-2 pb-2">
      <div className="flex flex-col justify-between text-right text-[11px] text-muted tabular-nums">
        <span className="font-semibold text-ink">{label}</span><span>{fmt(max)}</span><span>0</span>
      </div>
      {/* HTML flex bars: labels stay crisp at any width; each column is a hover target taller than the bar. */}
      <div role="img" aria-label={`${label}，最高 ${fmt(max)}`} className="flex h-24 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div key={i} className={cn('flex h-full flex-1 items-end', hover === i && 'bg-subtle')} onMouseEnter={() => setHover(i)}>
            <div className={cn('w-full rounded-t-[4px]', color, hover != null && hover !== i && 'opacity-40')} style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
