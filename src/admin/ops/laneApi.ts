import { ApiError, request } from '@/shared/api'
import { isMock, mockDelay } from '@/studio/api/catalog'
import { mockRole, type MockRole } from '../api'
import { can } from '../lib'
import type { LaneChange, LaneChannel, LaneMatrix, LaneSaveResult, Probe } from './types'

/* Gateway /api/admin/ops lane matrix (docs/admin-ops.md「网关契约」). Mock: `?mock=1&role=`. */

export interface Scenario { resolution?: string; duration?: number | string }
export interface LaneApi {
  matrix(s: Scenario): Promise<LaneMatrix>
  save(changes: LaneChange[]): Promise<LaneSaveResult>
  probe(channelId: number): Promise<Probe>
}

const qs = (s: Scenario) => new URLSearchParams(Object.entries(s).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()

export const realLaneApi: LaneApi = {
  matrix: s => request(`/api/admin/ops/lane-matrix?${qs(s)}`),
  save: changes => request('/api/admin/ops/lane-matrix', { method: 'PUT', body: { changes }, headers: { 'Idempotency-Key': crypto.randomUUID() } }),
  probe: id => request(`/api/admin/ops/channels/${id}/probe`, { body: {} }),
}

/* ───────────────────────────── mock ───────────────────────────── */

const err = (status: number, code: string, detail?: string) => new ApiError(code, { status, code, body: { error: { code, message: code, detail } } })

export function createMockLaneApi(role: MockRole = 'admin', delay = mockDelay): LaneApi {
  const now = Math.floor(Date.now() / 1000)
  const lanes = [{ symbol: 'official', name: '官方', ratio: 1 }, { symbol: 'cheap', name: '低价', ratio: 0.8 }, { symbol: 'backup', name: '备用', ratio: 0.9 }]
  const C = (id: number, name: string, vendor: string, lanes: string[], priority: number, o: Partial<LaneChannel> = {}): LaneChannel =>
    ({ id, name, type: 1, status: 1, priority, weight: 1, lanes, vendor, balance_cny: 100 + id * 37.5, balance_checked_at: now - id * 7 * 60, balance_supported: true, ...o })
  const channels: Record<string, LaneChannel> = Object.fromEntries([
    C(11, 'apimart', 'apimart', ['official', 'cheap'], 30, { balance_cny: 123.4 }),
    C(12, 'xiaoguai', 'xiaoguai', ['cheap'], 20, { balance_cny: 8.2 }),
    C(13, 'fal', 'fal', ['official'], 20, { balance_supported: false, balance_cny: null, balance_checked_at: null }),
    C(14, '火山方舟', 'volcengine', ['official'], 40, { balance_cny: 2300 }),
    C(15, 'kie-ai', 'kie', ['backup'], 10, { balance_cny: null, balance_checked_at: null }),
    C(16, 'openrouter', 'openrouter', ['official'], 10, { balance_cny: 540.1 }),
    C(17, 'replicate', 'replicate', ['backup'], 5, { balance_supported: false, balance_cny: null, balance_checked_at: null }),
    C(18, 'aihubmix', 'aihubmix', ['cheap'], 10, { status: 2 }),
    C(19, 'compshare-新', 'compshare', [], 0, { balance_cny: 60 }),
    C(20, 'siliconflow', 'siliconflow', ['backup'], 20, { balance_cny: 88 }),
    C(21, 'yunwu', 'yunwu', ['cheap'], 15, { status: 3, balance_cny: 0 }),
  ].map(c => [c.id, c]))

  type Model = { model: string; vendor: string; modality: 'image' | 'video' | 'text'; base: number; serve: number[] }
  const models: Model[] = [
    { model: 'seedream-4.0', vendor: 'bytedance', modality: 'image', base: 0.2, serve: [11, 12, 14, 20, 19] },
    { model: 'seedream-3.0', vendor: 'bytedance', modality: 'image', base: 0.18, serve: [14, 12] },
    { model: 'seedance-1.0-pro', vendor: 'bytedance', modality: 'video', base: 1.8, serve: [14, 11, 15, 19] },
    { model: 'seedance-1.0-lite', vendor: 'bytedance', modality: 'video', base: 0.9, serve: [14, 21] },
    { model: 'nano-banana', vendor: 'google', modality: 'image', base: 0.28, serve: [11, 13, 16, 12, 18, 15] },
    { model: 'veo-3', vendor: 'google', modality: 'video', base: 5.4, serve: [13, 11] },
    { model: 'gemini-2.5-pro', vendor: 'google', modality: 'text', base: 72, serve: [16, 18] },
    { model: 'gpt-image-1', vendor: 'openai', modality: 'image', base: 0.3, serve: [11, 16, 12] },
    { model: 'sora-2', vendor: 'openai', modality: 'video', base: 4.2, serve: [11, 17] },
    { model: 'gpt-5', vendor: 'openai', modality: 'text', base: 70, serve: [16, 18, 20] },
    { model: 'kling-v2.1', vendor: 'kuaishou', modality: 'video', base: 2.5, serve: [13, 17, 15] },
    { model: 'wan-2.5', vendor: 'alibaba', modality: 'video', base: 1.2, serve: [20, 13] },
    { model: 'qwen-image', vendor: 'alibaba', modality: 'image', base: 0.14, serve: [20, 21] },
    { model: 'flux-kontext-pro', vendor: 'bfl', modality: 'image', base: 0.29, serve: [13, 17] },
    { model: 'deepseek-v3.1', vendor: 'deepseek', modality: 'text', base: 8, serve: [20] },
    { model: 'hailuo-02', vendor: 'minimax', modality: 'video', base: 1.6, serve: [19] },
  ]

  const build = (s: Scenario): LaneMatrix => {
    const resolution = s.resolution || '1080p', duration = Number(s.duration) || 5
    const vf = (resolution === '720p' ? 0.6 : resolution === '480p' ? 0.4 : 1) * duration / 5
    return {
      lanes, scenario: { resolution, duration },
      rows: models.map(m => ({
        model: m.model, vendors: [m.vendor], modalities: [m.modality], channel_ids: m.serve,
        cells: Object.fromEntries(lanes.map(l => [l.symbol, {
          channel_ids: m.serve.map(id => channels[id]!).filter(c => c.lanes.includes(l.symbol)).sort((a, b) => b.priority - a.priority || a.id - b.id).map(c => c.id),
        }])),
        prices: Object.fromEntries(m.serve.map((id, i) => [id, id === 15 && m.modality === 'image' ? null : {
          unit: m.modality === 'image' ? '张' : m.modality === 'video' ? '条' : '百万 tokens',
          cny: Math.round(m.base * (m.modality === 'video' ? vf : 1) * (1 - i * 0.08) * 100) / 100,
          source: (i === 0 ? 'row' : i % 3 === 1 ? 'overridden' : 'borrowed') as 'row',
        }])),
      })),
      channels: structuredClone(channels), vendor_icons: {},
    }
  }

  const gate = async (write: boolean) => {
    await delay()
    if (role === 'guest') throw err(401, 'customer_login_required')
    if (role === 'expired') throw err(401, 'admin_session_expired')
    if (!can(role === 'admin' || role === 'operator' || role === 'viewer' ? [role] : [], write ? 'cases.write' : 'read')) throw err(403, 'forbidden_role')
  }

  return {
    async matrix(s) { await gate(false); return build(s) },
    async save(changes) {
      await gate(true)
      for (const ch of changes) {
        if (!channels[ch.channel_id]) throw err(404, 'channel_not_found')
        if (ch.lanes && !ch.lanes.length) throw err(502, 'lanehub_api_failed', `channel ${ch.channel_id}: 渠道至少要保留一个分组`)
      }
      return {
        results: changes.map(ch => {
          const c = channels[ch.channel_id]!
          const state = () => ({ group: c.lanes.join(','), priority: c.priority, status: c.status })
          const before = state()
          Object.assign(c, Object.fromEntries(Object.entries(ch).filter(([k]) => k !== 'channel_id')))
          return { channel_id: c.id, name: c.name, before, after: state() }
        }),
      }
    },
    async probe(id) {
      await gate(true)
      const c = channels[id]
      if (!c) throw err(404, 'channel_not_found')
      const checked_at = Math.floor(Date.now() / 1000)
      if (!c.balance_supported) return { channel_id: id, state: 'unsupported', balance_cny: null, latency_ms: 0, message: '', checked_at }
      if (id === 15) return { channel_id: id, state: 'failed', balance_cny: null, latency_ms: 1203, message: 'invalid api key (401)', checked_at }
      c.balance_cny = Math.round(((c.balance_cny ?? 50) - 0.37) * 100) / 100
      c.balance_checked_at = checked_at
      return { channel_id: id, state: 'ok', balance_cny: c.balance_cny, latency_ms: 380, message: '', checked_at }
    },
  }
}

export const laneApi: LaneApi = isMock ? createMockLaneApi(mockRole) : realLaneApi
