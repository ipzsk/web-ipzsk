// 运维后台 /api/admin/ops/* 的前端类型，真源是 docs/admin-ops.md 的「网关契约」。
// ponytail: 网关契约生成后（contracts:sync）换成 generated 类型，这份删掉。

export type LaneChange = { channel_id: number; priority?: number; status?: 1 | 2; lanes?: string[] }

export type LaneMatrix = {
  lanes: { symbol: string; name: string; ratio: number }[]      // auto 降级链顺序
  scenario: { resolution: string; duration: number }
  rows: {
    model: string; vendors: string[]; modalities: string[]
    cells: Record<string /* lane symbol */, { channel_ids: number[] }>   // 已按 priority desc, id 排好
    channel_ids: number[]                                        // 能服务该模型的全部渠道
    // 价格按 (model, channel) 给，同一渠道在不同模型下价格不同
    prices: Record<string /* channel_id */, { unit: string; cny: number; source: 'row'|'borrowed'|'overridden'|'fallback' } | null>
  }[]
  channels: Record<string /* channel_id */, LaneChannel>        // 去重后的渠道表
  vendor_icons: Record<string, string>                          // 去重；data URI
}

export type LaneChannel = {
  id: number; name: string; type: number; status: 1 | 2 | 3; priority: number; weight: number
  lanes: string[]                       // 只含档位分组
  vendor: string
  balance_cny: number | null; balance_checked_at: number | null
  balance_supported: boolean            // lanehub 能力表：没有余额接口的上游为 false
}

export type ChannelSummary = LaneChannel & {
  group: string; tag: string; models_count: number; used_cny: number; created_at: number
}

export type Probe = {
  channel_id: number
  state: 'ok' | 'unsupported' | 'failed'   // unsupported = 上游没有余额接口/未实现
  balance_cny: number | null
  latency_ms: number                       // 网关计时，是余额接口的耗时
  message: string                          // 失败原文，ok 时为空串
  checked_at: number
}

export type LogEntry = {
  id: number; created_at: number; type: 1|2|3|4; username: string; token_name: string
  model: string; channel: { id: number; name: string } | null
  amount_cny: number; cost_cny: number; cost_source: 'real'|'estimated'|''
  prompt_tokens: number; completion_tokens: number; latency_ms: number; is_stream: boolean
  request_id: string; upstream_request_id: string; content: string
}

export type Page<T> = { items: T[]; page: number; size: number; total: number }
export type LaneSaveResult = { results: { channel_id: number; name: string; before: LaneChannelState; after: LaneChannelState }[] }
export type LaneChannelState = { group: string; priority: number; status: number }
export type DashboardRealtime = { rpm: number; tpm: number; cost_per_min_cny: number }
export type DashboardPeriodRow = { date: string; key: string; requests: number; amount_cny: number; cost_cny: number; prompt_tokens: number; completion_tokens: number; avg_latency_ms: number }
