import { ApiError, request } from '@/shared/api'
import type { Page, RecordAsset, UserTemplate, UserTemplateCreate, UserTemplatePatch } from '@/shared/contracts'
import { api as assetsApi } from '../assets/api'
import { isMock, mockDelay } from './catalog'

export type { UserTemplate, UserTemplateCreate, UserTemplatePatch }

/* Contract: generated Endpoints — GET/POST /api/me/templates, PATCH/DELETE /api/me/templates/:id. */

const TEMPLATE_ERRORS: Record<string, string> = {
  invalid_name: '名称需要 1–60 个字',
  invalid_items: '模板需要 1–12 项',
  items_too_large: '模板内容过大，请减少项数或提示词长度',
  invalid_cover: '封面必须是你自己的素材',
  reference_asset_not_found: '有参考图已被删除或不属于你，请改为「应用时放入」',
  invalid_variables: '变量不符合要求（最多 20 个，名称不能重复）',
  unknown_model: '有型号已下线，请修改后再保存',
  invalid_param_value: '有参数不被型号支持，请修改后再保存',
  too_many_references: '参考图数量超过型号上限',
  template_not_found: '模板已被删除',
}
export function templateErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return TEMPLATE_ERRORS[e.code] ?? e.message
  return e instanceof Error && e.message ? e.message : '操作未成功，请稍后重试'
}

// ── mock (localStorage) ────────────────────────────────────────────────────
// Stored rows are the create body + id/timestamps; `cover` / `reference_assets` are resolved on read from the shared mock asset store
// (like the gateway: other users' / unknown ids → MissingAsset).
type Row = Omit<UserTemplate, 'cover' | 'reference_assets'>
const MOCK_KEY = 'ipzsk.mock.templates.v1'
const MOCK_PAGE = 12
const read = (): Row[] => { try { return JSON.parse(localStorage.getItem(MOCK_KEY) ?? '[]') } catch { return [] } }
const write = (xs: Row[]) => { try { localStorage.setItem(MOCK_KEY, JSON.stringify(xs)) } catch { /* quota */ } }
const bad = (code: string) => new ApiError(TEMPLATE_ERRORS[code] ?? code, { status: 400, code })
/** localStorage['ipzsk.mock.templates.fail']='1' → writes fail (rollback demo). */
const maybeFail = () => { if (localStorage.getItem('ipzsk.mock.templates.fail') === '1') throw new ApiError('服务暂时不可用，请稍后重试', { status: 503, code: 'http_503' }) }
function check(t: Partial<UserTemplateCreate>) {
  if (t.name !== undefined && ([...t.name.trim()].length < 1 || [...t.name.trim()].length > 60)) throw bad('invalid_name')
  if (t.items !== undefined && (t.items.length < 1 || t.items.length > 12)) throw bad('invalid_items')
}
const refIdsOf = (t: Pick<Row, 'items'>) => t.items.flatMap(i => (i.references ?? []).flatMap(r => 'asset_id' in r ? [r.asset_id] : []))
async function resolveMock(rows: Row[]): Promise<UserTemplate[]> {
  const wanted = new Set(rows.flatMap(t => [...(t.cover_id ? [t.cover_id] : []), ...refIdsOf(t)]))
  const found = new Map<string, RecordAsset>()
  for (let cursor: string | null = null, first = true; wanted.size > found.size && (first || cursor); first = false) {
    const page = await assetsApi.listAssets({}, cursor)
    for (const a of page.items) if (wanted.has(a.id)) found.set(a.id, a)
    cursor = page.next_cursor
  }
  const resolve = (id: string): RecordAsset => found.get(id) ?? { id, status: 'deleted', missing: true }
  return rows.map(t => ({ ...t, cover: t.cover_id ? resolve(t.cover_id) : null, reference_assets: Object.fromEntries(refIdsOf(t).map(id => [id, resolve(id)])) }))
}

/** One page, newest first (gateway: updated_at DESC, limit ≤ 50). */
export async function listTemplates(cursor: string | null = null): Promise<Page<UserTemplate>> {
  if (isMock) {
    await mockDelay(250)
    const all = read(), start = Number(cursor ?? 0), end = start + MOCK_PAGE
    return { items: await resolveMock(all.slice(start, end)), next_cursor: end < all.length ? String(end) : null }
  }
  return request<Page<UserTemplate>>(`/api/me/templates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
}

export async function createTemplate(body: UserTemplateCreate): Promise<UserTemplate> {
  if (isMock) {
    await mockDelay(300); maybeFail(); check(body)
    const now = new Date().toISOString()
    const t: Row = { id: crypto.randomUUID(), name: body.name.trim(), cover_id: body.cover_id ?? null, items: body.items, variables: body.variables ?? [], created_at: now, updated_at: now }
    write([t, ...read()])
    return (await resolveMock([t]))[0]!
  }
  return request<UserTemplate>('/api/me/templates', { body })
}

export async function updateTemplate(id: string, patch: UserTemplatePatch): Promise<UserTemplate> {
  if (isMock) {
    await mockDelay(250); maybeFail(); check(patch)
    const cur = read().find(t => t.id === id)
    if (!cur) throw new ApiError(TEMPLATE_ERRORS.template_not_found!, { status: 404, code: 'template_not_found' })
    const next: Row = { ...cur, ...patch, name: patch.name?.trim() ?? cur.name, updated_at: new Date().toISOString() }
    write([next, ...read().filter(t => t.id !== id)])
    return (await resolveMock([next]))[0]!
  }
  return request<UserTemplate>(`/api/me/templates/${id}`, { method: 'PATCH', body: patch })
}

export async function deleteTemplate(id: string): Promise<void> {
  if (isMock) { await mockDelay(200); maybeFail(); write(read().filter(t => t.id !== id)); return }
  await request(`/api/me/templates/${id}`, { method: 'DELETE' })
}
