/** Pure helpers for the ops pages (contract: docs/admin-ops.md). Tested in ops.test.ts. */
import { ApiError } from '@/shared/api'
import { adminErrorText } from '../ui'
import type { DashboardPeriodRow, LaneChannel, LogEntry } from './types'

export type RangePreset = 'today' | '7d' | '30d'
export const RANGE_LABEL: Record<RangePreset, string> = { today: '今天', '7d': '7 天', '30d': '30 天' }

const DAY_S = 86400
const midnight = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000)

/** Local-day window in unix seconds, ending now. 7d = today + the 6 days before. */
export function rangeOf(p: RangePreset, now = new Date()): { start: number; end: number } {
  const days = p === 'today' ? 1 : p === '7d' ? 7 : 30
  const today = midnight(now)
  // ponytail: DAY_S arithmetic drifts an hour across DST; CN has none.
  return { start: today - (days - 1) * DAY_S, end: Math.floor(now.getTime() / 1000) }
}

/** yyyy-mm-dd (local) → unix seconds at the start (or last second) of that day. */
export function dayToUnix(day: string, endOfDay = false): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return undefined
  const t = midnight(new Date(+m[1]!, +m[2]! - 1, +m[3]!))
  return endOfDay ? t + DAY_S - 1 : t
}

/** yyyy-mm-dd dates from start..end (local), for filling gaps in the trend. */
export function daysBetween(start: number, end: number): string[] {
  const out: string[] = []
  for (let t = start; t <= end; t += DAY_S) {
    const d = new Date(t * 1000)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/* ---------- formatting ---------- */

export function fmtCny(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const digits = Math.abs(n) >= 100 || n === 0 ? 2 : 4
  return `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`
}

export function fmtLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('zh-CN')

/** "刚刚" / "N分钟前" / "N小时前" / "N天前" for a unix-seconds timestamp. */
export function fmtAgo(unix: number | null, now = Date.now()): string {
  if (unix == null) return '未探测'
  const s = Math.max(0, now / 1000 - unix)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)}分钟前`
  if (s < DAY_S) return `${Math.floor(s / 3600)}小时前`
  return `${Math.floor(s / DAY_S)}天前`
}

export const fmtUnix = (unix: number) => new Date(unix * 1000).toLocaleString('zh-CN', { hour12: false })

/* ---------- logs ---------- */

export const LOG_TYPE: Record<LogEntry['type'], string> = { 1: '充值', 2: '消费', 3: '管理', 4: '系统' }
export const MAX_PAGE_SIZE = 100
export const LOG_TEXT_KEYS = ['model', 'username', 'channel_id', 'request_id', 'upstream_request_id'] as const
export const LOG_KEYS = ['from', 'to', 'type', ...LOG_TEXT_KEYS] as const

export interface LogQuery {
  page: number; size: number; start?: number; end?: number; type?: number
  model?: string; username?: string; channel_id?: number; request_id?: string; upstream_request_id?: string
}

const posInt = (s: string | null) => { const n = Number(s); return s && Number.isInteger(n) && n > 0 ? n : undefined }

/** URL (?from=yyyy-mm-dd&to=…&type=2&page=3…) → API query. Bad values are dropped, not sent. */
export function logQueryFromParams(sp: URLSearchParams): LogQuery {
  const q: LogQuery = { page: posInt(sp.get('page')) ?? 1, size: Math.min(posInt(sp.get('size')) ?? 50, MAX_PAGE_SIZE) }
  const start = dayToUnix(sp.get('from') ?? ''), end = dayToUnix(sp.get('to') ?? '', true)
  if (start != null) q.start = start
  if (end != null) q.end = end
  const type = posInt(sp.get('type'))
  if (type && type <= 4) q.type = type
  const channel = posInt(sp.get('channel_id'))
  if (channel) q.channel_id = channel
  for (const k of ['model', 'username', 'request_id', 'upstream_request_id'] as const) { const v = sp.get(k)?.trim(); if (v) q[k] = v }
  return q
}

/** Set/clear one URL filter; any filter change resets to page 1. */
export function withParam(cur: URLSearchParams, k: string, v: string | null): URLSearchParams {
  const p = new URLSearchParams(cur)
  if (v) p.set(k, v); else p.delete(k)
  if (k !== 'page') p.delete('page')
  return p
}

/* ---------- channels ---------- */

export const CHANNEL_STATUS: Record<LaneChannel['status'], string> = { 1: '启用', 2: '手动禁用', 3: '自动禁用' }

type BalanceFields = Pick<LaneChannel, 'balance_supported' | 'balance_checked_at' | 'balance_cny' | 'balance_raw' | 'balance_unit'>
export const LOW_BALANCE_CNY = 20
export const RAW_BALANCE_TIP = '该上游余额口径未核实，原样显示'
/** lanehub providers/apimart/balance.go writes 999999 (raw unit) when upstream reports unlimited_quota. */
export const UNLIMITED_BALANCE_RAW = 999999
export const UNLIMITED_BALANCE_TIP = '上游返回不限额度（unlimited_quota），lanehub 以 999999 记录，不是真实余额'

/** Upstream billing unit (lanehub price.unit) → Chinese label; unknown units pass through. */
export const PRICE_UNIT: Record<string, string> = {
  per_1m_tokens: '每百万 token', per_minute_output: '每分钟成片', per_call: '按次', per_second: '按秒', per_minute: '每分钟',
}
export const fmtPriceUnit = (u: string) => PRICE_UNIT[u] ?? u

/** One balance label for matrix cell, drawer and channels page. muted = grey; tip = tooltip for raw units. */
export function fmtBalance(c: BalanceFields): { text: string; muted?: true; tip?: string } {
  if (!c.balance_supported) return { text: '无余额接口', muted: true }
  if (!c.balance_checked_at) return { text: '未检查', muted: true }
  if (c.balance_unit === 'raw' && c.balance_raw === UNLIMITED_BALANCE_RAW) return { text: '不限额度', muted: true, tip: UNLIMITED_BALANCE_TIP }
  if (c.balance_unit === 'raw' && c.balance_raw == null) return { text: '未知余额', muted: true }
  if (c.balance_unit === 'raw') return { text: `${c.balance_raw == null ? '—' : c.balance_raw.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} 上游单位`, tip: RAW_BALANCE_TIP }
  return { text: fmtCny(c.balance_cny) }
}

/** Low-balance warning only when the gateway gave a CNY figure (raw units aren't comparable). */
export const isLowBalance = (c: BalanceFields) => c.balance_supported && c.balance_cny != null && c.balance_cny < LOW_BALANCE_CNY

/* ---------- dashboard ---------- */

export interface KeyTotal { key: string; requests: number; amount_cny: number; cost_cny: number | null; margin_cny: number | null; avg_latency_ms: number }
export interface DayTotal { date: string; requests: number; amount_cny: number }

/** Per-key totals, sorted by amount desc; latency is request-weighted. */
export function totalsByKey(rows: DashboardPeriodRow[]): KeyTotal[] {
  const m = new Map<string, KeyTotal & { lat: number; costUnknown: boolean }>()
  for (const r of rows) {
    const t = m.get(r.key) ?? { key: r.key, requests: 0, amount_cny: 0, cost_cny: 0, margin_cny: 0, avg_latency_ms: 0, lat: 0, costUnknown: false }
    t.requests += r.requests; t.amount_cny += r.amount_cny; t.lat += r.avg_latency_ms * r.requests
    if (r.cost_cny == null) t.costUnknown = true
    else if (!t.costUnknown) t.cost_cny = (t.cost_cny ?? 0) + r.cost_cny
    m.set(r.key, t)
  }
  return [...m.values()]
    .map(({ lat, costUnknown, ...t }) => ({ ...t, cost_cny: costUnknown ? null : t.cost_cny,
      margin_cny: costUnknown ? null : t.amount_cny - (t.cost_cny ?? 0), avg_latency_ms: t.requests ? lat / t.requests : 0 }))
    .sort((a, b) => b.amount_cny - a.amount_cny || b.requests - a.requests)
}

/** Daily totals over `days` (zero-filled). */
export function totalsByDay(rows: DashboardPeriodRow[], days: string[]): DayTotal[] {
  const m = new Map(days.map(date => [date, { date, requests: 0, amount_cny: 0 }]))
  for (const r of rows) { const d = m.get(r.date); if (d) { d.requests += r.requests; d.amount_cny += r.amount_cny } }
  return [...m.values()]
}

const OPS_ERRORS: Record<string, string> = {
  lanehub_unavailable: 'lanehub 未配置或不可用。',
  lanehub_api_failed: 'lanehub 拒绝了这次操作。',
  lanehub_rate_unavailable: '读不到 lanehub 的美元汇率，暂时无法换算人民币金额；请检查 lanehub 的 PaymentUSDRate 设置后重试。',
  lane_matrix_conflict: '其他人刚修改了这些渠道。',
  invalid_channel_id: '渠道编号无效。',
  invalid_date_range: '时间范围无效（最长 366 天，开始不能晚于结束）。',
}
/** Ops page error text: specific gateway codes first; a 400 invalid_query names the bad filter; network last. */
export function opsErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_query') {
      const field = (e.body as { error?: { field?: string } } | null)?.error?.field
      return field ? `筛选条件「${field}」的取值无效，请修改后重试。` : '筛选条件无效，请修改后重试。'
    }
    if (OPS_ERRORS[e.code]) return OPS_ERRORS[e.code]!
  }
  return adminErrorText(e)
}
