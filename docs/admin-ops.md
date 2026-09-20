# 运维后台（/admin 接管 lanehub 管理界面）

lanehub 只做运维后台、只有运维在用。它原来的界面（one-hub 的 MUI/Berry）不再改，只留作应急入口；
运维常用的 5 块搬进 ipzsk 的 `/admin`，由网关代理 lanehub 管理 API。风格参考 gpt-load。

## 依据：生产日志（2026-09-13 ~ 09-17，lanehub 上线日起）

- 浏览器里只看不改：整整 4 天，除了登录，没有一次写操作。按天的调用量是 349 → 172 → 102 → 18 → 6。
- 按使用频率排：仪表盘（RPM 轮询）> 日志 > 渠道 > 分组 / 线路矩阵 / 模型信息。
- 写渠道、写令牌、改配置全是脚本发起的（node），集中在 9/13–14。
- 网关已经在用 root token 调 lanehub（查余额、充值、建 key、查日志、拉目录）。

样本只有上线期这 4 天，不能代表稳态，过一两周要再跑一次统计。

## 范围（第一期）

| 块 | lanehub 接口 | 说明 |
|---|---|---|
| 线路矩阵（重点） | `GET /api/lane_matrix`，新增 `PUT /api/lane_matrix/batch` | 草稿 → 看改动对比 → 一次提交；写审计 |
| 渠道余额 / 探测 | 列表里缓存的 `balance`，单个刷新 `GET /api/channel/update_balance/:id` | **探测 = 调余额接口**：不花钱，也不会自动禁用 |
| 渠道只读 | `GET /api/channel/` | 网关按白名单返回字段 |
| 仪表盘 | `analytics/rpm`、`analytics/period`、`log/stat` | `period` 返回的渠道统计 key 是 Go 字段名，网关统一成 snake_case |
| 日志 | `GET /api/log/` | 页码分页，每页最多 100 条，只支持精确匹配 |

不做：生成测试（`channel/test/:id`，会真实扣费、失败会自动禁用渠道）、全部刷新余额
（同步执行很慢，还会禁用余额 ≤0 的渠道）、充值 / 兑换码 / 用户这类面向终端用户的页面。

## 已定的决策

1. **优先级整个渠道共用**，不按档位分开设。一个渠道同时在几档时，界面提示「改动会在 N 档同时生效」。
   要改成每档单独设，得改 lanehub 的数据模型和选路逻辑，约 2–3 天，等真有需要再做。
2. **lanehub 后端可以改**：新增批量保存接口，同时修掉旧单格接口的两个问题：
   - 旧接口要求渠道已经在这一档里，所以没分配档位的渠道加不进任何一档。批量接口去掉这条限制。
   - 渠道移出最后一个分组会被拒绝。这条限制保留：没有分组的渠道根本选不到路。
     界面上，只挂在一档里的渠道不显示「移出」，改成显示「停用」。
3. **探测 = 余额接口**。没有余额接口的上游（fal、elevenlabs、autodl、compshare、replicate，
   以及没实现余额查询的老类型）显示灰色「无余额接口」。探测成功只说明 key 有效、账户有钱，
   不说明模型能出图；模型是否可用，以后从日志算成功率来补。

## 链路

```
浏览器 /admin ──cookie──▶ 网关 /api/admin/ops/* ──root token──▶ lanehub
                          · requireRole（读 viewer+，写 operator+）
                          · 字段白名单（key / proxy / header_override / model_headers /
                            custom_parameter / plugin / other 一律不出网关）
                          · 写操作记 audit_events（改前 / 改后快照；lanehub 成功、失败都记）
```

- 不代理 `channel/:id`、`channel_tag/:tag`、`channel_tag/:tag/list`：这几个返回明文 key。
- lanehub 按 IP 限流（每 3 分钟 300 次），网关的调用全算在同一个 IP 上。批量保存把 N 次调用合成 1 次。
  lanehub 只对 loopback 地址免限流，网关是 docker 网络里的另一个 IP，不在豁免范围。
  如果真的撞到限流，调高 `global.api_rate_limit`（配置项，不用改代码）。
- lanehub 的失败会以 HTTP 200 + `success:false` 返回，网关已经统一转成 `502 lanehub_api_failed`。

## 顺序与工作量

1. lanehub：批量保存接口 + 测试，约 1 天
2. 网关：约 12 个代理路由 + 字段白名单 + 审计 + routeMeta / 契约，2–3 天
3. `/admin`：线路矩阵 3–4 天；仪表盘、日志、渠道各约 1 天

## 线路矩阵线框

```
┌ 线路矩阵 ─────────────────────── [场景: 1080p · 5s ▾] ┐
│ 搜索模型…  [图片][视频][文本]  厂商▾  □只看已配置        │
├──────────┬─────────────┬─────────────┬───────────┬──────┤
│ 模型      │ 官方 ×1.0    │ 低价 ×0.8    │ 备用 ×0.9  │ 健康 │
├──────────┼─────────────┼─────────────┼───────────┼──────┤
│ seedream │ ●apimart ¥.20│ ●xiaoguai ¥.12│ 待采购    │ 3分前│
└──────────┴─────────────┴─────────────┴───────────┴──────┘
点单元格 → 右侧抽屉：
  本档渠道（拖动排序） │ 其他可用渠道（一键加入）
  ● apimart  ¥0.20/张  余额 ¥123.40 · 3分钟前 · 380ms  [↻ 探测]  ⚠同时在 2 档
底部固定条：「3 处改动未保存」[查看对比] [放弃] [保存]
```

## 网关契约（第一期，三路并行开发的共同约定）

前缀 `/api/admin/ops`。读接口要求 `viewer|operator|admin`，写接口要求 `operator|admin`。
lanehub 没配置时返回 `503 lanehub_unavailable`；lanehub 报错返回 `502 lanehub_api_failed`（`detail` 带原文）。
金额一律由网关换算成人民币，字段名以 `_cny` 结尾（用网关已有的 `usdRate()` / `lanehubQuotaPerUnit`），
前端不做任何 quota 换算。时间一律返回 unix 秒。

| 方法 路径 | 角色 | lanehub | 响应 |
|---|---|---|---|
| `GET /lane-matrix?resolution=&duration=` | 读 | `GET /api/lane_matrix` | `LaneMatrix`（见下） |
| `PUT /lane-matrix` body `{changes: LaneChange[]}` | 写，审计 `ops.lane_matrix.save` | `PUT /api/lane_matrix/batch` | `{results: [{channel_id,name,before:{group,priority,status},after:{…}}]}` |
| `GET /channels?page=&size=&status=&type=&group=&keyword=` | 读 | `GET /api/channel/` | `{items: ChannelSummary[], page, size, total}` |
| `POST /channels/:id/probe` | 写，审计 `ops.channel.probe` | `GET /api/channel/update_balance/:id` | `Probe` |
| `GET /dashboard/realtime` | 读 | `GET /api/analytics/rpm` | `{rpm, tpm, cost_per_min_cny}` |
| `GET /dashboard/period?start=&end=&group_by=model\|channel&channel_id=&model=` | 读 | `GET /api/analytics/period` | `{rows: [{date, key, requests, amount_cny, cost_cny, prompt_tokens, completion_tokens, avg_latency_ms}]}` |
| `GET /logs?page=&size=&start=&end=&model=&username=&channel_id=&request_id=&upstream_request_id=&type=` | 读 | `GET /api/log/` | `{items: LogEntry[], page, size, total}` |
| `GET /logs/stat?`（同上筛选） | 读 | `GET /api/log/stat` | `{amount_cny}` |

```ts
type LaneChange = { channel_id: number; priority?: number; status?: 1 | 2; lanes?: string[] }

type LaneMatrix = {
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

type LaneChannel = {
  id: number; name: string; type: number; status: 1 | 2 | 3; priority: number; weight: number
  lanes: string[]                       // 只含档位分组
  vendor: string
  balance_cny: number | null; balance_checked_at: number | null
  // 上游余额口径不统一：USD 换算成人民币、CNY 原样；raw（各家点数/额度，未核实）时 balance_cny 为 null，
  // 只给 balance_raw，界面显示「123.4 上游单位」，不加 ¥
  balance_raw: number | null; balance_unit: 'USD' | 'CNY' | 'raw'
  balance_supported: boolean            // lanehub 能力表：没有余额接口的上游为 false
}

type ChannelSummary = LaneChannel & {
  group: string; tag: string; models_count: number; used_cny: number; created_at: number
}

type Probe = {
  channel_id: number
  state: 'ok' | 'unsupported' | 'failed'   // unsupported = 上游没有余额接口/未实现
  balance_cny: number | null
  balance_raw: number | null; balance_unit: 'USD' | 'CNY' | 'raw'
  latency_ms: number                       // 网关计时，是余额接口的耗时
  message: string                          // 失败原文，ok 时为空串
  checked_at: number
}

type LogEntry = {
  id: number; created_at: number; type: 1|2|3|4; username: string; token_name: string
  model: string; channel: { id: number; name: string } | null
  amount_cny: number; cost_cny: number; cost_source: 'real'|'estimated'|''
  prompt_tokens: number; completion_tokens: number; latency_ms: number; is_stream: boolean
  request_id: string; upstream_request_id: string; content: string
}
```

字段白名单：网关只按上面的类型挑字段组装，**绝不透传** lanehub 原对象。
`key`、`proxy`、`header_override`、`model_headers`、`custom_parameter`、`plugin`、`other`、`base_url`、`metadata`、`source_ip` 一律不出网关。
