import { ApiError, request } from '@/shared/api'
import type { MediaAsset } from '@/media'
import type { MediaAsset as ServerAsset, MissingAsset, RecordAsset, Subject, SubjectKind, SubjectPatch } from '@/shared/contracts'
import { isMock, mockDelay } from './catalog'

export type { Subject, SubjectKind, SubjectPatch }
export const SUBJECT_KINDS: SubjectKind[] = ['person', 'character', 'product', 'object', 'scene']
export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = { person: '人物', character: '角色', product: '商品', object: '物体', scene: '场景' }

/** `assets` / `cover` may be a MissingAsset (deleted / failed upload) — render 「素材已删除」, never send its id. */
export const isMissingAsset = (a: RecordAsset | MediaAsset | null | undefined): a is MissingAsset => !!a && 'missing' in a && a.missing === true
export const presentAssets = (s: Pick<Subject, 'assets'>): ServerAsset[] => s.assets.filter((a): a is ServerAsset => !isMissingAsset(a))
export const presentCover = (s: Pick<Subject, 'cover'>): ServerAsset | null => s.cover && !isMissingAsset(s.cover) ? s.cover : null
/** Locally built assets (uploads, pickers) lack server-only fields; fill them for optimistic / mock subjects. */
export const toServerAsset = (a: MediaAsset): ServerAsset => ({ source: 'upload', thumb_state: 'done', created_at: new Date().toISOString(), ...a })

/* Contract: generated Endpoints — GET/POST /api/me/subjects, PATCH/DELETE /:id, PUT /:id/assets {asset_ids, cover_id?}. */
export interface SubjectInput { name: string; kind: SubjectKind; note: string; assets: MediaAsset[]; cover_id: string | null }

const SUBJECT_ERRORS: Record<string, string> = {
  subject_name_taken: '名称已存在',
  invalid_asset_ids: '参考图需要 1–8 张',
  reference_asset_not_found: '有参考图已被删除或不属于你，请移除后重试',
  invalid_cover: '封面必须是参考图中的一张',
  invalid_name: '名称不符合要求（1–30 个字）',
  invalid_note: '备注最多 500 个字',
  subject_not_found: '主体已被删除',
}
export function subjectErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return SUBJECT_ERRORS[e.code] ?? e.message
  return e instanceof Error && e.message ? e.message : '操作未成功，请稍后重试'
}

// ── mock (localStorage, survives reload) ──────────────────────────────────

const pic = (seed: string, w = 600, h = 600): ServerAsset => ({
  id: `mock-${seed}`, kind: 'image', source: 'upload', status: 'ready', width: w, height: h, duration_ms: null, thumb_state: 'done', created_at: '2026-09-01T00:00:00Z',
  urls: { w480: `https://picsum.photos/seed/${seed}/480/${Math.round((480 * h) / w)}`, w960: `https://picsum.photos/seed/${seed}/960/${Math.round((960 * h) / w)}`, orig: `https://picsum.photos/seed/${seed}/${w}/${h}` },
})
export const mockPic = pic

const MOCK_TIME = '2026-09-01T00:00:00Z'
const mk = (id: string, name: string, kind: SubjectKind, seeds: string[], extra: RecordAsset[] = []): Subject =>
  ({ id, name, kind, note: null, cover_id: `mock-${seeds[0]}`, cover: pic(seeds[0]!), assets: [...seeds.map(s => pic(s)), ...extra], created_at: MOCK_TIME, updated_at: MOCK_TIME })

export const MOCK_SUBJECTS: Subject[] = [
  mk('sub-orange', '橘猫阿福', 'character', ['cat1', 'cat2', 'cat3']),
  mk('sub-lin', '林小满', 'person', ['lin1', 'lin2', 'lin3'], [{ id: 'mock-lin4-deleted', status: 'deleted', missing: true }]), // missing-asset demo
  mk('sub-bottle', '青柠气泡水', 'product', ['bottle1', 'bottle2', 'cat2']), // cat2 shared on purpose: dedupe demo
  mk('sub-studio', '白色摄影棚', 'scene', ['studio1']),
]

const MOCK_KEY = 'ipzsk.mock.subjects.v2'
const read = (): Subject[] => {
  try { const raw = localStorage.getItem(MOCK_KEY); return raw ? JSON.parse(raw) as Subject[] : structuredClone(MOCK_SUBJECTS) } catch { return structuredClone(MOCK_SUBJECTS) }
}
const write = (items: Subject[]) => { try { localStorage.setItem(MOCK_KEY, JSON.stringify(items)) } catch { /* quota */ } }
const taken = (items: Subject[], name: string, except?: string) =>
  items.some(s => s.id !== except && s.name.trim().toLowerCase() === name.trim().toLowerCase())
const nameTaken = () => new ApiError('名称已存在', { status: 409, code: 'subject_name_taken' })
const notFound = () => new ApiError('主体已被删除', { status: 404, code: 'subject_not_found' })
/** Mock failure switch for rollback demos: localStorage['ipzsk.mock.subjects.fail']='1'. */
const maybeFail = () => { if (localStorage.getItem('ipzsk.mock.subjects.fail') === '1') throw new ApiError('服务暂时不可用，请稍后重试', { status: 503, code: 'http_503' }) }
const withCover = (s: Subject, coverId: string | null | undefined): Subject => {
  const cover = s.assets.find(a => a.id === coverId) ?? s.assets[0] ?? null
  return { ...s, cover, cover_id: cover?.id ?? null, updated_at: new Date().toISOString() }
}

// ── adapter ───────────────────────────────────────────────────────────────

export async function listSubjects(): Promise<Subject[]> {
  if (isMock) { await mockDelay(300); return read() }
  return (await request<{ items: Subject[] }>('/api/me/subjects')).items // ponytail: first page only; follow next_cursor past 50 subjects
}

export async function createSubject(input: SubjectInput): Promise<Subject> {
  if (isMock) {
    await mockDelay(300)
    maybeFail()
    const items = read()
    if (taken(items, input.name)) throw nameTaken()
    const now = new Date().toISOString()
    const s = withCover({ id: crypto.randomUUID(), name: input.name.trim(), kind: input.kind, note: input.note || null, cover_id: null, cover: null, assets: input.assets.map(toServerAsset), created_at: now, updated_at: now }, input.cover_id)
    write([s, ...items])
    return s
  }
  return request<Subject>('/api/me/subjects', {
    body: { name: input.name.trim(), kind: input.kind, note: input.note || null, asset_ids: input.assets.map(a => a.id), cover_id: input.cover_id },
  })
}

export async function updateSubject(id: string, patch: SubjectPatch): Promise<Subject> {
  if (isMock) {
    await mockDelay(250)
    maybeFail()
    const items = read()
    const cur = items.find(s => s.id === id)
    if (!cur) throw notFound()
    if (patch.name != null && taken(items, patch.name, id)) throw nameTaken()
    const { cover_id, ...rest } = patch
    const next = withCover({ ...cur, ...rest, ...(rest.name != null && { name: rest.name.trim() }) }, cover_id !== undefined ? cover_id : cur.cover?.id)
    write(items.map(s => s.id === id ? next : s))
    return next
  }
  return request<Subject>(`/api/me/subjects/${id}`, { method: 'PATCH', body: patch })
}

/** Whole ordered list replace (1–8). The server keeps the cover if still present, else the first asset. */
export async function setSubjectAssets(id: string, assets: MediaAsset[]): Promise<Subject> {
  if (isMock) {
    await mockDelay(250)
    maybeFail()
    const items = read()
    const cur = items.find(s => s.id === id)
    if (!cur) throw notFound()
    const next = withCover({ ...cur, assets: assets.map(toServerAsset) }, cur.cover?.id)
    write(items.map(s => s.id === id ? next : s))
    return next
  }
  return request<Subject>(`/api/me/subjects/${id}/assets`, { method: 'PUT', body: { asset_ids: assets.map(a => a.id) } })
}

export async function deleteSubject(id: string): Promise<void> {
  if (isMock) { await mockDelay(200); maybeFail(); write(read().filter(s => s.id !== id)); return }
  await request(`/api/me/subjects/${id}`, { method: 'DELETE' })
}
