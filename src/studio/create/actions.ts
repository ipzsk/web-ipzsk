import { create } from 'zustand'
import { toast } from '@/ui'
import type { MediaAsset } from '@/media'
import { queryClient } from '@/shared/query'
import type { QueueEntry } from '../api/queue'
import { recordKeys, recordsApi } from '../api/records'
import { retryItem, sender } from '../composer/send'
import { useComposer } from '../store'
import type { ItemView } from './lib'

/*
 * Cross-view events (window CustomEvent; receivers never import this view).
 *
 * `ipzsk:composer-fill`
 *   { source: 'record', record_id, kind, model, prompt, prompt_doc, mentions, params, reference_assets: MediaAsset[] }
 *     → 编辑后重发 (single item): replace the composer draft with this request; never submits.
 *   { source: 'batch', items: RecordFill[] (same shape as above, without `source`) }
 *     → 批次编辑后重发: replace the queue with these items (the create view already confirmed overwriting a non-empty queue).
 *   { source: 'asset', reference_assets: MediaAsset[] }   (shape shared with the assets view)
 *     → 以此为参考: append to reference slots.
 * `ipzsk:canvas-add` { assets: MediaAsset[] } → 放到画布 (shape shared with the assets view).
 */
export type RecordFill = Pick<ItemView, 'record_id' | 'kind' | 'model' | 'prompt' | 'prompt_doc' | 'mentions' | 'params'> & { reference_assets: MediaAsset[] }

const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }))
const toFill = (i: ItemView): RecordFill => ({
  record_id: i.record_id, kind: i.kind, model: i.model, prompt: i.prompt, prompt_doc: i.prompt_doc, mentions: i.mentions, params: i.params, reference_assets: i.references,
})

export function fillFromItem(i: ItemView) {
  emit('ipzsk:composer-fill', { source: 'record', ...toFill(i) })
  toast({ title: '已填入输入框', tone: 'success' })
}
export function fillQueue(items: ItemView[]) {
  emit('ipzsk:composer-fill', { source: 'batch', items: items.map(toFill) })
  toast({ title: `已回填队列 ${items.length} 项`, tone: 'success' })
}
export function referenceFrom(a: MediaAsset) {
  emit('ipzsk:composer-fill', { source: 'asset', reference_assets: [a] })
  toast({ title: '已加入参考图', tone: 'success' })
}
export function addToCanvas(assets: MediaAsset[]) {
  emit('ipzsk:canvas-add', { assets })
  toast({ title: '已放到画布', tone: 'success' })
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast({ title: '已复制提示词', tone: 'success' }) }
  catch { toast({ title: '复制失败', description: '浏览器没有授予剪贴板权限', tone: 'error' }) }
}

/**
 * 再生成 / 重试 of an accepted record → a new request with the same body and a new idempotency key.
 * ponytail: goes through the composer sender as a 1-item batch, so `parent_record_id` isn't sent until
 * api/generation.ts forwards it; a rejected submit lands in the queue (red) so nothing is lost.
 */
export function regenerate(i: ItemView) {
  if (i.status === 'submit_failed' && i.item_id) { void retryItem(i.item_id); return }
  const entry: QueueEntry = {
    item_id: crypto.randomUUID(), kind: i.kind, model: i.model, prompt: i.prompt, params: i.params,
    reference_asset_ids: i.references.map(r => r.id), anchor_of: null, mentions: i.mentions, prompt_doc: i.prompt_doc,
    slots: i.references.map(asset => ({ asset, by: [], manual: true })),
  }
  void sender.sendBatch([entry], { thread_id: i.thread_id ?? useComposer.getState().threadId })
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
