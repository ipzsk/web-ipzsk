// §2.8 user templates: optimistic cache writes (§6) + apply → queue.
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { findCachedUrls, type MediaAsset } from '@/media'
import { queryClient } from '@/shared/query'
import { toast } from '@/ui'
import { fetchModels } from '../api/catalog'
import { QUEUE_MAX } from '../api/queue'
import {
  createTemplate, deleteTemplate, listTemplates, templateCovers, templateErrorMessage, updateTemplate, type UserTemplate, type UserTemplateCreate, type UserTemplatePatch,
} from '../api/templates'
import { planFill } from '../composer/fill'
import { useComposer } from '../store'
import { undoable } from '../subjects/logic'
import { copyTemplateName, fillDoc, fillText, ownedIdsOf, slotsOf, type TemplateSource } from './logic'

export const TEMPLATES_KEY = ['templates'] as const
export const useTemplates = (enabled = true) => useQuery({ queryKey: TEMPLATES_KEY, queryFn: listTemplates, enabled, staleTime: 60_000 })

const get = () => queryClient.getQueryData<UserTemplate[]>(TEMPLATES_KEY) ?? []
const set = (fn: (xs: UserTemplate[]) => UserTemplate[]) => queryClient.setQueryData<UserTemplate[]>(TEMPLATES_KEY, xs => fn(xs ?? []))
const fail = (title: string, e: unknown) => toast({ title, description: templateErrorMessage(e), tone: 'error' })

/** Optimistic: temp card now, server copy on success; rollback + rethrow (the dialog shows the reason). */
export async function createTemplateOptimistic(body: UserTemplateCreate, cover?: MediaAsset | null): Promise<UserTemplate> {
  await queryClient.cancelQueries({ queryKey: TEMPLATES_KEY })
  if (cover) templateCovers.put(cover)
  const tempId = `temp-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  set(xs => [{ id: tempId, name: body.name, cover_id: body.cover_id ?? null, items: body.items, variables: body.variables ?? [], created_at: now, updated_at: now }, ...xs])
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
  if (cover) templateCovers.put(cover)
  set(xs => xs.map(x => x.id === t.id ? { ...x, ...patch } as UserTemplate : x))
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
    await createTemplateOptimistic({ name, cover_id: t.cover_id, items: t.items, variables: t.variables })
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

/** Owned reference → a displayable asset (cached urls when we have them; otherwise a placeholder that still sends its id). */
const ownedAsset = (id: string): MediaAsset => ({ id, kind: 'image', status: 'ready', width: null, height: null, duration_ms: null, urls: findCachedUrls(id) ?? { orig: '' } })

/**
 * Expand into queue items (appended). Variables are already resolved; items with `{slot}` placeholders are marked red with
 * 「需要放入参考图…」 so they can't be sent until edited. Returns an error string instead of changing anything when there's no room.
 */
export async function applyTemplate(t: UserTemplate, values: Record<string, string>): Promise<string | null> {
  const s = useComposer.getState()
  if (s.queue.length + t.items.length > QUEUE_MAX) return `队列最多 ${QUEUE_MAX} 项，当前已有 ${s.queue.length} 项，放不下这个模板的 ${t.items.length} 项`
  const models = await queryClient.fetchQuery({ queryKey: ['media', 'models'], queryFn: fetchModels, staleTime: 10 * 60_000 }).catch(() => [])
  const plan = planFill({
    source: 'batch',
    items: t.items.map(i => ({
      item_id: i.item_id, anchor_of: i.anchor_of ?? null, kind: i.kind, model: i.model, params: i.params as never, mentions: i.mentions ?? [],
      prompt: fillText(i.prompt, values), prompt_doc: fillDoc(i.prompt_doc as never, values), reference_assets: ownedIdsOf(i).map(ownedAsset),
    })),
  }, { models, kind: s.kind, memory: s.memory, slots: s.slots, queue: s.queue })
  const items = (plan.queue ?? []).map((q, i) => {
    const slots = slotsOf(t.items[i]!)
    return slots.length ? { ...q, state: 'failed' as const, error: { code: 'template_slot', message: `需要放入参考图：${slots.map(n => `图${n + 1}`).join('、')}（编辑此项添加后「更新」）` } } : q
  })
  useComposer.setState(st => ({ queue: [...st.queue, ...items] }))
  const need = items.filter(i => i.state === 'failed').length
  toast({ title: `已加入队列 ${items.length} 项`, description: [need && `${need} 项需要放入参考图`, ...plan.notices].filter(Boolean).join('；') || undefined, tone: 'success' })
  return null
}

/* ---------- dialogs opened from anywhere (queue bar, result bubble, cards) ---------- */

export interface SaveRequest { sources: TemplateSource[]; covers: MediaAsset[]; origin: 'queue' | 'batch' }
export const useTemplateDialogs = create<{ save: SaveRequest | null; apply: UserTemplate | null }>(() => ({ save: null, apply: null }))
export const openSaveTemplate = (req: SaveRequest) => useTemplateDialogs.setState({ save: req })
export const openApplyTemplate = (t: UserTemplate) => useTemplateDialogs.setState({ apply: t })
