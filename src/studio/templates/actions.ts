// §2.8 user templates: optimistic cache writes (§6) + apply → queue.
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import { create } from 'zustand'
import type { MediaAsset } from '@/media'
import type { Page } from '@/shared/contracts'
import { queryClient } from '@/shared/query'
import { toast } from '@/ui'
import { fetchModels } from '../api/catalog'
import { QUEUE_MAX } from '../api/queue'
import {
  createTemplate, deleteTemplate, listTemplates, templateErrorMessage, updateTemplate, type UserTemplate, type UserTemplateCreate, type UserTemplatePatch,
} from '../api/templates'
import { planFill } from '../composer/fill'
import { useComposer } from '../store'
import { undoable } from '../subjects/logic'
import { isMissingAsset, toServerAsset } from '../api/subjects'
import { avatarQueueEntry, copyTemplateName, fillDoc, fillText, isAvatarTemplateItem, ownedIdsOf, slotsOf, type TemplateSource } from './logic'

export const TEMPLATES_KEY = ['templates'] as const
/** All loaded pages, flattened; 「加载更多」 follows next_cursor. */
export const useTemplates = (enabled = true) => useInfiniteQuery({
  queryKey: TEMPLATES_KEY, queryFn: ({ pageParam }) => listTemplates(pageParam), initialPageParam: null as string | null,
  getNextPageParam: last => last.next_cursor, select: d => d.pages.flatMap(p => p.items), enabled, staleTime: 60_000,
})

type Pages = InfiniteData<Page<UserTemplate>, string | null>
const get = () => queryClient.getQueryData<Pages>(TEMPLATES_KEY)?.pages.flatMap(p => p.items) ?? []
/** Edit the flattened list and cut it back into the loaded pages (the last page absorbs the difference), same as subjects/actions.ts. */
const set = (fn: (xs: UserTemplate[]) => UserTemplate[]) => queryClient.setQueryData<Pages>(TEMPLATES_KEY, d => {
  if (!d) return d
  const next = fn(d.pages.flatMap(p => p.items))
  let at = 0
  return { ...d, pages: d.pages.map((p, i) => { const n = i === d.pages.length - 1 ? next.length - at : p.items.length; const items = next.slice(at, at + n); at += n; return { ...p, items } }) }
})
const fail = (title: string, e: unknown) => toast({ title, description: templateErrorMessage(e), tone: 'error' })

/** Optimistic: temp card now, server copy on success; rollback + rethrow (the dialog shows the reason). */
export async function createTemplateOptimistic(body: UserTemplateCreate, cover?: MediaAsset | null): Promise<UserTemplate> {
  await queryClient.cancelQueries({ queryKey: TEMPLATES_KEY })
  const tempId = `temp-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  set(xs => [{
    id: tempId, name: body.name, cover_id: body.cover_id ?? null, cover: cover ? toServerAsset(cover) : null, items: body.items, variables: body.variables ?? [],
    reference_assets: {}, created_at: now, updated_at: now,
  }, ...xs])
  try {
    const t = await createTemplate(body)
    set(xs => xs.map(x => x.id === tempId ? t : x))
    return t
  } catch (e) {
    set(xs => xs.filter(x => x.id !== tempId))
    throw e
  }
}

/** Rename / cover: optimistic patch, rollback + toast. */
export async function patchTemplate(t: UserTemplate, patch: UserTemplatePatch, cover?: MediaAsset) {
  await queryClient.cancelQueries({ queryKey: TEMPLATES_KEY })
  set(xs => xs.map(x => x.id === t.id ? { ...x, ...patch, ...(cover && { cover: toServerAsset(cover) }) } as UserTemplate : x))
  try {
    const next = await updateTemplate(t.id, patch)
    set(xs => xs.map(x => x.id === t.id ? next : x))
    return true
  } catch (e) {
    set(xs => xs.map(x => x.id === t.id ? t : x))
    fail('修改未保存，已恢复', e)
    return false
  }
}

export async function duplicateTemplate(t: UserTemplate) {
  const name = copyTemplateName(t.name, get().map(x => x.name))
  try {
    await createTemplateOptimistic({ name, cover_id: t.cover_id, items: t.items, variables: t.variables }, t.cover && !isMissingAsset(t.cover) ? t.cover : null)
    toast({ title: `已复制为「${name}」`, tone: 'success' })
  } catch (e) { fail('复制失败', e) }
}

/** Vanish now, 5s 撤销, then DELETE; failure puts it back where it was. */
export function deleteTemplateWithUndo(t: UserTemplate) {
  void queryClient.cancelQueries({ queryKey: TEMPLATES_KEY })
  let index = -1
  const d = undoable({
    apply: () => set(xs => { index = xs.findIndex(x => x.id === t.id); return xs.filter(x => x.id !== t.id) }),
    revert: () => set(xs => xs.some(x => x.id === t.id) ? xs : [...xs.slice(0, Math.max(0, index)), t, ...xs.slice(Math.max(0, index))]),
    commit: () => deleteTemplate(t.id),
    onError: e => fail(`「${t.name}」删除失败，已恢复`, e),
  })
  toast({ title: `已删除模板「${t.name}」`, duration: 5000, action: { label: '撤销', onClick: () => d.undo() } })
}

/**
 * Expand into queue items (appended). Variables are already resolved; `filled` = avatar slot key (`photo_asset_id:0`) → asset.
 * Items with unfilled `{slot}` placeholders are marked red so they can't be sent until edited; owned references come with the
 * server-resolved `reference_assets` thumbnails (deleted ones mark the item missing). Returns an error string instead of changing
 * anything when there's no room.
 */
export async function applyTemplate(t: UserTemplate, values: Record<string, string>, filled: Record<string, MediaAsset> = {}): Promise<string | null> {
  const s = useComposer.getState()
  if (s.queue.length + t.items.length > QUEUE_MAX) return `队列最多 ${QUEUE_MAX} 项，当前已有 ${s.queue.length} 项，放不下这个模板的 ${t.items.length} 项`
  const models = await queryClient.fetchQuery({ queryKey: ['media', 'models'], queryFn: fetchModels, staleTime: 10 * 60_000 }).catch(() => [])
  const plain = t.items.filter(i => !isAvatarTemplateItem(i))
  const refOf = (id: string): MediaAsset => {
    const a = t.reference_assets[id]
    return a && !isMissingAsset(a) ? a : { id, kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: { orig: '' } }
  }
  const plan = planFill({
    source: 'batch',
    items: plain.map(i => ({
      item_id: i.item_id, anchor_of: i.anchor_of ?? null, kind: i.kind, model: i.model, params: i.params as never, mentions: i.mentions ?? [],
      prompt: fillText(i.prompt, values), prompt_doc: fillDoc(i.prompt_doc as never, values), reference_assets: ownedIdsOf(i).map(refOf),
    })),
  }, { models, kind: s.kind, memory: s.memory, slots: s.slots, queue: s.queue })
  const planned = plan.queue ?? []
  const ids = Object.fromEntries(Object.entries(filled).map(([k, a]) => [k, a.id]))
  const items = t.items.map(it => {
    if (isAvatarTemplateItem(it)) return avatarQueueEntry(it, ids, values, crypto.randomUUID())
    const q = planned[plain.indexOf(it)]!
    const slots = slotsOf(it)
    if (slots.length) return { ...q, state: 'failed' as const, error: { code: 'template_slot', message: `需要放入参考图：${slots.map(n => `图${n + 1}`).join('、')}（编辑此项添加后「更新」）` } }
    return ownedIdsOf(it).some(id => isMissingAsset(t.reference_assets[id])) ? { ...q, missing: true } : q
  })
  useComposer.setState(st => ({ queue: [...st.queue, ...items] }))
  const need = items.filter(i => i.state === 'failed' || i.missing).length
  toast({ title: `已加入队列 ${items.length} 项`, description: [need && `${need} 项需要补上素材后才能发送`, ...plan.notices].filter(Boolean).join('；') || undefined, tone: 'success' })
  return null
}

/* ---------- dialogs opened from anywhere (queue bar, result bubble, cards) ---------- */

export interface SaveRequest { sources: TemplateSource[]; covers: MediaAsset[]; origin: 'queue' | 'batch' }
export const useTemplateDialogs = create<{ save: SaveRequest | null; apply: UserTemplate | null }>(() => ({ save: null, apply: null }))
export const openSaveTemplate = (req: SaveRequest) => useTemplateDialogs.setState({ save: req })
export const openApplyTemplate = (t: UserTemplate) => useTemplateDialogs.setState({ apply: t })
