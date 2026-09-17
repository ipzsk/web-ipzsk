import { ApiError, request } from '@/shared/api'
import { isMock, mockDelay } from '@/studio/api/catalog'
import { mockRole, type MockRole } from '../api'
import { can, type Capability } from '../lib'
import { daysBetween, type LogQuery } from './lib'
import type { ChannelSummary, DashboardPeriodRow, DashboardRealtime, LogEntry, Page, Probe } from './types'

/* Adapters for docs/admin-ops.md「网关契约」. Mock: `?mock=1&role=`, same switch as ./api. */

export interface ChannelQuery { page: number; size: number; status?: string; type?: string; group?: string; keyword?: string }
export interface PeriodQuery { start: number; end: number; group_by: 'model' | 'channel' }

export interface OpsApi {
  realtime(): Promise<DashboardRealtime>
  period(q: PeriodQuery): Promise<{ rows: DashboardPeriodRow[] }>
  logs(q: LogQuery): Promise<Page<LogEntry>>
  logStat(q: LogQuery): Promise<{ amount_cny: number }>
  channels(q: ChannelQuery): Promise<Page<ChannelSummary>>
  probe(id: number): Promise<Probe>
}

const qs = (o: object) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v))
  return p.toString()
}

export const realOpsApi: OpsApi = {
  realtime: () => request('/api/admin/ops/dashboard/realtime'),
  period: q => request(`/api/admin/ops/dashboard/period?${qs(q)}`),
  logs: q => request(`/api/admin/ops/logs?${qs(q)}`),
  logStat: ({ page: _p, size: _s, ...q }) => request(`/api/admin/ops/logs/stat?${qs(q)}`),
  channels: q => request(`/api/admin/ops/channels?${qs(q)}`),
  probe: id => request(`/api/admin/ops/channels/${id}/probe`, { body: {} }),
}

/* ───────────────────────────── mock ───────────────────────────── */

function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const err = (status: number, code: string) => new ApiError(code, { status, code, body: { error: { code, message: code } } })

export function createMockOpsApi(role: MockRole = 'admin', delay = mockDelay): OpsApi {
  const r = rng(11)
  const now = Math.floor(Date.now() / 1000)
  const gate = async (cap: Capability) => {
    await delay()
    if (role === 'guest') throw err(401, 'customer_login_required')
    if (role === 'expired') throw err(401, 'admin_session_expired')
    const roles = role === 'admin' || role === 'operator' || role === 'viewer' ? [role] : []
    if (!can(roles, cap)) throw err(403, 'forbidden_role')
  }

  // [name, vendor, type, lanes, balance_supported]
  const seeds: [string, string, number, string[], boolean][] = [
    ['apimart-seedream', 'bytedance', 1, ['official'], true], ['apimart-gpt-image', 'openai', 1, ['official', 'backup'], true],
    ['xiaoguai-seedream', 'bytedance', 1, ['budget'], true], ['xiaoguai-kling', 'kuaishou', 1, ['budget', 'backup'], true],
    ['fal-flux', 'bfl', 45, ['official'], false], ['fal-veo', 'google', 45, ['backup'], false],
    ['replicate-sdxl', 'stability', 46, ['budget'], false], ['elevenlabs-tts', 'elevenlabs', 47, ['official'], false],
    ['volc-ark-seedance', 'bytedance', 40, ['official'], true], ['volc-ark-doubao', 'bytedance', 40, ['official', 'budget'], true],
    ['openrouter-gemini', 'google', 20, ['backup'], true], ['deepseek-official', 'deepseek', 36, ['official'], true],
    ['aliyun-wan', 'alibaba', 17, ['official', 'budget'], true], ['zhipu-cogview', 'zhipu', 16, ['budget'], true],
    ['autodl-comfy', 'self', 50, [], false], ['compshare-comfy', 'self', 50, ['budget'], false],
    ['siliconflow-flux', 'bfl', 44, ['budget', 'backup'], true], ['302ai-midjourney', 'midjourney', 1, ['backup'], true],
  ]
  const channels: ChannelSummary[] = seeds.map(([name, vendor, type, lanes, balance_supported], i) => ({
    id: 101 + i, name, type, status: (i === 6 ? 3 : i === 14 ? 2 : 1) as 1 | 2 | 3, priority: lanes.length ? 100 - i * 5 : 0, weight: 1 + (i % 3),
    lanes, vendor, balance_supported,
    balance_cny: balance_supported ? Math.round(r() * 200_000) / 100 : null, balance_checked_at: balance_supported ? (i % 5 === 4 ? null : now - Math.floor(r() * 7200)) : null,
    group: lanes.length ? ['default', ...lanes].join(',') : 'default', tag: vendor, models_count: 1 + Math.floor(r() * 12),
    used_cny: Math.round(r() * 500_000) / 100, created_at: now - (60 - i) * 86400,
  }))
  const models = ['seedream-4.0', 'gpt-image-1', 'seedance-1-pro', 'kling-v2', 'flux-1.1-pro', 'veo-3', 'wan-2.5', 'doubao-seed-1.6']
  const users = ['icycat', 'studio-gw', 'linxiao', 'chenmo', 'wangyi']

  const logs: LogEntry[] = Array.from({ length: 900 }, (_, i) => {
    const type = (i % 97 === 5 ? 1 : i % 131 === 7 ? 3 : i % 173 === 9 ? 4 : 2) as LogEntry['type']
    const ch = channels[Math.floor(r() * channels.length)]!
    const amount = type === 2 ? Math.round(r() * 300) / 100 : type === 1 ? 100 : 0
    const prompt = type === 2 ? 1 + Math.floor(r() * 400) : 0
    return {
      id: 50_000 - i, created_at: now - i * 97 - Math.floor(r() * 60), type, username: users[Math.floor(r() * users.length)]!, token_name: type === 2 ? 'gateway' : '',
      model: type === 2 ? models[Math.floor(r() * models.length)]! : '', channel: type === 2 ? { id: ch.id, name: ch.name } : null,
      amount_cny: amount, cost_cny: type === 2 ? Math.round(amount * (0.55 + r() * 0.35) * 100) / 100 : 0,
      cost_source: type === 2 ? (i % 4 === 0 ? 'estimated' : 'real') : '',
      prompt_tokens: prompt, completion_tokens: type === 2 && i % 3 === 0 ? Math.floor(r() * 1200) : 0,
      latency_ms: type === 2 ? 300 + Math.floor(r() * (i % 5 === 0 ? 90_000 : 8000)) : 0, is_stream: type === 2 && i % 6 === 0,
      request_id: type === 2 ? `req_${(i * 7919 + 12345).toString(36)}` : '', upstream_request_id: type === 2 ? `up-${(i * 104729 + 0x5f3e2d1).toString(16)}` : '',
      content: type === 2 ? `模型倍率 1.0，分组倍率 ${ch.lanes[0] ?? 'default'}，1 张 × ¥${amount.toFixed(2)}` : type === 1 ? '管理员充值 ¥100.00' : '系统任务：渠道余额同步',
    }
  })
  const logHits = (q: LogQuery) => logs.filter(l => (!q.start || l.created_at >= q.start) && (!q.end || l.created_at <= q.end) && (!q.type || l.type === q.type)
    && (!q.model || l.model === q.model) && (!q.username || l.username === q.username) && (!q.channel_id || l.channel?.id === q.channel_id)
    && (!q.request_id || l.request_id === q.request_id) && (!q.upstream_request_id || l.upstream_request_id === q.upstream_request_id))
  const paged = <T,>(items: T[], page: number, size: number): Page<T> => ({ items: items.slice((page - 1) * size, page * size), page, size, total: items.length })

  return {
    async realtime() {
      await gate('read')
      const rpm = 20 + Math.floor(Math.random() * 40)
      return { rpm, tpm: rpm * (300 + Math.floor(Math.random() * 200)), cost_per_min_cny: Math.round(rpm * 0.9 * 100) / 100 }
    },
    async period(q) {
      await gate('read')
      const keys = q.group_by === 'model' ? models : channels.slice(0, 10).map(c => c.name)
      const pr = rng(q.start % 9973)
      const rows: DashboardPeriodRow[] = daysBetween(q.start, q.end).flatMap((date, d) => keys.map((key, k) => {
        const requests = Math.floor((400 / (k + 1)) * (0.6 + pr() * 0.8) * (1 + d * 0.02))
        const amount_cny = Math.round(requests * (0.8 - k * 0.05) * 100) / 100
        return { date, key, requests, amount_cny, cost_cny: Math.round(amount_cny * (0.5 + pr() * 0.3) * 100) / 100, prompt_tokens: requests * 120, completion_tokens: requests * 40, avg_latency_ms: 800 + Math.floor(pr() * 6000) }
      }))
      return { rows }
    },
    async logs(q) { await gate('read'); return paged(logHits(q), q.page, q.size) },
    async logStat(q) { await gate('read'); return { amount_cny: Math.round(logHits(q).reduce((s, l) => s + l.amount_cny, 0) * 100) / 100 } },
    async channels(q) {
      await gate('read')
      const kw = q.keyword?.trim().toLowerCase()
      const hits = channels.filter(c => (!q.status || String(c.status) === q.status) && (!q.type || String(c.type) === q.type)
        && (!q.group || c.group.split(',').includes(q.group)) && (!kw || c.name.toLowerCase().includes(kw) || String(c.id) === kw))
      return paged(structuredClone(hits), q.page, q.size)
    },
    async probe(id) {
      await gate('cases.write')
      const c = channels.find(x => x.id === id)
      if (!c) throw err(404, 'channel_not_found')
      const checked_at = Math.floor(Date.now() / 1000)
      if (!c.balance_supported) return { channel_id: id, state: 'unsupported', balance_cny: null, latency_ms: 12, message: '', checked_at }
      if (c.name.startsWith('302ai')) return { channel_id: id, state: 'failed', balance_cny: null, latency_ms: 5012, message: 'Get "https://api.302.ai/dashboard/balance": context deadline exceeded', checked_at }
      Object.assign(c, { balance_cny: Math.round(r() * 200_000) / 100, balance_checked_at: checked_at })
      return { channel_id: id, state: 'ok', balance_cny: c.balance_cny, latency_ms: 200 + Math.floor(r() * 600), message: '', checked_at }
    },
  }
}

export const opsApi: OpsApi = isMock ? createMockOpsApi(mockRole) : realOpsApi
