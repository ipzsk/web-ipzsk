/** Pure helpers + types for the admin console (contract: docs/admin-api.md). Tested in lib.test.ts. */
import type { MediaAsset } from '@/media'
import type { MediaAsset as ServerAsset } from '@/shared/contracts'

export type Role = 'admin' | 'operator' | 'viewer'
export const ROLES: Role[] = ['admin', 'operator', 'viewer']
export const ROLE_LABEL: Record<Role, string> = { admin: '管理员', operator: '运营', viewer: '只读' }

/* ---------- role gating (§0.1) ---------- */

export type Capability = 'read' | 'cases.write' | 'generations.act' | 'ops.write' | 'roles.write'

export function can(roles: readonly string[], cap: Capability): boolean {
  if (cap === 'read') return roles.some(r => (ROLES as string[]).includes(r))
  if (cap === 'roles.write') return roles.includes('admin')
  return roles.includes('admin') || roles.includes('operator')
}

/**
 * The gateway only accepts /api/admin/* while the login session is younger than 12h, and it only
 * resets on a fresh sign-in — so `low` is the cue to offer re-auth before an edit is lost.
 */
export function sessionLeft(expiresAt: string, now = Date.now()) {
  const ms = Math.max(0, Date.parse(expiresAt) - now) || 0
  const hours = Math.floor(ms / 3600_000)
  return {
    ms,
    low: ms < 3600_000,
    label: ms === 0 ? '管理会话已过期' : hours >= 1 ? `会话剩余约 ${hours} 小时` : `会话剩余约 ${Math.max(1, Math.round(ms / 60_000))} 分钟`,
  }
}

/** Why a role chip can't be revoked (admin is acting). null = allowed. */
export function revokeBlockReason(p: { role: Role; targetId: string; meId: string; adminCount: number }): string | null {
  if (p.role !== 'admin') return null
  if (p.targetId === p.meId) return '不能撤销自己的管理员角色，请让另一位管理员操作'
  if (p.adminCount <= 1) return '这是最后一位管理员，先授予其他人管理员角色'
  return null
}

/* ---------- cases ---------- */

export type CaseStatus = 'draft' | 'published' | 'hidden'
export const STATUS_LABEL: Record<CaseStatus, string> = { draft: '草稿', published: '已发布', hidden: '已隐藏' }

export interface TemplateItem {
  key: string
  label: string
  description?: string
  count: number
  params?: { aspect_ratio?: string; resolution?: string }
  anchor?: boolean
  references?: { slot: string }[]
}
export interface CaseTemplate { items: TemplateItem[] }

export interface CaseFields {
  title: string
  prompt: string
  category: string
  category_zh: string | null
  tags: string[]
  model: string | null
  params: Record<string, string | number | boolean>
  template: CaseTemplate | null
  author: string | null
  author_url: string | null
  source_repo: string | null
  source_url: string | null
  license_note: string | null
}

export interface AdminCase extends CaseFields {
  id: string
  cover: ServerAsset | null
  references: ServerAsset[]
  status: CaseStatus
  position: number
  created_at: string
  updated_at: string
}

export const MAX_OUTPUTS = 12

export function templateIssues(t: CaseTemplate | null): string[] {
  if (!t) return []
  const out: string[] = []
  if (t.items.length < 1) out.push('模板至少要有 1 个输出规格')
  if (t.items.length > MAX_OUTPUTS) out.push(`模板最多 ${MAX_OUTPUTS} 个输出规格`)
  t.items.forEach((it, i) => {
    const n = `第 ${i + 1} 项`
    if (!it.label.trim()) out.push(`${n}缺少名称`)
    else if (it.label.length > 60) out.push(`${n}名称超过 60 字`)
    if (!Number.isInteger(it.count) || it.count < 1 || it.count > MAX_OUTPUTS) out.push(`${n}张数需为 1–${MAX_OUTPUTS} 的整数`)
    if (it.references?.some(r => !r.slot.trim() || r.slot.length > 30)) out.push(`${n}参考槽位名称需为 1–30 字`)
  })
  const total = t.items.reduce((s, it) => s + (Number.isFinite(it.count) ? it.count : 0), 0)
  if (total > MAX_OUTPUTS) out.push(`输出总张数 ${total} 超过上限 ${MAX_OUTPUTS}`)
  if (t.items.filter(it => it.anchor).length > 1) out.push('只能有一个锚图')
  return out
}

export type IssueField = keyof CaseFields | 'cover'
export interface FieldIssue { field: IssueField; reason: string }

const isHttps = (s: string) => { try { return new URL(s).protocol === 'https:' } catch { return false } }
const blank = (s: string | null | undefined) => !s || !s.trim()

/** Same rules as the server's publish check (§2.2); returns all issues, not just the first. */
export function publishIssues(c: CaseFields & { cover: MediaAsset | null }): FieldIssue[] {
  const out: FieldIssue[] = []
  if (blank(c.title)) out.push({ field: 'title', reason: '发布需要标题' })
  if (blank(c.prompt)) out.push({ field: 'prompt', reason: '发布需要提示词' })
  if (blank(c.category)) out.push({ field: 'category', reason: '发布需要分类' })
  else if (!/^[a-z0-9-]{1,60}$/.test(c.category)) out.push({ field: 'category', reason: '分类 id 只能用小写字母、数字和连字符' })
  if (!c.cover) out.push({ field: 'cover', reason: '发布需要封面' })
  else if (c.cover.status !== 'ready') out.push({ field: 'cover', reason: '封面还在处理中' })
  if (blank(c.license_note)) out.push({ field: 'license_note', reason: '发布需要授权说明（来源仓库、授权、采集时间）' })
  if (blank(c.source_repo) && blank(c.source_url)) out.push({ field: 'source_url', reason: '来源仓库或原帖链接至少填一个' })
  if (!blank(c.source_url) && !isHttps(c.source_url!)) out.push({ field: 'source_url', reason: '原帖链接需为 https:// 地址' })
  if (!blank(c.author_url) && !isHttps(c.author_url!)) out.push({ field: 'author_url', reason: '作者主页需为 https:// 地址' })
  for (const reason of templateIssues(c.template)) out.push({ field: 'template', reason })
  return out
}

/** Server field codes (422 case_publish_invalid) → Chinese. */
export function serverIssues(body: unknown): FieldIssue[] {
  const fields = (body as { error?: { fields?: { field: string; code: string }[] } } | null)?.error?.fields ?? []
  const text: Record<string, string> = { required: '必填', too_long: '太长', invalid: '格式不正确', invalid_url: '需为 https:// 地址', source_required: '来源仓库或原帖链接至少填一个', cover_not_ready: '封面还在处理中' }
  return fields.map(f => ({ field: f.field as IssueField, reason: text[f.code] ?? f.code }))
}

/* ---------- reorder (§2.3 position) ---------- */

export function positionBetween(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2
  if (prev !== undefined) return prev + 1
  if (next !== undefined) return next - 1
  return 0
}

/** Move `activeId` to where `overId` is. Returns the new list (moved item carries its new position) and the neighbors to send. */
export function moveCase<T extends { id: string; position: number }>(list: T[], activeId: string, overId: string) {
  const from = list.findIndex(x => x.id === activeId)
  const to = list.findIndex(x => x.id === overId)
  if (from < 0 || to < 0 || from === to) return null
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  const after = next[to - 1], before = next[to + 1]
  const position = positionBetween(after?.position, before?.position)
  next[to] = { ...item!, position }
  return { list: next, position, after_id: after?.id ?? null, before_id: before?.id ?? null }
}

/* ---------- generations ---------- */

export type GenStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export const GEN_STATUS_LABEL: Record<GenStatus, string> = { queued: '排队中', running: '生成中', succeeded: '成功', failed: '失败', cancelled: '已取消' }

export const STUCK_MS = 2 * 3600_000

/** §4 cancel preconditions visible to the client (server re-checks after a resync). */
export function cancelBlockReason(r: { status: GenStatus; created_at: string }, now = Date.now()): string | null {
  if (r.status !== 'queued' && r.status !== 'running') return '只有排队中或生成中的记录可以标记取消'
  if (now - Date.parse(r.created_at) < STUCK_MS) return '提交不足 2 小时，先等待或重新同步'
  return null
}

/** Same gateway failure-code map as the studio (create/lib.ts), so both consoles say the same thing. */
export { FAILURE_MESSAGES as FAILURE_LABEL } from '@/studio/create/lib'

export const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false })
export const fmtPoints = (p: string | null) => p == null ? '结算中' : `${Number(p).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 点`
