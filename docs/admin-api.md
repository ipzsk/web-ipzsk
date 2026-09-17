# 管理中台接口契约（B5 第一批）

> 对应 `docs/studio-redesign.md` §9（权限与管理中台）、§8.2 / §8.5 / §8.7、§10.2、§13 B5/F7。
> 前端实现：`src/admin/api.ts`（真实适配器 + `?mock=1` mock，二者按本文件的形状对齐）。
> 本文件是 B5 的验收依据：**每个接口 × 每个角色**都要有权限测试；未授权返回 403。

## 0. 通用约定

| 项 | 约定 |
|---|---|
| 前缀 | `/api/admin/*` |
| 身份 | better-auth cookie 会话（与 `/api/me/*` 相同），**不接受** API token / 旧 `administrators` 会话 |
| 权限钩子 | 每个路由第一行 `await requireRole(req, ...roles)`（`src/roles.mjs`）。角色 30 秒进程内缓存，授予/撤销时清除 |
| 会话时效 | 会话创建超过 12 小时 → `401 admin_session_expired`（全局会话仍 7 天有效，用户只需重新登录） |
| CORS | 仅 `https://www.ipzsk.com`，带凭据；方法 GET/POST/PUT/PATCH/DELETE；头 `Content-Type`、`Idempotency-Key`；非 GET 校验 Origin |
| 缓存 | 所有响应 `Cache-Control: no-store`（含签名 URL 也不例外，与公开案例接口不同） |
| 错误 | `{ "error": { "code": "stable_code", "message": "英文或调试信息" } }`；前端只认 `code`。表单类错误可带 `error.fields: [{ "field": "license_note", "code": "required" }]` |
| 分页 | `{ "items": [...], "next_cursor": "opaque" \| null }`；`limit` 默认 50，最大 100，越界 `400 invalid_limit`；游标不透明（base64url），坏游标 `400 invalid_cursor` |
| 时间 | ISO 8601 UTC 字符串；日期筛选 `from`/`to` 接受 `YYYY-MM-DD`（按 Asia/Shanghai 当天 00:00 起，`to` 含当天）或完整 ISO |
| 点数 | 8 位小数字符串（`"12.50000000"`）；`null` = 结算中，前端显示「结算中」，不显示可能错误的数字 |
| 媒体 | 资产统一用 `MediaAsset`（与 `/api/me/assets` 相同：`{id,kind,status,width,height,duration_ms,urls:{w480?,w960?,orig,poster?}}`，6 小时时间片签名 URL） |
| 审计 | 所有**写**操作在同一事务里写 `audit_events(action, target_id, details, actor_user_id)`；读操作不审计。事件名见各接口 |
| 限流 | 写接口每用户 60 次/分钟（`rate_limited` 429），批量接口算 1 次 |

### 0.1 角色与能力

| 能力 | viewer | operator | admin |
|---|:-:|:-:|:-:|
| 所有 `GET`（案例、用户、生成记录、审计） | ✓ | ✓ | ✓ |
| 案例写（创建、编辑、发布/隐藏、排序、封面、参考图、删除草稿） | — | ✓ | ✓ |
| 生成记录人工操作（重新同步、标记取消） | — | ✓ | ✓ |
| 角色授予 / 撤销 | — | — | ✓ |
| 财务（钱包调整、退款、结算） | 本批不提供，留在旧中台（§6） | | |

下文「角色」列：`R` = viewer/operator/admin，`W` = operator/admin，`A` = admin。

### 0.2 通用错误码

| HTTP | code | 场景 |
|---|---|---|
| 401 | `customer_login_required` | 无会话 |
| 401 | `admin_session_expired` | 会话超过 12 小时 |
| 403 | `forbidden_role` | 已登录但角色不够（**包括普通用户访问任何 admin 接口**） |
| 403 | `origin_not_allowed` | 非 GET 的 Origin 校验失败 |
| 400 | `invalid_json` / `invalid_<field>` | 请求体结构或字段不合法 |
| 404 | `<resource>_not_found` | 资源不存在 |
| 409 | `<resource>_conflict` | 乐观并发冲突，响应体带最新资源 |
| 429 | `rate_limited` | 限流 |

> 注：`requireRole` 现在对「无会话」抛 `403 customer_login_required`。建议 B5 改为 **401**，这样前端能统一跳登录；前端两种都兼容。

---

## 1. 会话

### `GET /api/admin/me` — R

```json
{
  "user": { "id": "uuid", "email": "a@x.com", "name": "小猫" },
  "roles": ["admin"],
  "session": { "created_at": "2026-09-17T02:00:00Z", "expires_at": "2026-09-17T14:00:00Z" }
}
```

- `expires_at` = `created_at + 12h`；前端据此显示「会话剩余」，到期前不主动登出。
- 错误：通用。前端以本接口作为门禁：401 → 跳 `/account?next=/admin`；`admin_session_expired` → 提示重新登录；403 → 无权限页。

---

## 2. 案例库（`inspiration_cases` + `inspiration_case_references`）

### 2.1 资源形状 `AdminCase`

```json
{
  "id": "20000",
  "title": "黑白极简概念",
  "prompt": "…",
  "category": "posters",
  "category_zh": "封面与海报",
  "tags": ["极简", "编辑感"],
  "model": "gpt-image-2",
  "params": { "aspect_ratio": "21:9" },
  "template": null,
  "cover": { "id": "uuid", "kind": "image", "status": "ready", "width": 680, "height": 272, "duration_ms": null, "urls": { "w480": "…", "w960": "…", "orig": "…" } },
  "references": [],
  "author": "adrianpunk",
  "author_url": "https://github.com/adrianpunk",
  "source_repo": "Punk-Skill",
  "source_url": "https://github.com/…",
  "license_note": "Punk-Skill (adrianpunk) · MIT · fetched 2026-09-07",
  "status": "published",
  "position": 0,
  "created_at": "…",
  "updated_at": "…"
}
```

`template`（沿用 B4 `validCaseTemplate` 的形状，本批**新增两个可选键** `params`、`anchor`，B4 校验需放行）：

```json
{
  "items": [
    { "key": "main", "label": "主图", "description": "干净背景，突出商品主体", "count": 1,
      "params": { "aspect_ratio": "1:1", "resolution": "2K" }, "anchor": true,
      "references": [{ "slot": "商品图" }] }
  ]
}
```

模板校验（服务端为准，前端 `src/admin/lib.ts#templateIssues` 同规则）：

| 规则 | code |
|---|---|
| `items` 1–12 项 | `invalid_template` |
| `label` 1–60 字；`key` 省略时服务端按序生成 `item-{n}`，同一模板内唯一 | `invalid_template` |
| `count` 整数 1–12，**所有项 count 之和 ≤ 12**（输出规格上限，§2.3） | `template_too_many_outputs` |
| `anchor: true` **至多一项**；都未标记时应用模板默认 ① 为锚图 | `template_multiple_anchors` |
| `params.aspect_ratio` / `resolution` 为字符串，≤ 20 字；是否被型号支持由应用时的型号目录决定，入库不校验 | `invalid_template` |
| `references` 只允许 `{slot}`（案例库模板不能引用具体资产），slot 1–30 字 | `invalid_template` |

### 2.2 发布校验（`status → published` 的所有入口共用）

| 字段 | 规则 | `error.fields[].code` |
|---|---|---|
| `title` | 非空，≤ 100 字 | `required` / `too_long` |
| `prompt` | 非空，≤ 20000 字 | `required` / `too_long` |
| `category` | 非空，`^[a-z0-9-]{1,60}$` | `required` / `invalid` |
| `cover` | 存在且 `media_assets.status='ready'` | `cover_not_ready` |
| `license_note` | 非空（§14：记录来源仓库、授权与采集时间） | `required` |
| `source_repo` 或 `source_url` | 至少一个非空 | `source_required` |
| `source_url` / `author_url` | 为空或 `https://` URL | `invalid_url` |
| `template` | 满足 2.1 | 见上表 |

失败：`422 case_publish_invalid`，`error.fields` 列出**全部**问题（不是第一个）。草稿和隐藏状态保存时只校验类型与长度，不校验必填。

### 2.3 接口

#### `GET /api/admin/cases` — R

查询：`status=draft|published|hidden`（缺省全部）、`category=`、`q=`（ILIKE title/prompt/tags + id 精确匹配）、`cursor=`、`limit=`。
排序：`position ASC, id ASC`（与公开瀑布流同序，所以列表里拖动即所见即所得）。

```json
{ "items": [AdminCase], "next_cursor": null, "total": 561 }
```

- `total` 为当前筛选的总数（千级，`count(*)` 可接受）。
- 列表项的 `prompt` 截断为前 200 字，`references` 返回 `[]`；完整内容用详情接口。

#### `GET /api/admin/case-categories` — R

```json
{ "items": [{ "category": "posters", "category_zh": "封面与海报", "count": 123 }] }
```
统计全部状态（公开接口只统计 published）。

#### `GET /api/admin/cases/:id` — R

→ `AdminCase`（完整 prompt 与 references）。`404 case_not_found`。

#### `POST /api/admin/cases` — W · 审计 `case.create`

```json
{ "id": "可选，^[A-Za-z0-9_-]{1,100}$，缺省服务端生成 c_{base36 time}{rand}",
  "title": "…", "prompt": "…", "category": "posters", "category_zh": "封面与海报",
  "tags": [], "model": null, "params": {}, "template": null,
  "author": null, "author_url": null, "source_repo": null, "source_url": null, "license_note": null,
  "cover_asset_id": "uuid（必填：表上 cover_id NOT NULL）" }
```

- 总是创建为 `draft`，`position = min(position) - 1`（新案例排最前，便于马上调整）。
- 封面处理同 `PUT …/cover`（见 2.4 归属规则）。
- 响应 `201` + `AdminCase`。
- 错误：`400 invalid_case_id`、`409 case_id_taken`、`400 invalid_template`、`404 asset_not_found`、`409 asset_not_ready`。
- 支持 `Idempotency-Key`（24 小时内同键同体返回同一结果）。

#### `PATCH /api/admin/cases/:id` — W · 审计 `case.update`（details: `{ fields: [...] }`）；状态变化另记 `case.status`（details: `{ from, to }`）

请求体：以下字段任意子集 + 乐观并发字段：

```json
{ "title": "…", "prompt": "…", "category": "…", "category_zh": "…", "tags": [], "model": "…", "params": {},
  "template": { "items": [] }, "author": "…", "author_url": "…", "source_repo": "…", "source_url": "…",
  "license_note": "…", "status": "draft|published|hidden",
  "expected_updated_at": "上次读取的 updated_at（可选，强烈建议）" }
```

- `template: null` 表示清除模板。未知字段 `400 unknown_field`（防止前端拼错静默丢失）。
- 目标状态为 `published`（或已是 published 且改了必填字段）时执行 2.2 校验 → `422 case_publish_invalid`。
- `expected_updated_at` 与库内不一致 → `409 case_conflict`，响应体 `{ error, case: AdminCase }`。
- `hidden` 即下架：公开接口立即不可见（公开响应 `private, max-age=300`，最多 5 分钟浏览器缓存）。
- 响应 `AdminCase`。

#### `PATCH /api/admin/cases/:id/position` — W · 审计 `case.reorder`（details: `{ from, to }`）

```json
{ "after_id": "放到这个案例之后，或 null", "before_id": "放到这个案例之前，或 null" }
```

响应：`{ "id": "…", "position": 12.5 }`

**为什么选「按邻居改 position」而不是 `PUT /cases/order {ids}`：**

1. `position` 是 `double precision`，单条 UPDATE 就能插到任意两项之间；整份 `ids` 替换要一次改几百行，还要锁全表。
2. 中台列表是**筛选 + 分页**的（按状态/分类/前 50 条），前端手里没有全量 id，整份替换会把没加载的案例顺序冲掉。
3. 两个运营同时拖不同案例时，按邻居计算互不覆盖；整份替换是后写覆盖先写。

服务端算法（前端 `positionBetween` 同公式，用于乐观更新）：

- 在事务里 `SELECT position … FOR UPDATE` 读取两个邻居的**当前** position：
  - 两个都有：`(a + b) / 2`；只有 `after`：`a + 1`；只有 `before`：`b - 1`；都为 null：`400 invalid_position`。
- 邻居不存在 `404 case_not_found`；`after` 的位置不小于 `before` 的位置（前端视图过期）→ `409 case_order_conflict`，前端刷新列表。
- 若 `|a - b| < 1e-9`：同事务内按 `(position,id)` 把全部案例重排为 `0,1,2,…`（`row_number()`）后再算，响应返回新 position，前端 `onSettled` 刷新列表即可。

#### `POST /api/admin/cases/bulk-status` — W · 每条成功记 `case.status`

```json
{ "ids": ["20000", "20001"], "status": "published|hidden|draft" }
```

- `ids` 1–200 个。**逐条独立**：一条发布校验失败不影响其他条。
- 响应（总是 200）：

```json
{ "items": [
  { "id": "20000", "ok": true, "case": { "id": "20000", "status": "published", "updated_at": "…" } },
  { "id": "20001", "ok": false, "error": { "code": "case_publish_invalid", "fields": [{ "field": "license_note", "code": "required" }] } }
] }
```

#### `PUT /api/admin/cases/:id/cover` — W · 审计 `case.cover`（details: `{ from_asset_id, to_asset_id, source_asset_id }`）

```json
{ "asset_id": "管理员自己上传的资产 id" }
```

响应 `AdminCase`。

#### `PUT /api/admin/cases/:id/references` — W · 审计 `case.references`（details: `{ count }`）

```json
{ "asset_ids": ["uuid", "…"] }
```

- 0–8 张，整份替换，顺序即 position；重复 id `400 duplicate_asset`。
- 已经是本案例参考图的 `source='case'` 资产可以直接复用（保持原顺序改动不重复复制）；其它按 2.4 复制。
- 响应 `AdminCase`。

#### `DELETE /api/admin/cases/:id` — W · 审计 `case.delete`

- **只允许删除 `draft`**；已发布或隐藏过的案例 `409 case_not_draft`——下架用 `hidden`（可恢复、可审计）。
- 硬删除：删 `inspiration_cases` 行（参考图行级联），封面与参考图资产 `status='deleted', deleted_at=now()`，由现有清理任务 30 天后删对象。
- 不可撤销 → 前端按 §6 例外处理：确认对话框 + 等服务端返回。
- 响应 `204`。

### 2.4 封面 / 参考图上传流程与资产归属

```text
浏览器 ─POST /api/me/uploads→ 网关(media_assets: user_id=管理员, source='upload', pending)
       ─预签名 PUT→ R2 ─POST /api/me/uploads/:id/complete→ ready（宽高、缩略图入队）
       ─PUT /api/admin/cases/:id/cover {asset_id}→ 网关：
            1. 校验：asset.user_id = 当前管理员、kind='image'、status='ready'（否则 404 asset_not_found / 409 asset_not_ready / 400 asset_not_image）
            2. R2 CopyObject  u/{admin}/{asset}/orig.ext → cases/{new_id}/orig.ext
            3. 事务：INSERT media_assets(id=new_id, user_id=NULL, source='case', status='ready', 宽高/sha256 复制) + enqueueThumb
                     UPDATE inspiration_cases SET cover_id=new_id
                     旧封面（source='case'）标 deleted
```

**归属规则：**

- 只能引用**自己**上传的资产（`user_id = actor`），不能拿其他用户或其他管理员的素材当案例封面——避免把用户私有素材公开。
- 案例用的是**复制出来的** `source='case', user_id=NULL` 资产，与管理员账户解耦：`media_assets.user_id` 是 `ON DELETE CASCADE`，直接引用会在管理员账户删除时连带删掉线上封面；管理员在素材页删除自己的原图也不影响案例。
- 原上传资产仍属于管理员、占管理员配额；前端上传成功并设为封面后不自动删除（管理员可在素材页清理）。
- 复制失败 → `502 storage_copy_failed`，案例不变。

---

## 3. 用户与角色

### 3.1 形状

```json
// AdminUserSummary（列表项）
{ "id": "uuid", "email": "u@x.com", "name": "…", "email_verified": true, "created_at": "…", "roles": ["operator"] }
```

### `GET /api/admin/users` — R

查询：`q=`（必填，1–100 字：邮箱/昵称 ILIKE；若是完整 uuid 则按 id 精确匹配）、`cursor=`、`limit=`。
排序：邮箱精确命中优先，其余 `created_at DESC`。
响应：`{ items: AdminUserSummary[], next_cursor }`。`q` 为空 `400 invalid_query`（不提供全量用户翻页，避免拖库）。

### `GET /api/admin/users/:id` — R

```json
{
  "user": { "id": "uuid", "email": "…", "name": "…", "email_verified": true, "created_at": "…", "last_sign_in_at": "… | null" },
  "roles": [{ "role": "operator", "granted_at": "…", "granted_by": { "id": "uuid", "email": "…" } }],
  "developer": { "state": "approved | pending | rejected | null" },
  "wallet": { "available_points": "120.00000000", "frozen_points": "0.00000000" },
  "wallet_error": null,
  "usage": {
    "last_30d": { "generations": 42, "succeeded": 38, "failed": 3, "cancelled": 1, "charged_points": "256.00000000" },
    "total_generations": 310,
    "storage": { "assets": 120, "bytes": 523456789 }
  },
  "recent_generations": [AdminGeneration]
}
```

- `wallet` **只读**，数据来源与 `/api/me/wallet` 相同（lanehub 模式下查 lanehub）；查询失败时 `wallet: null, wallet_error: "billing_unavailable"`，接口本身不失败。
- `recent_generations` 最近 10 条，形状同 4.1 列表项。
- `404 user_not_found`。

### `GET /api/admin/roles` — R

所有持有管理角色的用户（管理员列表）。

```json
{ "items": [{ "user": { "id": "uuid", "email": "…", "name": "…" },
              "roles": [{ "role": "admin", "granted_at": "…", "granted_by": { "id": "uuid", "email": "…" } }] }] }
```
不分页（预期 < 100 人）。

### `PUT /api/admin/users/:id/roles/:role` — A · 审计 `role.grant`（details: `{ role }`）

- 无请求体。幂等：已持有返回 200，不重复记审计。
- 被授予者必须 `email_verified = true` → 否则 `409 email_not_verified`。
- `role` 不在 `admin|operator|viewer` → `400 invalid_role`；`404 user_not_found`。
- 成功后清除该用户角色缓存。响应：`{ "roles": ["operator", "viewer"] }`。

### `DELETE /api/admin/users/:id/roles/:role` — A · 审计 `role.revoke`（details: `{ role }`）

- 幂等：未持有返回 200。
- **不能撤销自己的 `admin`** → `409 cannot_revoke_own_admin`（防止误操作把自己锁在外面；需要另一位 admin 操作）。
- **不能撤销最后一位 admin**（事务内 `SELECT count(*) … FOR UPDATE`）→ `409 last_admin`。
- 响应：`{ "roles": [...] }`。
- 权限变更属于 §6 例外：前端等服务端确认后才更新界面。

---

## 4. 生成记录（`generation_records` ⋈ `requests` ⋈ `media_tasks`）

### 4.1 形状 `AdminGeneration`

```json
{
  "id": "uuid",
  "user": { "id": "uuid", "email": "…" },
  "kind": "image",
  "model": "gpt-image-2",
  "prompt": "列表截断 200 字，详情完整",
  "params": { "aspect_ratio": "1:1", "resolution": "2K", "n": 1 },
  "status": "queued|running|succeeded|failed|cancelled",
  "failure_code": "upstream_timeout | null",
  "charged_points": "6.00000000 | null",
  "source": "studio|template|canvas",
  "batch_id": "uuid | null", "batch_position": 0,
  "created_at": "…", "updated_at": "…"
}
```

详情额外字段：

```json
{
  "failure_message": "上游原始错误（已脱敏：去掉 key、签名 URL）| null",
  "request_id": "requests.id",
  "idempotency_key": "q:…",
  "upstream": { "provider": "lanehub", "request_id": "requests.upstream_id", "task_id": "media_tasks.upstream_task_id", "task_status": "media_tasks.status", "last_synced_at": "…" },
  "billing": { "mode": "lanehub", "state": "pending|charged|released", "cost_cny": "0.60000000 | null" },
  "thread_id": "uuid | null", "anchor_record_id": null, "parent_record_id": null, "source_case_id": null,
  "references": [MediaAsset],
  "results": [MediaAsset],
  "deleted_at": "用户软删除时间 | null"
}
```

> 管理视图**包含用户已软删除的记录**（`deleted_at` 非空时前端标「用户已删除」），便于排查。

### `GET /api/admin/generations` — R

查询：`user=`（邮箱精确或 uuid）、`model=`、`status=`（可逗号分隔多个）、`kind=`、`from=`、`to=`、`cursor=`、`limit=`。
排序：`created_at DESC, id DESC`。响应 `{ items: AdminGeneration[], next_cursor }`。
错误：`400 invalid_status`、`400 invalid_date_range`（`from > to` 或跨度 > 366 天）；`user` 找不到返回空列表（不暴露用户是否存在之外的信息，viewer 也能查）。
索引：需新增 `generation_records (created_at DESC, id DESC)`、`(model, created_at DESC)`、`(status, created_at DESC)`。

### `GET /api/admin/generations/:id` — R

→ 详情形状。`404 generation_not_found`。

### `POST /api/admin/generations/:id/resync` — W · 审计 `generation.resync`

- 对该记录的 `media_tasks` 立即执行一次 `syncMediaTasks`（与后台轮询同一函数，幂等），并触发一次 lanehub 扣费回填（`recordLanehubCharge`）。
- 只允许 `queued|running`，或 `succeeded` 但 `charged_points IS NULL`（补结算）；其它 `409 generation_not_syncable`。
- 响应：详情形状（同步后的最新状态）。上游不可用 `502 upstream_unavailable`。

### `POST /api/admin/generations/:id/cancel` — W · 审计 `generation.cancel`（details: `{ from_status, reason }`）

```json
{ "reason": "必填，1–200 字，例如「上游任务已丢失，用户反馈卡住」" }
```

- 用途：清理**卡住**的记录（占着用户「进行中」计数 24 的上限）。
- 前置条件（全部满足，否则 `409 generation_not_cancellable`，`error.reason` 说明哪条不满足）：
  1. `status IN ('queued','running')`；
  2. `created_at < now() - interval '2 hours'`；
  3. 服务端先执行一次 resync，resync 后仍是 queued/running。
- 效果：只改本地记录 `status='cancelled', failure_code='admin_cancelled'`；**不改钱**。
- **计费规则**：lanehub 模式下扣费发生在 lanehub（用户自己的额度），失败/取消由 lanehub 自己退回；网关这边的 `charged_points` 只由 lanehub 消费日志回填。所以：
  - 本接口**不做退款、不写 `wallet_entries`、不改 `charged_points`**；
  - 如果上游事后仍然成功，同步任务**不会**把 cancelled 改回 succeeded，但扣费回填照常写入 `charged_points`（事实记录），前端显示「已取消 · 扣点 x」；
  - 人工退款 / 核销仍在旧中台（`/admin/api/billing/:id/refund|resolve`、`/admin/api/requests/:id/charge`），迁移前不在新中台提供。

---

## 5. 审计日志（`audit_events`）

### `GET /api/admin/audit` — R

查询：`actor=`（邮箱或 uuid）、`action=`（精确，或前缀 `case.*`）、`target=`（精确 target_id）、`from=`、`to=`、`cursor=`、`limit=`。
排序：`id DESC`。

```json
{ "items": [{
  "id": 1024,
  "action": "case.status",
  "actor": { "id": "uuid", "email": "…" },
  "legacy_administrator_id": null,
  "target_id": "20000",
  "details": { "from": "draft", "to": "published" },
  "created_at": "…"
}], "next_cursor": "…" }
```

- 旧中台写的事件 `actor=null`，`legacy_administrator_id` 为旧 `administrators.id`。
- `details` 原样返回，但服务端写入时不得包含密钥、签名 URL、完整提示词。

### 事件名一览

| action | target_id | details |
|---|---|---|
| `case.create` | case id | `{ status: "draft" }` |
| `case.update` | case id | `{ fields: ["title", …] }` |
| `case.status` | case id | `{ from, to, bulk?: true }` |
| `case.reorder` | case id | `{ from, to }`（position） |
| `case.cover` | case id | `{ from_asset_id, to_asset_id, source_asset_id }` |
| `case.references` | case id | `{ count }` |
| `case.delete` | case id | `{ title }` |
| `role.grant` / `role.revoke` | user id | `{ role }`（已存在于 `roles.mjs`） |
| `generation.resync` | record id | `{ status_before, status_after }` |
| `generation.cancel` | record id | `{ from_status, reason }` |

---

## 6. 权限测试矩阵（B5 验收）

对下表每一行，分别用 **匿名 / 普通用户 / viewer / operator / admin / 超过 12 小时的 admin 会话** 调用：

| 接口组 | 匿名 | 普通用户 | viewer | operator | admin | 过期 admin |
|---|---|---|---|---|---|---|
| 全部 GET | 401 | 403 | 200 | 200 | 200 | 401 `admin_session_expired` |
| 案例写、生成记录操作 | 401 | 403 | 403 | 2xx | 2xx | 401 |
| 角色写 | 401 | 403 | 403 | 403 | 2xx | 401 |

另测：撤销自己 admin → 409；撤销最后一位 admin → 409；发布缺 license → 422 且列出全部字段；拖动到过期邻居 → 409；引用他人资产作封面 → 404。

---

## 7. 暂留旧中台的模块（§9.2 第 4 期再迁）

迁移期间 `https://api.ipzsk.com/admin` 保持可用，新中台左侧栏放「旧版管理后台」外链。以下模块本批**不做**：

| 模块 | 旧接口 |
|---|---|
| 充值码（批次、分配、导出、兑换记录） | `/admin/api/vouchers/*`、`/admin/api/wallet/entries` |
| 计费策略、账单、退款/核销 | `/admin/api/billing*`、`/admin/api/ledger`、`/admin/api/requests/:id/charge` |
| 上游账户与 Key、余额刷新 | `/admin/api/accounts*`、`/admin/api/keys*`、`/admin/api/balances/refresh` |
| 开发者审核 | `/admin/api/developers*` |
| 插件、插件技能、发布审核、调用价 | `/admin/api/plugins*`、`/admin/api/plugin-skills`、`/admin/api/skill-sightings` |
| 分成结算 | `/admin/api/settlements*` |
| 旧管理员账户、旧 API 请求明细、用户令牌、概览 | `/admin/api/administrators*`、`/admin/api/requests*`、`/admin/api/users*`、`/admin/api/overview` |

旧中台审计仍写 `audit_events.administrator_id`，新中台审计列表一并展示（见 §5）。
