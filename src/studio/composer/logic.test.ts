import { describe, expect, it } from 'vitest'
import { hashKey } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import type { MediaAsset } from '@/media'
import { MOCK_MODELS } from '../api/catalog'
import type { QueueEntry, RefSlot } from '../api/queue'
import { classify, type SubmitOutcome } from '../api/generation'
import { ApiError } from '@/shared/api'
import {
  addFromChip, addManual, diffItem, expandModels, itemFromDraft, normalizeParams, planSend, pruneChips,
  quoteEntry, referenceState, sentReferenceIds, serializePrompt, type Draft,
} from './logic'
import { quoteQueryKey } from './hooks'
import { createSender } from './send'

const [gpt, flare, turbo, seedance] = MOCK_MODELS as [typeof MOCK_MODELS[0], typeof MOCK_MODELS[0], typeof MOCK_MODELS[0], typeof MOCK_MODELS[0]]
const asset = (id: string): MediaAsset => ({ id, kind: 'image', status: 'ready', width: 1, height: 1, duration_ms: null, urls: { orig: id } })
const text = (t: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const draft = (over: Partial<Draft> = {}): Draft => ({ kind: 'image', model: gpt, params: { aspect_ratio: '16:9', resolution: '2K', n: 2 }, doc: text('橘猫'), slots: [], ...over })

describe('params', () => {
  it('multi-model expansion normalises per model and records changes', () => {
    const [a, b] = expandModels(draft(), [gpt, turbo])
    expect(a!.model).toBe('gpt-image-2')
    expect(a!.changes).toEqual([])
    expect(b!.params).toEqual({ aspect_ratio: '16:9', resolution: '1K', n: 2 })
    expect(b!.changes).toEqual([{ name: 'resolution', from: '2K', to: '1K' }])
    expect(a!.item_id).not.toBe(b!.item_id)
    expect(a!.prompt).toBe(b!.prompt)
  })
  it('out-of-range resets to model default; values are case-sensitive; undeclared params dropped', () => {
    expect(normalizeParams(flare, { resolution: '2k', aspect_ratio: '5:4' })).toEqual({
      params: { aspect_ratio: '5:4', resolution: '1K', n: 1 }, changes: [{ name: 'resolution', from: '2k', to: '1K' }],
    })
    const v = normalizeParams(seedance, { aspect_ratio: '3:2', n: 3, duration: 7 })
    expect(v.params).toEqual({ aspect_ratio: '16:9', resolution: '720p', duration: 5 })
    expect(v.changes.map(c => c.name)).toEqual(['aspect_ratio', 'duration'])
    expect(normalizeParams(gpt, { n: 9 }).params.n).toBe(1)
  })
})

describe('references', () => {
  it('cap and unsupported models', () => {
    expect(referenceState(gpt, 17)).toMatchObject({ over: true, message: 'GPT Image 2 最多 15 张参考图，当前 17 张' })
    expect(referenceState(gpt, 15).over).toBe(false)
    expect(referenceState(turbo, 2)).toMatchObject({ supported: false, over: false, message: '当前型号不使用参考图' })
    const slots = addManual([], [asset('a')])
    expect(sentReferenceIds(turbo, slots)).toEqual([])
    expect(sentReferenceIds(gpt, slots)).toEqual(['a'])
  })

  it('chip bookkeeping: dedupe, shared, manual and 图N keep images', () => {
    let s: RefSlot[] = addManual([], [asset('m')])
    s = addFromChip(s, 'c1', [asset('x'), asset('shared'), asset('m')])
    s = addFromChip(s, 'c2', [asset('shared'), asset('y')])
    expect(s.map(x => x.asset.id)).toEqual(['m', 'x', 'shared', 'y'])
    // remove chip c1
    let p = pruneChips(s, new Set(['c2']), new Set())
    expect(p.map(x => x.asset.id)).toEqual(['m', 'shared', 'y'])
    // remove c2 too, but a 图N chip still points at y
    p = pruneChips(p, new Set(), new Set(['y']))
    expect(p.map(x => x.asset.id)).toEqual(['m', 'y'])
    // no change → same array (no store churn)
    expect(pruneChips(p, new Set(), new Set(['y']))).toBe(p)
  })
})

it('mention serialization', () => {
  const slots = addManual([], [asset('a1'), asset('a2')])
  const doc: JSONContent = { type: 'doc', content: [
    { type: 'paragraph', content: [
      { type: 'mention', attrs: { id: 'sub-1', label: '橘猫阿福', kind: 'subject', uid: 'u1' } },
      { type: 'text', text: ' 坐在 ' },
      { type: 'mention', attrs: { id: 'a2', label: '图', kind: 'reference', uid: 'u2' } },
      { type: 'text', text: ' 的沙发上' },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: '第二行' }, { type: 'hardBreak' }, { type: 'mention', attrs: { id: 'sub-1', label: '橘猫阿福', kind: 'subject', uid: 'u3' } }] },
  ] }
  expect(serializePrompt(doc, slots)).toEqual({
    prompt: '@橘猫阿福 坐在 图2 的沙发上\n第二行\n@橘猫阿福',
    mentions: [{ type: 'subject', id: 'sub-1', name: '橘猫阿福' }, { type: 'reference', id: 'a2', name: '图2' }],
  })
})

it('queue diff highlights only what differs', () => {
  const cur = itemFromDraft(draft())
  const d = diffItem({ ...itemFromDraft(draft({ params: { aspect_ratio: '1:1', resolution: '2K', n: 2 } })) }, cur)
  expect([...d.params]).toEqual(['aspect_ratio'])
  expect(d.prompt || d.model || d.references).toBe(false)
  expect(diffItem(itemFromDraft(draft({ doc: text('狗') })), cur).prompt).toBe(true)
})

describe('send semantics', () => {
  const composer = itemFromDraft(draft())
  const q = (id: string, extra: Partial<QueueEntry> = {}) => ({ ...itemFromDraft(draft(), id), ...extra })
  it('empty queue → composer only (nothing when prompt empty)', () => {
    expect(planSend([], composer)).toEqual([composer])
    expect(planSend([], itemFromDraft(draft({ doc: null })))).toEqual([])
  })
  it('non-empty queue → queue + composer if it has a prompt; red items skipped', () => {
    const queue = [q('1'), q('2', { state: 'failed' }), q('3', { state: 'retryable' })]
    expect(planSend(queue, composer).map(i => i.item_id)).toEqual(['1', '3', composer.item_id])
    expect(planSend(queue, itemFromDraft(draft({ doc: text('  ') }))).map(i => i.item_id)).toEqual(['1', '3'])
  })
})

it('classifies HTTP outcomes', () => {
  expect(classify(new ApiError('', { status: 409, code: 'idempotency_conflict' })).status).toBe('accepted')
  expect(classify(new ApiError('', { status: 400, code: 'unsupported_param' })).status).toBe('rejected')
  expect(classify(new ApiError('', { status: 402, code: 'insufficient_balance' })).status).toBe('rejected')
  expect(classify(new ApiError('', { status: 503, code: 'x' })).status).toBe('retryable')
  expect(classify(new ApiError('', { status: 429, code: 'too_many_active' })).status).toBe('retryable')
  expect(classify(new TypeError('fetch')).status).toBe('retryable')
})

describe('sender', () => {
  const setup = (outcome: (id: string) => SubmitOutcome) => {
    let queue: QueueEntry[] = []
    const calls: { item_id: string; reference_asset_ids: string[]; anchor_record_id: string | null; batch_position: number }[] = []
    let inFlight = 0, maxInFlight = 0
    const sender = createSender({
      submit: async p => {
        calls.push(p); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(r => setTimeout(r, 5)); inFlight--
        return outcome(p.item_id)
      },
      apply: (item, patch) => {
        if (patch === 'remove') queue = queue.filter(i => i.item_id !== item.item_id)
        else queue = queue.some(i => i.item_id === item.item_id) ? queue.map(i => i.item_id === item.item_id ? { ...i, ...patch } : i) : [...queue, { ...item, ...patch }]
      },
      newId: () => 'batch-1',
    })
    const item = (id: string, extra: Partial<QueueEntry> = {}) => ({ ...itemFromDraft(draft(), id), ...extra })
    return { sender, item, calls, get queue() { return queue }, set queue(v) { queue = v }, get maxInFlight() { return maxInFlight } }
  }

  it('per-item outcomes → queue state, concurrency ≤ 3', async () => {
    const t = setup(id => id === 'bad' ? { status: 'rejected', error: { code: 'unsupported_param', message: '不支持' } }
      : id === 'net' ? { status: 'retryable', error: { code: 'network_error', message: '网络' } } : { status: 'accepted', record_id: 'r-' + id })
    t.queue = ['a', 'bad', 'net', 'b', 'c'].map(id => t.item(id))
    await t.sender.sendBatch(t.queue, { thread_id: null })
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['bad', 'failed'], ['net', 'retryable']])
    expect(t.queue[0]!.error?.message).toBe('不支持')
    expect(t.calls.map(c => c.batch_position)).toEqual([1, 2, 3, 4, 5])
    expect(t.maxInFlight).toBeLessThanOrEqual(3)
  })

  it('failed composer item is appended so the draft is not lost', async () => {
    const t = setup(() => ({ status: 'rejected', error: { code: 'x', message: 'x' } }))
    await t.sender.sendBatch([t.item('draft')], { thread_id: 't' })
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['draft', 'failed']])
  })

  it('anchor two-phase', async () => {
    const t = setup(id => ({ status: 'accepted', record_id: 'rec-' + id }))
    t.queue = [t.item('A'), t.item('B', { anchor_of: 'A', reference_asset_ids: ['own'] }), t.item('C', { anchor_of: 'A' })]
    await t.sender.sendBatch(t.queue, { thread_id: null })
    expect(t.calls.map(c => c.item_id)).toEqual(['A'])
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['B', 'waiting'], ['C', 'waiting']])
    await t.sender.onAnchorSucceeded('A', 'asset-A')
    expect(t.calls.slice(1)).toMatchObject([
      { item_id: 'B', reference_asset_ids: ['asset-A', 'own'], anchor_record_id: 'rec-A', batch_position: 2 },
      { item_id: 'C', reference_asset_ids: ['asset-A'], anchor_record_id: 'rec-A', batch_position: 3 },
    ])
    expect(t.queue).toEqual([])
    await t.sender.onAnchorSucceeded('A', 'asset-A') // idempotent
    expect(t.calls).toHaveLength(3)
  })

  it('anchor rejected at submit, or failing later, cancels dependents without submitting them', async () => {
    const t = setup(id => id === 'A' ? { status: 'rejected', error: { code: 'x', message: 'x' } } : { status: 'accepted' })
    t.queue = [t.item('A'), t.item('B', { anchor_of: 'A' })]
    await t.sender.sendBatch(t.queue, { thread_id: null })
    expect(t.queue.map(i => [i.item_id, i.state, i.error?.message])).toEqual([['A', 'failed', 'x'], ['B', 'cancelled', '锚图失败']])
    expect(t.calls).toHaveLength(1)

    const u = setup(() => ({ status: 'accepted' }))
    u.queue = [u.item('A'), u.item('B', { anchor_of: 'A' })]
    await u.sender.sendBatch(u.queue, { thread_id: null })
    u.sender.onAnchorFailed('A')
    await u.sender.onAnchorSucceeded('A', 'late')
    expect(u.queue.map(i => [i.item_id, i.state])).toEqual([['B', 'cancelled']])
    expect(u.calls).toHaveLength(1)
  })
})

it('quote cache key is stable across param insertion order', () => {
  const a = quoteEntry({ kind: 'image', model: 'gpt-image-2', params: { resolution: '2K', aspect_ratio: '1:1' }, reference_asset_ids: ['x'] })
  const b = quoteEntry({ reference_asset_ids: ['y'], params: { aspect_ratio: '1:1', resolution: '2K' }, model: 'gpt-image-2', kind: 'image' })
  expect(hashKey(quoteQueryKey([a]))).toBe(hashKey(quoteQueryKey([b])))
  expect(hashKey(quoteQueryKey([a]))).not.toBe(hashKey(quoteQueryKey([{ ...a, params: { ...a.params, resolution: '4K' } }])))
})
