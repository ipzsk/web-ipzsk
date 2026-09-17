import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api'
import { daysBetween, dayToUnix, fmtAgo, fmtCny, fmtLatency, logQueryFromParams, rangeOf, totalsByDay, totalsByKey, withParam } from './lib'
import { createMockOpsApi } from './opsApi'

const noDelay = async () => {}
const keys = (o: object) => Object.keys(o).sort()

describe('range presets', () => {
  const now = new Date(2026, 8, 17, 15, 30)
  it('today starts at local midnight and ends now', () => {
    const r = rangeOf('today', now)
    expect(new Date(r.start * 1000)).toEqual(new Date(2026, 8, 17))
    expect(r.end).toBe(Math.floor(now.getTime() / 1000))
  })
  it('7d/30d include today', () => {
    expect(daysBetween(rangeOf('7d', now).start, rangeOf('7d', now).end)).toEqual(['2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17'])
    expect(daysBetween(rangeOf('30d', now).start, rangeOf('30d', now).end)).toHaveLength(30)
  })
})

describe('formatting', () => {
  it('money', () => {
    expect(fmtCny(1234.5)).toBe('¥1,234.50')
    expect(fmtCny(0.0123)).toBe('¥0.0123')
    expect(fmtCny(0)).toBe('¥0.00')
    expect(fmtCny(-3.2)).toBe('-¥3.20')
    expect(fmtCny(null)).toBe('—')
  })
  it('latency', () => {
    expect(fmtLatency(380)).toBe('380ms')
    expect(fmtLatency(1250)).toBe('1.3s')
    expect(fmtLatency(65_000)).toBe('1m5s')
  })
  it('ago', () => {
    const now = 1_000_000_000_000
    expect(fmtAgo(now / 1000 - 30, now)).toBe('刚刚')
    expect(fmtAgo(now / 1000 - 180, now)).toBe('3分钟前')
    expect(fmtAgo(null, now)).toBe('未探测')
  })
})

describe('log filters ↔ URL', () => {
  it('maps params to query, dropping junk and capping size', () => {
    const q = logQueryFromParams(new URLSearchParams('from=2026-09-17&to=2026-09-17&type=2&channel_id=12&model=%20veo-3%20&page=3&size=500&request_id='))
    expect(q).toEqual({ page: 3, size: 100, start: dayToUnix('2026-09-17'), end: dayToUnix('2026-09-17')! + 86399, type: 2, channel_id: 12, model: 'veo-3' })
    expect(logQueryFromParams(new URLSearchParams('type=9&channel_id=abc&page=-1&from=bad'))).toEqual({ page: 1, size: 50 })
  })
  it('filter change resets page; page change keeps filters', () => {
    const cur = new URLSearchParams('model=x&page=4')
    expect(withParam(cur, 'type', '2').toString()).toBe('model=x&type=2')
    expect(withParam(cur, 'page', '5').toString()).toBe('model=x&page=5')
    expect(withParam(cur, 'model', null).toString()).toBe('')
  })
})

describe('dashboard aggregation', () => {
  const row = (date: string, key: string, requests: number, amount_cny: number, cost_cny: number, avg_latency_ms: number) =>
    ({ date, key, requests, amount_cny, cost_cny, prompt_tokens: 0, completion_tokens: 0, avg_latency_ms })
  const rows = [row('2026-09-16', 'a', 10, 5, 3, 1000), row('2026-09-17', 'a', 30, 15, 9, 2000), row('2026-09-17', 'b', 5, 50, 60, 500)]
  it('totals by key: sorted by amount, weighted latency, margin', () => {
    const [b, a] = totalsByKey(rows)
    expect(b).toMatchObject({ key: 'b', margin_cny: -10 })
    expect(a).toMatchObject({ key: 'a', requests: 40, amount_cny: 20, margin_cny: 8, avg_latency_ms: 1750 })
  })
  it('totals by day zero-fills', () => {
    expect(totalsByDay(rows, ['2026-09-15', '2026-09-16', '2026-09-17'])).toEqual([
      { date: '2026-09-15', requests: 0, amount_cny: 0 }, { date: '2026-09-16', requests: 10, amount_cny: 5 }, { date: '2026-09-17', requests: 35, amount_cny: 65 },
    ])
  })
})

describe('mock ops adapter', () => {
  const api = createMockOpsApi('operator', noDelay)
  const LANE_CHANNEL = ['balance_checked_at', 'balance_cny', 'balance_supported', 'id', 'lanes', 'name', 'priority', 'status', 'type', 'vendor', 'weight']

  it('returns exactly the contract keys', async () => {
    expect(keys(await api.realtime())).toEqual(['cost_per_min_cny', 'rpm', 'tpm'])
    const period = await api.period({ ...rangeOf('7d'), group_by: 'channel' })
    expect(keys(period)).toEqual(['rows'])
    expect(keys(period.rows[0]!)).toEqual(['amount_cny', 'avg_latency_ms', 'completion_tokens', 'cost_cny', 'date', 'key', 'prompt_tokens', 'requests'])
    const logs = await api.logs({ page: 1, size: 20 })
    expect(keys(logs)).toEqual(['items', 'page', 'size', 'total'])
    expect(keys(logs.items[0]!)).toEqual(['amount_cny', 'channel', 'completion_tokens', 'content', 'cost_cny', 'cost_source', 'created_at', 'id', 'is_stream', 'latency_ms', 'model', 'prompt_tokens', 'request_id', 'token_name', 'type', 'upstream_request_id', 'username'])
    expect(keys(await api.logStat({ page: 1, size: 20 }))).toEqual(['amount_cny'])
    const ch = await api.channels({ page: 1, size: 100 })
    expect(keys(ch.items[0]!)).toEqual([...LANE_CHANNEL, 'created_at', 'group', 'models_count', 'tag', 'used_cny'].sort())
    expect(keys(await api.probe(ch.items[0]!.id))).toEqual(['balance_cny', 'channel_id', 'checked_at', 'latency_ms', 'message', 'state'])
  })

  it('filters logs exactly and probes by capability', async () => {
    const first = (await api.logs({ page: 1, size: 1, type: 2 })).items[0]!
    const hit = await api.logs({ page: 1, size: 100, request_id: first.request_id })
    expect(hit.items.map(l => l.id)).toEqual([first.id])
    const fal = (await api.channels({ page: 1, size: 100, keyword: 'fal-flux' })).items[0]!
    expect((await api.probe(fal.id)).state).toBe('unsupported')
    const code = await createMockOpsApi('viewer', noDelay).probe(fal.id).then(() => 'ok', (e: ApiError) => e.code)
    expect(code).toBe('forbidden_role')
  })
})
