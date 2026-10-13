import { ApiError, request } from '@/shared/api'
import { isMock, mockDelay } from '@/studio/api/catalog'
import { mockRole, type MockRole } from '../api'
import { can } from '../lib'
import { mockLaneChannels } from './opsApi'
import type { LaneChange, LaneChannel, LaneMatrix, LaneSaveResult } from './types'

/* Gateway /api/admin/ops lane matrix (docs/admin-ops.md「网关契约」). Mock: `?mock=1&role=`. */

export interface Scenario { resolution?: string; duration?: number | string }
export interface LaneApi {
  matrix(s: Scenario): Promise<LaneMatrix>
  save(changes: LaneChange[]): Promise<LaneSaveResult>
}

const qs = (s: Scenario) => new URLSearchParams(Object.entries(s).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString()

export const realLaneApi: LaneApi = {
  matrix: s => request(`/api/admin/ops/lane-matrix?${qs(s)}`),
  // No Idempotency-Key: the gateway makes a retried save idempotent itself (a change already in place is skipped) and refuses
  // stale ones by `expected` (409 lane_matrix_conflict).
  save: changes => request('/api/admin/ops/lane-matrix', { method: 'PUT', body: { changes } }),
}

/* ───────────────────────────── mock ───────────────────────────── */

const err = (status: number, code: string, detail?: string) => new ApiError(code, { status, code, body: { error: { code, message: code, detail } } })

export function createMockLaneApi(role: MockRole = 'admin', delay = mockDelay): LaneApi {
  const now = Math.floor(Date.now() / 1000)
  const lanes = [{ symbol: 'official', name: '官方', ratio: 1 }, { symbol: 'cheap', name: '低价', ratio: 0.8 }, { symbol: 'backup', name: '备用', ratio: 0.9 }]
  const channels: Record<string, LaneChannel> = Object.fromEntries(mockLaneChannels(now).map(c => [c.id, c]))

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
    if (!can(role === 'admin' || role === 'operator' || role === 'viewer' ? [role] : [], write ? 'ops.write' : 'read')) throw err(403, 'forbidden_role')
  }

  return {
    async matrix(s) { await gate(false); return build(s) },
    async save(changes) {
      await gate(true)
      for (const ch of changes) {
        if (!channels[ch.channel_id]) throw err(404, 'channel_not_found')
        if (ch.lanes && !ch.lanes.length) throw err(502, 'lanehub_api_failed', `channel ${ch.channel_id}: 渠道至少要保留一个分组`)
      }
      // Same optimistic check as the gateway: the fields being written must still hold the values the edit started from.
      const conflicts = changes.filter(ch => {
        const c = channels[ch.channel_id]!
        return (ch.priority !== undefined && c.priority !== ch.expected.priority) || (ch.status !== undefined && c.status !== ch.expected.status)
          || (ch.lanes !== undefined && c.lanes.join() !== ch.expected.lanes.join())
      }).map(ch => ({ channel_id: ch.channel_id, reason: 'changed', current: { priority: channels[ch.channel_id]!.priority, status: channels[ch.channel_id]!.status, lanes: [...channels[ch.channel_id]!.lanes] } }))
      if (conflicts.length) throw new ApiError('lane_matrix_conflict', { status: 409, code: 'lane_matrix_conflict', body: { error: { code: 'lane_matrix_conflict', conflicts } } })
      return {
        results: changes.map(ch => {
          const c = channels[ch.channel_id]!
          const state = () => ({ group: c.lanes.join(','), priority: c.priority, status: c.status })
          const before = state()
          Object.assign(c, Object.fromEntries(Object.entries(ch).filter(([k, v]) => k !== 'channel_id' && k !== 'expected' && v !== undefined)))
          return { channel_id: c.id, name: c.name, before, after: state() }
        }),
      }
    },
  }
}

export const laneApi: LaneApi = isMock ? createMockLaneApi(mockRole) : realLaneApi
