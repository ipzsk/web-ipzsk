// Optimistic cache writes for the ['subjects'] query (§6: snapshot → write → rollback + toast).
import type { MediaAsset } from '@/media'
import { queryClient } from '@/shared/query'
import { toast } from '@/ui'
import {
  createSubject, deleteSubject, presentAssets, setSubjectAssets, subjectErrorMessage, toServerAsset, updateSubject, type Subject, type SubjectInput, type SubjectPatch,
} from '../api/subjects'
import { copyName, undoable } from './logic'

export const SUBJECTS_KEY = ['subjects'] as const
const get = () => queryClient.getQueryData<Subject[]>(SUBJECTS_KEY)
const set = (fn: (xs: Subject[]) => Subject[]) => queryClient.setQueryData<Subject[]>(SUBJECTS_KEY, xs => fn(xs ?? []))
const replace = (id: string, s: Subject) => set(xs => xs.map(x => x.id === id ? s : x))
const fail = (title: string, e: unknown) => toast({ title, description: subjectErrorMessage(e), tone: 'error' })

/** Optimistic: prepend a temp card, swap in the server copy. Throws (after rollback) so the editor can show field errors. */
export async function createSubjectOptimistic(input: SubjectInput): Promise<Subject> {
  await queryClient.cancelQueries({ queryKey: SUBJECTS_KEY })
  const tempId = `temp-${crypto.randomUUID()}`
  const assets = input.assets.map(toServerAsset)
  const cover = assets.find(a => a.id === input.cover_id) ?? assets[0] ?? null
  const now = new Date().toISOString()
  set(xs => [{ id: tempId, name: input.name.trim(), kind: input.kind, note: input.note || null, cover_id: cover?.id ?? null, cover, assets, created_at: now, updated_at: now }, ...xs])
  try {
    const s = await createSubject(input)
    replace(tempId, s)
    return s
  } catch (e) {
    set(xs => xs.filter(x => x.id !== tempId))
    throw e
  }
}

/** Optimistic patch of name/kind/note/cover. Throws after rollback. */
export async function updateSubjectOptimistic(id: string, patch: SubjectPatch): Promise<Subject> {
  await queryClient.cancelQueries({ queryKey: SUBJECTS_KEY })
  const prev = get()?.find(x => x.id === id)
  if (prev) {
    const { cover_id, ...rest } = patch
    replace(id, { ...prev, ...rest, ...(cover_id !== undefined && { cover: prev.assets.find(a => a.id === cover_id) ?? prev.cover }) })
  }
  try {
    const s = await updateSubject(id, patch)
    replace(id, s)
    return s
  } catch (e) {
    if (prev) replace(id, prev)
    throw e
  }
}

export async function setAssetsOptimistic(id: string, assets: MediaAsset[]): Promise<Subject> {
  await queryClient.cancelQueries({ queryKey: SUBJECTS_KEY })
  const prev = get()?.find(x => x.id === id)
  if (prev) {
    const next = assets.map(toServerAsset)
    const cover = next.find(a => a.id === prev.cover?.id) ?? next[0] ?? null
    replace(id, { ...prev, assets: next, cover, cover_id: cover?.id ?? null })
  }
  try {
    const s = await setSubjectAssets(id, assets)
    replace(id, s)
    return s
  } catch (e) {
    if (prev) replace(id, prev)
    throw e
  }
}

/** Card delete: vanish now, 「已删除 · 撤销」 5s, then DELETE; failure puts it back where it was. */
export function deleteSubjectWithUndo(subject: Subject) {
  void queryClient.cancelQueries({ queryKey: SUBJECTS_KEY })
  let index = -1
  const d = undoable({
    apply: () => set(xs => { index = xs.findIndex(x => x.id === subject.id); return xs.filter(x => x.id !== subject.id) }),
    revert: () => set(xs => xs.some(x => x.id === subject.id) ? xs : [...xs.slice(0, Math.max(0, index)), subject, ...xs.slice(Math.max(0, index))]),
    commit: () => deleteSubject(subject.id),
    onError: e => fail(`「${subject.name}」删除失败，已恢复`, e),
  })
  toast({ title: `已删除「${subject.name}」`, description: '引用它的标签会显示「主体已删除」', duration: 5000, action: { label: '撤销', onClick: () => d.undo() } })
  return d
}

export async function duplicateSubject(subject: Subject) {
  const name = copyName(subject.name, get() ?? [])
  try {
    await createSubjectOptimistic({ name, kind: subject.kind, note: subject.note ?? '', assets: presentAssets(subject), cover_id: subject.cover?.id ?? null })
    toast({ title: `已复制为「${name}」`, tone: 'success' })
  } catch (e) { fail('复制失败', e) }
}
