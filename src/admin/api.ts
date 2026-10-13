import { ApiError, request } from '@/shared/api'
import type { MediaAsset } from '@/shared/contracts'
import type { AdminGeneration, AdminGenerationDetail, AdminMe, AdminUserDetail, AdminUserSummary, AuditEvent, RoleGrant, UserRef, WalletGrantCreate, WalletGrantResult } from '@/shared/contracts'
import { MOCK_MODELS, isMock, mockDelay } from '@/studio/api/catalog'
import { can, grantIssues, publishIssues, positionBetween, type AdminCase, type CaseFields, type CaseStatus, type Capability, type GenStatus, type Role } from './lib'

/* Adapters for docs/admin-api.md. Mock: `?mock=1` (same switch as studio) + `&role=admin|operator|viewer|none|expired|guest`. */

export interface Page<T> { items: T[]; next_cursor: string | null; total?: number }
// Response shapes are the generated gateway contracts; mocks below must produce exactly these (contracts/mocks.test.ts).
export type { AdminGeneration, AdminGenerationDetail, AdminMe, AdminUserDetail, AdminUserSummary, AuditEvent, RoleGrant, UserRef } from '@/shared/contracts'
export interface CaseQuery { status?: CaseStatus | ''; category?: string; q?: string; cursor?: string | null }
export interface CategoryCount { category: string; category_zh: string | null; count: number }
export type CaseCreate = Partial<CaseFields> & Pick<CaseFields, 'title' | 'prompt' | 'category'> & Partial<Pick<AdminCase, 'kind' | 'license_tier'>> & { id?: string; cover_asset_id: string }
export type CasePatch = Partial<CaseFields> & { status?: CaseStatus; expected_updated_at?: string }
export interface BulkResult { items: { id: string; ok: boolean; error?: { code: string; fields?: { field: string; code: string }[] } }[] }
export interface GenerationQuery { user?: string; model?: string; status?: string; kind?: string; from?: string; to?: string; cursor?: string | null }
export interface AuditQuery { actor?: string; action?: string; target?: string; from?: string; to?: string; cursor?: string | null }

export interface AdminApi {
  me(): Promise<AdminMe>
  cases: {
    list(q: CaseQuery): Promise<Page<AdminCase>>
    categories(): Promise<CategoryCount[]>
    get(id: string): Promise<AdminCase>
    create(body: CaseCreate, idempotencyKey?: string): Promise<AdminCase>
    update(id: string, patch: CasePatch): Promise<AdminCase>
    move(id: string, to: { after_id: string | null; before_id: string | null }): Promise<{ id: string; position: number }>
    bulkStatus(ids: string[], status: CaseStatus): Promise<BulkResult>
    setCover(id: string, asset_id: string): Promise<AdminCase>
    setReferences(id: string, asset_ids: string[]): Promise<AdminCase>
    remove(id: string): Promise<void>
  }
  users: {
    search(q: string, cursor?: string | null): Promise<Page<AdminUserSummary>>
    get(id: string): Promise<AdminUserDetail>
    staff(): Promise<{ user: UserRef; roles: RoleGrant[] }[]>
    grant(id: string, role: Role): Promise<{ roles: Role[] }>
    revoke(id: string, role: Role): Promise<{ roles: Role[] }>
    /** `key` is one Idempotency-Key per grant: a retry after an error sends the same key and can never pay twice. */
    grantWallet(id: string, body: WalletGrantCreate, key: string): Promise<WalletGrantResult>
  }
  generations: {
    list(q: GenerationQuery): Promise<Page<AdminGeneration>>
    get(id: string): Promise<AdminGenerationDetail>
    resync(id: string): Promise<AdminGenerationDetail>
    cancel(id: string, reason: string): Promise<AdminGenerationDetail>
  }
  audit: { list(q: AuditQuery): Promise<Page<AuditEvent>> }
}

const qs = (o: object) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v))
  return p.toString()
}
const enc = encodeURIComponent

/**
 * First save of a new case is two requests (create, then references). If create succeeded but its response or the
 * references call failed, the next save must not create a second draft (and a second cover copy in R2).
 * `session` lives as long as the editor: a lost create is replayed with the same Idempotency-Key; a case that was
 * already created is updated in place.
 */
export interface NewCaseSession { key: string; created: AdminCase | null; coverId: string | null }
export const newCaseSession = (): NewCaseSession => ({ key: crypto.randomUUID(), created: null, coverId: null })
export async function saveNewCase(api: AdminApi, session: NewCaseSession, fields: CaseFields, coverId: string, referenceIds: string[]): Promise<AdminCase> {
  let c = session.created
  if (!c) { c = session.created = await api.cases.create({ ...fields, cover_asset_id: coverId }, session.key); session.coverId = coverId }
  else {
    c = session.created = await api.cases.update(c.id, { ...fields, expected_updated_at: c.updated_at })
    // The gateway copies the cover on create, so compare with what was submitted, not the copy's id.
    if (session.coverId !== coverId) { c = session.created = await api.cases.setCover(c.id, coverId); session.coverId = coverId }
  }
  return referenceIds.length ? (session.created = await api.cases.setReferences(c.id, referenceIds)) : c
}

export const realApi: AdminApi = {
  me: () => request('/api/admin/me'),
  cases: {
    list: q => request(`/api/admin/cases?${qs(q)}`),
    categories: async () => (await request<{ items: CategoryCount[] }>('/api/admin/case-categories')).items,
    get: id => request(`/api/admin/cases/${enc(id)}`),
    create: (body, key = crypto.randomUUID()) => request('/api/admin/cases', { body, headers: { 'Idempotency-Key': key } }),
    update: (id, patch) => request(`/api/admin/cases/${enc(id)}`, { method: 'PATCH', body: patch }),
    move: (id, to) => request(`/api/admin/cases/${enc(id)}/position`, { method: 'PATCH', body: to }),
    bulkStatus: (ids, status) => request('/api/admin/cases/bulk-status', { body: { ids, status } }),
    setCover: (id, asset_id) => request(`/api/admin/cases/${enc(id)}/cover`, { method: 'PUT', body: { asset_id } }),
    setReferences: (id, asset_ids) => request(`/api/admin/cases/${enc(id)}/references`, { method: 'PUT', body: { asset_ids } }),
    remove: async id => { await request(`/api/admin/cases/${enc(id)}`, { method: 'DELETE' }) },
  },
  users: {
    search: (q, cursor) => request(`/api/admin/users?${qs({ q, cursor })}`),
    get: id => request(`/api/admin/users/${enc(id)}`),
    staff: async () => (await request<{ items: { user: UserRef; roles: RoleGrant[] }[] }>('/api/admin/roles')).items,
    grant: (id, role) => request(`/api/admin/users/${enc(id)}/roles/${role}`, { method: 'PUT' }),
    revoke: (id, role) => request(`/api/admin/users/${enc(id)}/roles/${role}`, { method: 'DELETE' }),
    grantWallet: (id, body, key) => request(`/api/admin/users/${enc(id)}/wallet-grants`, { body, headers: { 'Idempotency-Key': key } }),
  },
  generations: {
    list: q => request(`/api/admin/generations?${qs(q)}`),
    get: id => request(`/api/admin/generations/${enc(id)}`),
    resync: id => request(`/api/admin/generations/${enc(id)}/resync`, { body: {} }),
    cancel: (id, reason) => request(`/api/admin/generations/${enc(id)}/cancel`, { body: { reason } }),
  },
  audit: { list: q => request(`/api/admin/audit?${qs(q)}`) },
}

/* ───────────────────────────── mock ───────────────────────────── */

export type MockRole = Role | 'none' | 'expired' | 'guest'

const err = (status: number, code: string, body?: unknown) => new ApiError(code, { status, code, body: body ?? { error: { code, message: code } } })

// Deterministic PRNG so screenshots/tests are stable.
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) }
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!
const pic = (seed: string, w = 480, h = 480): MediaAsset => ({
  id: `a-${seed}`, kind: 'image', source: 'generation', status: 'ready', width: w, height: h, duration_ms: null, thumb_state: 'done', created_at: '2026-09-01T00:00:00Z',
  urls: { w480: `https://picsum.photos/seed/${seed}/${Math.round(w / 2)}/${Math.round(h / 2)}`, orig: `https://picsum.photos/seed/${seed}/${w}/${h}` },
})

type ManifestRow = { id: string; title: string; prompt: string; category: string; categoryZh: string; tags: string[]; model?: string | null; params?: Record<string, string | number | boolean>; image: { url: string; orig: string; width: number; height: number }; author?: string | null; author_url?: string | null; source_url?: string | null; source_repo: string; license_note: string; template?: AdminCase['template'] }

export function createMockApi(role: MockRole = 'admin', delay = mockDelay): AdminApi {
  const r = rng(7)
  const DAY = 86400_000, now = Date.now()
  const iso = (t: number) => new Date(t).toISOString()
  const names = ['林晓', '陈默', '王一', '赵青', '周舟', '吴桐', '郑好', '孙悦', '李想', '何夕', '冯远', '许诺']
  const me: AdminUserSummary = { id: 'u-me', email: 'icycat@ipzsk.com', name: '冷酷小猫', email_verified: true, created_at: iso(now - 300 * DAY), roles: ROLE_OF(role) }
  const users: AdminUserSummary[] = [me, ...Array.from({ length: 40 }, (_, i) => ({
    id: `u-${i + 1}`, email: `user${i + 1}@example.com`, name: names[i % names.length]!, email_verified: i % 9 !== 5,
    created_at: iso(now - (i + 1) * 5 * DAY), roles: (i === 0 ? ['admin'] : i === 1 ? ['operator'] : i === 2 ? ['viewer', 'operator'] : i === 3 ? ['viewer'] : []) as Role[],
  }))]
  const grants = new Map<string, Map<Role, RoleGrant>>()
  for (const u of users) grants.set(u.id, new Map(u.roles.map(role => [role, { role, granted_at: iso(now - 30 * DAY), granted_by: me.id === u.id ? null : { id: me.id, email: me.email } }])))
  const rolesOf = (id: string) => [...(grants.get(id)?.keys() ?? [])].sort() as Role[]
  const granted = new Map<string, number>() // user id → 元 granted in this session
  const grantKeys = new Map<string, { fingerprint: string; grant: WalletGrantResult['grant'] }>()
  const walletOf = (id: string): Pick<AdminUserDetail, 'wallet' | 'wallet_error'> => {
    const n = Number(id.split('-')[1]) || 0
    return n % 11 === 7 ? { wallet: null, wallet_error: 'billing_unavailable' }
      : { wallet: { available_points: (n * 37.5 + (granted.get(id) ?? 0) * 100).toFixed(8), frozen_points: (n % 3 ? 0 : 12).toFixed(8) }, wallet_error: null }
  }
  const refOf = (u: AdminUserSummary): UserRef => ({ id: u.id, email: u.email, name: u.name })

  const models = MOCK_MODELS.map(m => m.id)
  const statuses: GenStatus[] = ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'failed', 'running', 'queued', 'cancelled']
  const failures = ['upstream_unavailable', 'queue_timeout', 'unsupported_parameter', 'media_storage_unavailable'] // gateway codes (endpoints.json)
  const prompts = ['一只橘猫戴宇航员头盔，电影感光影', '极简风咖啡品牌海报，留白', '赛博朋克雨夜街道，灯牌倒影', '电商主图：白底蓝牙耳机', '水彩风江南小镇清晨', '产品详情页卖点图：保温杯']
  const records: AdminGenerationDetail[] = Array.from({ length: 420 }, (_, i) => {
    const u = users[1 + Math.floor(r() * 40)]!
    const model = pick(r, models)
    const status = i < 3 ? 'running' : pick(r, statuses)
    const created = now - i * 37 * 60_000 - Math.floor(r() * 600_000)
    const n = model.startsWith('seedance') ? 1 : 1 + Math.floor(r() * 2)
    return {
      id: `g-${String(i + 1).padStart(4, '0')}`, user: refOf(u), kind: model.startsWith('seedance') ? 'video' : 'image', model,
      prompt: pick(r, prompts), params: { aspect_ratio: pick(r, ['1:1', '16:9', '3:4']), resolution: '2K', n },
      status, failure_code: status === 'failed' ? pick(r, failures) : null,
      charged_points: status === 'succeeded' && r() > 0.1 ? (6 * n).toFixed(8) : status === 'failed' || status === 'cancelled' ? '0.00000000' : null,
      source: pick(r, ['studio', 'studio', 'template', 'canvas'] as const), batch_id: null, batch_position: null,
      created_at: iso(created), updated_at: iso(created + 90_000),
      failure_message: status === 'failed' ? 'upstream error: task timeout after 600s' : null,
      request_id: `req-${i + 1}`, idempotency_key: `q:${i + 1}`,
      upstream: { provider: 'lanehub', request_id: `lh-${(i * 7919).toString(16)}`, task_id: `task_${(i * 104729).toString(36)}`, task_status: status, last_synced_at: iso(created + 60_000) },
      billing: { mode: 'lanehub', state: status === 'succeeded' ? 'charged' : status === 'failed' || status === 'cancelled' ? 'released' : 'pending', cost_cny: null },
      references: i % 4 === 0 ? [pic(`ref${i}`)] : i % 13 === 1 ? [{ id: `a-gone${i}`, status: 'deleted', missing: true }] : [],
      results: status === 'succeeded' ? Array.from({ length: n }, (_, k) => pic(`gen${i}-${k}`)) : [],
      thread_id: null, anchor_record_id: null, parent_record_id: null, source_case_id: null,
      deleted_at: i % 29 === 0 ? iso(created + DAY) : null,
    }
  })
  // One stuck record so 「标记取消」 is actionable in the demo.
  Object.assign(records[5]!, { status: 'running', failure_code: null, charged_points: null, results: [], created_at: iso(now - 5 * 3600_000) })

  const audit: AuditEvent[] = []
  let auditSeq = 0
  const log = (action: string, target_id: string | null, details: Record<string, unknown>, t = now) =>
    audit.unshift({ id: ++auditSeq, action, actor: refOf(me), legacy_administrator_id: null, target_id, details, created_at: iso(t) })
  for (let i = 60; i > 0; i--) {
    const kind = pick(r, ['case.update', 'case.status', 'case.reorder', 'role.grant', 'generation.resync'])
    log(kind, kind.startsWith('role') ? pick(r, users).id : kind.startsWith('gen') ? pick(r, records).id : String(20000 + Math.floor(r() * 50)),
      kind === 'case.status' ? { from: 'draft', to: 'published' } : kind === 'role.grant' ? { role: 'viewer' } : kind === 'case.update' ? { fields: ['title'] } : {}, now - i * 3 * 3600_000)
    if (i % 7 === 0) audit[0] = { ...audit[0]!, actor: null, legacy_administrator_id: 1 }
  }

  let cases: AdminCase[] | null = null
  const loadCases = async () => {
    if (cases) return cases
    const rows = (await import('@/studio/inspiration/data/cases.manifest.json')).default as ManifestRow[]
    cases = rows.map((m, i): AdminCase => ({
      id: m.id, title: m.title, prompt: m.prompt, category: m.category, category_zh: m.categoryZh, tags: m.tags, model: m.model ?? null,
      params: m.params ?? {}, template: m.template ?? null, kind: 'image', license_tier: null, video: null,
      cover: { id: `cover-${m.id}`, kind: 'image', source: 'case', status: 'ready', width: m.image.width, height: m.image.height, duration_ms: null, thumb_state: 'done', created_at: iso(now), urls: { w480: m.image.url, orig: m.image.orig } },
      references: [], author: m.author ?? null, author_url: m.author_url ?? null, source_repo: m.source_repo, source_url: m.source_url ?? null, license_note: m.license_note,
      status: i % 17 === 3 ? 'hidden' : 'published', position: i, created_at: iso(now - (600 - i) * 3600_000), updated_at: iso(now - (600 - i) * 3600_000),
    }))
    // Drafts at the top missing license/source → publishing shows the validation path.
    for (const c of cases.slice(0, 3)) Object.assign(c, { status: 'draft', license_note: null, source_repo: null, source_url: null })
    return cases
  }

  const allowed = (cap: Capability) => {
    if (role === 'guest') throw err(401, 'customer_login_required')
    if (role === 'expired') throw err(401, 'admin_session_expired')
    if (!can(ROLE_OF(role), cap)) throw err(403, 'forbidden_role')
  }
  const gate = async (cap: Capability) => { await delay(); allowed(cap) }
  const page = <T,>(items: T[], cursor: string | null | undefined, size = 50): Page<T> => {
    const start = Number(cursor) || 0
    return { items: items.slice(start, start + size), next_cursor: start + size < items.length ? String(start + size) : null }
  }
  const findCase = async (id: string) => { const c = (await loadCases()).find(x => x.id === id); if (!c) throw err(404, 'case_not_found'); return c }
  const sorted = (xs: AdminCase[]) => xs.slice().sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
  const publishCheck = (c: AdminCase) => {
    const issues = publishIssues(c)
    if (!issues.length) return null
    const code = (reason: string) => reason.includes('至少') ? 'source_required' : reason.includes('https') ? 'invalid_url' : 'required'
    return { code: 'case_publish_invalid', message: 'case_publish_invalid', fields: issues.map(i => ({ field: i.field, code: code(i.reason) })) }
  }
  const touch = (c: AdminCase) => { c.updated_at = new Date().toISOString() }
  const inRange = (t: string, from?: string, to?: string) => (!from || t >= from) && (!to || t.slice(0, 10) <= to)

  return {
    async me() {
      await delay()
      if (role === 'guest') throw err(401, 'customer_login_required')
      if (role === 'expired') throw err(401, 'admin_session_expired')
      if (role === 'none') throw err(403, 'forbidden_role')
      return { user: refOf(me), roles: ROLE_OF(role), session: { created_at: iso(now - 3600_000), expires_at: iso(now + 11 * 3600_000) } }
    },
    cases: {
      async list(q) {
        await gate('read')
        const terms = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        const hits = sorted(await loadCases()).filter(c => (!q.status || c.status === q.status) && (!q.category || c.category === q.category)
          && terms.every(t => c.id === t || `${c.title}\n${c.prompt}\n${c.tags.join(' ')}`.toLowerCase().includes(t)))
        const p = page(hits, q.cursor)
        return { ...p, total: hits.length, items: p.items.map(c => ({ ...c, prompt: c.prompt.slice(0, 200) })) } // AdminCasePage is the only page with `total`
      },
      async categories() {
        await gate('read')
        const m = new Map<string, CategoryCount>()
        for (const c of sorted(await loadCases())) {
          const e = m.get(c.category) ?? { category: c.category, category_zh: c.category_zh, count: 0 }
          e.count++; m.set(c.category, e)
        }
        return [...m.values()]
      },
      async get(id) { await gate('read'); return structuredClone(await findCase(id)) },
      async create(body) {
        await gate('cases.write')
        const all = await loadCases()
        const id = body.id || `c_${Date.now().toString(36)}`
        if (all.some(c => c.id === id)) throw err(409, 'case_id_taken')
        const t = new Date().toISOString()
        const c: AdminCase = {
          id, title: body.title, prompt: body.prompt, category: body.category, category_zh: body.category_zh ?? null, tags: body.tags ?? [], model: body.model ?? null,
          params: body.params ?? {}, template: body.template ?? null, author: body.author ?? null, author_url: body.author_url ?? null,
          kind: body.kind ?? 'image', license_tier: body.license_tier ?? null, video: null,
          source_repo: body.source_repo ?? null, source_url: body.source_url ?? null, license_note: body.license_note ?? null,
          cover: pic(body.cover_asset_id.slice(0, 8), 960, 960), references: [], status: 'draft',
          position: Math.min(0, ...all.map(x => x.position)) - 1, created_at: t, updated_at: t,
        }
        all.push(c); log('case.create', id, { status: 'draft' }, Date.now())
        return structuredClone(c)
      },
      async update(id, { expected_updated_at, ...patch }) {
        await gate('cases.write')
        const c = await findCase(id)
        if (expected_updated_at && expected_updated_at !== c.updated_at) throw err(409, 'case_conflict', { error: { code: 'case_conflict' }, case: c })
        const next = { ...c, ...patch }
        if (next.status === 'published') { const e = publishCheck(next); if (e) throw err(422, e.code, { error: e }) }
        if (patch.status && patch.status !== c.status) log('case.status', id, { from: c.status, to: patch.status }, Date.now())
        const fields = Object.keys(patch).filter(k => k !== 'status')
        if (fields.length) log('case.update', id, { fields }, Date.now())
        Object.assign(c, patch); touch(c)
        return structuredClone(c)
      },
      async move(id, { after_id, before_id }) {
        await gate('cases.write')
        const c = await findCase(id)
        if (!after_id && !before_id) throw err(400, 'invalid_position')
        const a = after_id ? await findCase(after_id) : undefined, b = before_id ? await findCase(before_id) : undefined
        if (a && b && a.position >= b.position) throw err(409, 'case_order_conflict')
        const from = c.position
        c.position = positionBetween(a?.position, b?.position); touch(c)
        log('case.reorder', id, { from, to: c.position }, Date.now())
        return { id, position: c.position }
      },
      async bulkStatus(ids, status) {
        await gate('cases.write')
        const items: BulkResult['items'] = []
        for (const id of ids) {
          const c = (await loadCases()).find(x => x.id === id)
          if (!c) { items.push({ id, ok: false, error: { code: 'case_not_found' } }); continue }
          const e = status === 'published' ? publishCheck(c) : null
          if (e) { items.push({ id, ok: false, error: e }); continue }
          if (c.status !== status) log('case.status', id, { from: c.status, to: status, bulk: true }, Date.now())
          c.status = status; touch(c); items.push({ id, ok: true })
        }
        return { items }
      },
      async setCover(id, asset_id) {
        await gate('cases.write')
        const c = await findCase(id)
        const from = c.cover?.id ?? null
        c.cover = pic(asset_id.slice(0, 8), 960, 960); touch(c)
        log('case.cover', id, { from_asset_id: from, to_asset_id: c.cover.id, source_asset_id: asset_id }, Date.now())
        return structuredClone(c)
      },
      async setReferences(id, asset_ids) {
        await gate('cases.write')
        if (asset_ids.length > 8) throw err(400, 'too_many_references')
        const c = await findCase(id)
        c.references = asset_ids.map(a => c.references.find(x => x.id === a) ?? pic(a.slice(0, 8)))
        touch(c); log('case.references', id, { count: asset_ids.length }, Date.now())
        return structuredClone(c)
      },
      async remove(id) {
        await gate('cases.write')
        const all = await loadCases(), c = await findCase(id)
        if (c.status !== 'draft') throw err(409, 'case_not_draft')
        all.splice(all.indexOf(c), 1); log('case.delete', id, { title: c.title }, Date.now())
      },
    },
    users: {
      async search(q, cursor) {
        await gate('read')
        const s = q.trim().toLowerCase()
        if (!s) throw err(400, 'invalid_query')
        return page(users.filter(u => u.id === s || !!u.email?.includes(s) || (u.name ?? '').toLowerCase().includes(s)).map(u => ({ ...u, roles: rolesOf(u.id) })), cursor)
      },
      async get(id) {
        await gate('read')
        const u = users.find(x => x.id === id)
        if (!u) throw err(404, 'user_not_found')
        const mine = records.filter(x => x.user.id === id)
        const recent = mine.filter(x => Date.parse(x.created_at) > now - 30 * DAY)
        const n = Number(id.split('-')[1]) || 0
        return {
          user: { id: u.id, email: u.email, name: u.name, email_verified: u.email_verified, created_at: u.created_at, last_sign_in_at: iso(now - n * 3600_000) },
          roles: [...(grants.get(id)?.values() ?? [])],
          developer: { state: n % 5 === 2 ? 'approved' : null },
          ...walletOf(id),
          usage: {
            last_30d: { generations: recent.length, succeeded: recent.filter(x => x.status === 'succeeded').length, failed: recent.filter(x => x.status === 'failed').length, cancelled: recent.filter(x => x.status === 'cancelled').length, charged_points: recent.reduce((s, x) => s + Number(x.charged_points ?? 0), 0).toFixed(8) },
            total_generations: mine.length, storage: { assets: n * 3, bytes: n * 12_345_678 },
          },
          recent_generations: mine.slice(0, 10),
        }
      },
      async staff() {
        await gate('read')
        return users.filter(u => rolesOf(u.id).length).map(u => ({ user: refOf(u), roles: [...grants.get(u.id)!.values()] }))
      },
      async grant(id, r) {
        await gate('roles.write')
        const u = users.find(x => x.id === id)
        if (!u) throw err(404, 'user_not_found')
        if (!u.email_verified) throw err(409, 'email_not_verified')
        const g = grants.get(id)!
        if (!g.has(r)) { g.set(r, { role: r, granted_at: new Date().toISOString(), granted_by: refOf(me) }); log('role.grant', id, { role: r }, Date.now()) }
        return { roles: rolesOf(id) }
      },
      async grantWallet(id, body, key) {
        await gate('wallet.grant')
        const u = users.find(x => x.id === id)
        if (!u) throw err(404, 'user_not_found')
        const issues = grantIssues(body.amount_cny, body.reason)
        if (issues.amount) throw err(400, 'invalid_amount')
        if (issues.reason) throw err(400, 'invalid_reason')
        const fingerprint = `${id}|${Number(body.amount_cny).toFixed(2)}|${body.reason.trim()}`
        const prior = grantKeys.get(key)
        if (prior && prior.fingerprint !== fingerprint) throw err(409, 'idempotency_conflict')
        if (!prior) {
          granted.set(id, (granted.get(id) ?? 0) + Number(body.amount_cny))
          const grant = { id: crypto.randomUUID(), amount_cny: Number(body.amount_cny).toFixed(2), reason: body.reason.trim(), created_at: new Date().toISOString() }
          grantKeys.set(key, { fingerprint, grant })
          log('wallet.grant', id, { amount_cny: grant.amount_cny, reason: grant.reason }, Date.now())
        }
        return { grant: grantKeys.get(key)!.grant, ...walletOf(id) }
      },
      async revoke(id, r) {
        await gate('roles.write')
        if (r === 'admin' && id === me.id) throw err(409, 'cannot_revoke_own_admin')
        if (r === 'admin' && users.filter(u => rolesOf(u.id).includes('admin')).length <= 1) throw err(409, 'last_admin')
        const g = grants.get(id)
        if (g?.delete(r)) log('role.revoke', id, { role: r }, Date.now())
        return { roles: rolesOf(id) }
      },
    },
    generations: {
      async list(q) {
        await gate('read')
        const u = q.user?.trim().toLowerCase()
        const st = q.status ? q.status.split(',') : null
        const hits = records.filter(x => (!u || x.user.email === u || x.user.id === u) && (!q.model || x.model === q.model)
          && (!st || st.includes(x.status)) && (!q.kind || x.kind === q.kind) && inRange(x.created_at, q.from, q.to))
        const p = page(hits, q.cursor)
        return { ...p, items: p.items.map(({ failure_message: _f, request_id: _r, idempotency_key: _i, upstream: _u, billing: _b, references: _re, results: _rs, deleted_at: _d, thread_id: _t, anchor_record_id: _a, parent_record_id: _p, source_case_id: _s, ...x }) => x) }
      },
      async get(id) { await gate('read'); const x = records.find(y => y.id === id); if (!x) throw err(404, 'generation_not_found'); return structuredClone(x) },
      async resync(id) {
        await gate('generations.act')
        const x = records.find(y => y.id === id)
        if (!x) throw err(404, 'generation_not_found')
        x.upstream.last_synced_at = new Date().toISOString()
        log('generation.resync', id, { status_before: x.status, status_after: x.status }, Date.now())
        return structuredClone(x)
      },
      async cancel(id, reason) {
        await gate('generations.act')
        const x = records.find(y => y.id === id)
        if (!x) throw err(404, 'generation_not_found')
        if (!['queued', 'running'].includes(x.status) || Date.now() - Date.parse(x.created_at) < 2 * 3600_000) throw err(409, 'generation_not_cancellable')
        log('generation.cancel', id, { from_status: x.status, reason }, Date.now())
        Object.assign(x, { status: 'cancelled', failure_code: 'admin_cancelled', updated_at: new Date().toISOString() })
        return structuredClone(x)
      },
    },
    audit: {
      async list(q) {
        await gate('read')
        const a = q.actor?.trim().toLowerCase()
        const act = q.action?.trim()
        return page(audit.filter(e => (!a || e.actor?.email === a || e.actor?.id === a)
          && (!act || (act.endsWith('*') ? e.action.startsWith(act.slice(0, -1)) : e.action === act))
          && (!q.target || e.target_id === q.target) && inRange(e.created_at, q.from, q.to)), q.cursor)
      },
    },
  }
}

function ROLE_OF(role: MockRole): Role[] {
  return role === 'admin' || role === 'operator' || role === 'viewer' ? [role] : []
}

export const mockRole: MockRole = (() => {
  try { return (new URLSearchParams(location.search).get('role') as MockRole | null) ?? 'admin' } catch { return 'admin' }
})()

export const adminApi: AdminApi = isMock ? createMockApi(mockRole) : realApi
