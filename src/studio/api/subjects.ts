import { ApiError, request } from '@/shared/api'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from './catalog'

export type SubjectKind = 'person' | 'character' | 'product' | 'object' | 'scene'
export const SUBJECT_KINDS: SubjectKind[] = ['person', 'character', 'product', 'object', 'scene']
export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = { person: '人物', character: '角色', product: '商品', object: '物体', scene: '场景' }

/** §2.9 / §8.7 subjects + subject_assets (ordered, 1–8). `cover` is one of `assets`. */
export interface Subject { id: string; name: string; kind: SubjectKind; note: string; cover: MediaAsset | null; assets: MediaAsset[] }

/*
 * §10.1 contract (assumed shapes until gateway B-subjects lands; adjust here only):
 *   GET    /api/me/subjects                     → { items: Subject[] }
 *   POST   /api/me/subjects {name,kind,note,asset_ids,cover_id} → Subject   (409 subject_name_taken)
 *   PATCH  /api/me/subjects/:id {name?,kind?,note?,cover_id?}   → Subject   (409 subject_name_taken)
 *   DELETE /api/me/subjects/:id                  → 204 (soft delete)
 *   PUT    /api/me/subjects/:id/assets {asset_ids} → Subject (whole ordered list, 1–8, ownership checked)
 */
export interface SubjectInput { name: string; kind: SubjectKind; note: string; assets: MediaAsset[]; cover_id: string | null }
export type SubjectPatch = Partial<Pick<Subject, 'name' | 'kind' | 'note'>> & { cover_id?: string | null }

const SUBJECT_ERRORS: Record<string, string> = {
  subject_name_taken: '名称已存在',
  subject_assets_invalid: '参考图需要 1–8 张，且必须是你自己的素材',
  subject_not_found: '主体已被删除',
}
export function subjectErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return SUBJECT_ERRORS[e.code] ?? e.message
  return e instanceof Error && e.message ? e.message : '操作未成功，请稍后重试'
}

// ── mock (localStorage, survives reload) ──────────────────────────────────

const pic = (seed: string, w = 600, h = 600): MediaAsset => ({
  id: `mock-${seed}`, kind: 'image', status: 'ready', width: w, height: h, duration_ms: null,
  urls: { w480: `https://picsum.photos/seed/${seed}/480/${Math.round((480 * h) / w)}`, w960: `https://picsum.photos/seed/${seed}/960/${Math.round((960 * h) / w)}`, orig: `https://picsum.photos/seed/${seed}/${w}/${h}` },
})
export const mockPic = pic

const mk = (id: string, name: string, kind: SubjectKind, seeds: string[]): Subject =>
  ({ id, name, kind, note: '', cover: pic(seeds[0]!), assets: seeds.map(s => pic(s)) })

export const MOCK_SUBJECTS: Subject[] = [
  mk('sub-orange', '橘猫阿福', 'character', ['cat1', 'cat2', 'cat3']),
  mk('sub-lin', '林小满', 'person', ['lin1', 'lin2', 'lin3', 'lin4']),
  mk('sub-bottle', '青柠气泡水', 'product', ['bottle1', 'bottle2', 'cat2']), // cat2 shared on purpose: dedupe demo
  mk('sub-studio', '白色摄影棚', 'scene', ['studio1']),
]

const MOCK_KEY = 'ipzsk.mock.subjects'
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
const withCover = (s: Subject, coverId: string | null | undefined): Subject =>
  ({ ...s, cover: s.assets.find(a => a.id === coverId) ?? s.assets[0] ?? null })

// ── adapter ───────────────────────────────────────────────────────────────

export async function listSubjects(): Promise<Subject[]> {
  if (isMock) { await mockDelay(300); return read() }
  return (await request<{ items: Subject[] }>('/api/me/subjects')).items
}

export async function createSubject(input: SubjectInput): Promise<Subject> {
  if (isMock) {
    await mockDelay(300)
    maybeFail()
    const items = read()
    if (taken(items, input.name)) throw nameTaken()
    const s = withCover({ id: crypto.randomUUID(), name: input.name.trim(), kind: input.kind, note: input.note, cover: null, assets: input.assets }, input.cover_id)
    write([s, ...items])
    return s
  }
  return request<Subject>('/api/me/subjects', {
    body: { name: input.name.trim(), kind: input.kind, note: input.note, asset_ids: input.assets.map(a => a.id), cover_id: input.cover_id },
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
    const next = withCover({ ...cur, assets }, cur.cover?.id)
    write(items.map(s => s.id === id ? next : s))
    return next
  }
  return request<Subject>(`/api/me/subjects/${id}/assets`, { method: 'PUT', body: { asset_ids: assets.map(a => a.id) } })
}

export async function deleteSubject(id: string): Promise<void> {
  if (isMock) { await mockDelay(200); maybeFail(); write(read().filter(s => s.id !== id)); return }
  await request(`/api/me/subjects/${id}`, { method: 'DELETE' })
}
