import { create } from 'zustand'
import { toast } from '@/ui'
import { CANVAS_ADD_EVENT, COMPOSER_FILL_EVENT, dispatchStudioEvent } from '@/shared/events'
import type { MediaAsset } from '@/media'
import { queryClient } from '@/shared/query'
import type { QueueEntry } from '../api/queue'
import { recordKeys, recordsApi } from '../api/records'
import { retryItem, sender } from '../composer/send'
import { useComposer } from '../store'
import type { ItemView } from './lib'

// Cross-view events: shapes live in src/shared/events.ts.
export type RecordFill = Pick<ItemView, 'record_id' | 'kind' | 'model' | 'prompt' | 'prompt_doc' | 'mentions' | 'params'> & { reference_assets: MediaAsset[] }

const toFill = (i: ItemView): RecordFill => ({
  record_id: i.record_id, kind: i.kind, model: i.model, prompt: i.prompt, prompt_doc: i.prompt_doc, mentions: i.mentions, params: i.params, reference_assets: i.references,
})

export function fillFromItem(i: ItemView) {
  dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'record', ...toFill(i), record_id: i.record_id ?? '' })
  toast({ title: '已填入输入框', tone: 'success' })
}
export function fillQueue(items: ItemView[]) {
  dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'batch', items: items.map(toFill) })
  toast({ title: `已回填队列 ${items.length} 项`, tone: 'success' })
}
export function referenceFrom(a: MediaAsset) {
  if (dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'asset', reference_assets: [a] })) toast({ title: '已加入参考图', tone: 'success' })
}
/** 放到画布 of a result: prompt text → generation node with the record's results (canvas asks which project and toasts). */
export function addToCanvas(i: ItemView, asset: MediaAsset) {
  if (i.record_id && i.results.length) dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'record', record_id: i.record_id, results: i.results, prompt: i.prompt, model: i.model, params: i.params })
  else dispatchStudioEvent(CANVAS_ADD_EVENT, { source: 'asset', assets: [asset] })
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast({ title: '已复制提示词', tone: 'success' }) }
  catch { toast({ title: '复制失败', description: '浏览器没有授予剪贴板权限', tone: 'error' }) }
}

/**
 * 再生成 / 重试 of an accepted record → a new request with the same body and a new idempotency key.
 * Goes through the composer sender as a standalone request carrying `parent_record_id`;
 * a rejected submit lands in the queue (red) so nothing is lost.
 */
export function regenerate(i: ItemView) {
  if (i.status === 'submit_failed' && i.item_id) { void retryItem(i.item_id); return }
  const entry: QueueEntry = {
    item_id: crypto.randomUUID(), kind: i.kind, model: i.model, prompt: i.prompt, params: i.params,
    reference_asset_ids: i.references.map(r => r.id), anchor_of: null, mentions: i.mentions, prompt_doc: i.prompt_doc,
    slots: i.references.map(asset => ({ asset, by: [], manual: true })),
  }
  void sender.sendBatch([entry], { thread_id: i.thread_id ?? useComposer.getState().threadId, parent_record_id: i.record_id ?? null })
  toast({ title: '已提交再生成' })
}

/* ---------- delete with undo (§6: hide now, 5s undo, then soft-delete on the server) ---------- */

export const useHidden = create<{ ids: Set<string> }>(() => ({ ids: new Set() }))
const setHidden = (key: string, on: boolean) => useHidden.setState(s => {
  const ids = new Set(s.ids)
  if (on) ids.add(key); else ids.delete(key)
  return { ids }
})

/** ponytail: the server call waits for the undo window, so closing the tab within 5s keeps the record; add an undelete endpoint if that matters. */
export function deleteWithUndo(label: string, key: string, commit: () => Promise<void>) {
  setHidden(key, true)
  let undone = false
  toast({ title: `已删除${label}`, duration: 5000, action: { label: '撤销', onClick: () => { undone = true; setHidden(key, false) } } })
  setTimeout(() => {
    if (undone) return
    commit()
      .then(() => queryClient.invalidateQueries({ queryKey: recordKeys.all }))
      .catch(() => { setHidden(key, false); toast({ title: '删除失败，已恢复', tone: 'error' }) })
  }, 5000)
}

export const deleteItem = (i: ItemView) => i.record_id && deleteWithUndo('这条结果', i.record_id, () => recordsApi.remove(i.record_id!))
export const deleteBatch = (batchId: string) => deleteWithUndo('整批结果', `batch:${batchId}`, () => recordsApi.removeBatch(batchId))

/* ---------- 选最佳 (local only) ---------- */
export const useStars = create<{ ids: Set<string>; toggle: (id: string) => void }>(set => ({
  ids: new Set(),
  toggle: id => set(s => { const ids = new Set(s.ids); if (ids.has(id)) ids.delete(id); else ids.add(id); return { ids } }),
}))
