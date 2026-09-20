// Batch submit (§2.3): per-item, idempotent, concurrency 3, two-phase anchors. Framework-free core + default wiring.
import { queryClient } from '@/shared/query'
import { GENERATION_SUBMIT_KEY, SubmitError, pool, submitGeneration, type PendingGeneration, type SubmitOutcome } from '../api/generation'
import type { QueueEntry } from '../api/queue'
import { applyToQueue, useComposer } from '../store'

export interface SenderDeps {
  submit: (p: PendingGeneration) => Promise<SubmitOutcome>
  apply: (item: QueueEntry, patch: 'remove' | Pick<QueueEntry, 'state' | 'error'>) => void
  newId?: () => string
}

const ANCHOR_FAILED = { code: 'anchor_failed', message: '锚图失败' }

export function createSender(deps: SenderDeps) {
  const newId = deps.newId ?? (() => crypto.randomUUID())
  /** anchor item_id → its dependents. */
  const waiting = new Map<string, { dependents: { item: QueueEntry; pending: PendingGeneration }[] }>()

  const cancelDependents = (anchorId: string) => {
    const w = waiting.get(anchorId)
    waiting.delete(anchorId)
    w?.dependents.forEach(d => deps.apply(d.item, { state: 'cancelled', error: ANCHOR_FAILED }))
  }

  const run = (list: { item: QueueEntry; pending: PendingGeneration }[]) => pool(list, 3, async ({ item, pending }) => {
    const r = await deps.submit(pending)
    if (r.status === 'accepted') {
      deps.apply(item, 'remove')
      return
    }
    deps.apply(item, { state: r.status === 'rejected' ? 'failed' : 'retryable', error: r.error })
    if (r.status === 'rejected') cancelDependents(item.item_id)
    else { // retryable anchor: dependents go back to plain queue items and are resent with the anchor next time
      waiting.get(item.item_id)?.dependents.forEach(d => deps.apply(d.item, { state: undefined, error: undefined }))
      waiting.delete(item.item_id)
    }
  })

  return {
    /** Phase 1: items without an in-batch anchor. Items with `anchor_of` wait for onAnchorSucceeded. */
    async sendBatch(items: QueueEntry[], ctx: { thread_id: string | null; parent_record_id?: string | null }) {
      // A regenerate of one record is a standalone request linked by parent_record_id, not a new batch (§2.5).
      const parent_record_id = ctx.parent_record_id ?? null
      const batch_id = parent_record_id ? null : newId()
      const ids = new Set(items.map(i => i.item_id))
      const list = items.map((item, i) => ({
        item,
        pending: {
          item_id: item.item_id, kind: item.kind, model: item.model, prompt: item.prompt, params: item.params,
          reference_asset_ids: item.reference_asset_ids, references: item.slots.map(s => s.asset),
          batch_id, batch_position: batch_id ? i : null, parent_record_id, thread_id: ctx.thread_id, anchor_record_id: null,
          anchor_of: item.anchor_of && ids.has(item.anchor_of) ? item.anchor_of : null,
          mentions: item.mentions, prompt_doc: item.prompt_doc,
        } satisfies PendingGeneration,
      }))
      for (const d of list) {
        if (!d.pending.anchor_of) continue
        const w = waiting.get(d.pending.anchor_of) ?? { dependents: [] }
        w.dependents.push(d)
        waiting.set(d.pending.anchor_of, w)
        deps.apply(d.item, { state: 'waiting', error: undefined })
      }
      await run(list.filter(d => !d.pending.anchor_of))
    },
    /** Phase 2 — called by the create view when the anchor generation succeeded and its result is archived. */
    /** `recordId` = the anchor's generation record (looked up by idempotency key; the submit response carries none). */
    async onAnchorSucceeded(itemId: string, resultAssetId: string, recordId: string) {
      const w = waiting.get(itemId)
      if (!w) return
      waiting.delete(itemId)
      await run(w.dependents.map(d => ({
        item: d.item,
        pending: { ...d.pending, reference_asset_ids: [resultAssetId, ...d.pending.reference_asset_ids], anchor_record_id: recordId },
      })))
    },
    /** Anchor generation failed later (after being accepted): dependents are cancelled, never charged. */
    onAnchorFailed: cancelDependents,
    waitingFor: (anchorId: string) => waiting.get(anchorId)?.dependents.map(d => d.item.item_id) ?? [],
  }
}

/** Each submit is a mutation under GENERATION_SUBMIT_KEY so F5 can render placeholders via useMutationState (see api/generation.ts). */
async function submitAsMutation(p: PendingGeneration): Promise<SubmitOutcome> {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: GENERATION_SUBMIT_KEY,
    mutationFn: async (v: PendingGeneration) => {
      const r = await submitGeneration(v)
      if (r.status !== 'accepted') throw new SubmitError(r)
      return r
    },
    retry: false,
  })
  try { return await mutation.execute(p) } catch (e) { return e instanceof SubmitError ? e.outcome : { status: 'retryable', error: { code: 'network_error', message: '网络异常，请重试' } } }
}

export const sender = createSender({ submit: submitAsMutation, apply: applyToQueue })
export const onAnchorSucceeded = sender.onAnchorSucceeded
export const onAnchorFailed = sender.onAnchorFailed

/** Retry one queued item (retryable or edited) as its own batch; idempotency key unchanged. */
export function retryItem(itemId: string) {
  const item = useComposer.getState().queue.find(i => i.item_id === itemId)
  if (item) return sender.sendBatch([{ ...item, state: undefined, error: undefined }], { thread_id: useComposer.getState().threadId })
}
