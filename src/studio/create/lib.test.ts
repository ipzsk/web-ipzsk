import { describe, expect, it } from 'vitest'
import type { GenerationRecord } from '../api/records'
import type { PendingGeneration } from '../api/generation'
import { anchorCalls, chargeLabel, chargeText, differingParams, failureText, groupItems, mergeItems, newResultsAction, sharedPrompt, streamSignature, type PendingState } from './lib'

const rec = (p: Partial<GenerationRecord> & { id: string }): GenerationRecord => ({
  thread_id: 't', batch_id: null, batch_position: null, anchor_record_id: null, parent_record_id: null, idempotency_key: null,
  kind: 'image', model: 'gpt-image-2', prompt: 'cat', prompt_doc: null, mentions: [], params: { aspect_ratio: '1:1' }, source: 'studio',
  status: 'succeeded', failure_code: null, charged_points: '6', request_id: null, task_id: null, references: [], results: [], created_at: '2026-09-17T10:00:00Z', updated_at: '2026-09-17T10:00:00Z', ...p,
})
const pending = (item_id: string, p: Partial<PendingGeneration> = {}, s: Partial<PendingState> = {}): PendingState => ({
  status: 'pending', submittedAt: Date.parse('2026-09-17T11:00:00Z'),
  item: { item_id, kind: 'image', model: 'gpt-image-2', prompt: 'cat', params: {}, reference_asset_ids: [], references: [], batch_id: 'b2', batch_position: 1, parent_record_id: null, thread_id: 't', anchor_record_id: null, anchor_of: null, mentions: [], prompt_doc: null, ...p },
  ...s,
})

describe('grouping', () => {
  it('groups by batch, orders items by position and groups by time; null batch stands alone', () => {
    const g = groupItems(mergeItems([
      rec({ id: 'c', batch_id: 'b1', batch_position: 3, created_at: '2026-09-17T09:00:02Z' }),
      rec({ id: 'x', created_at: '2026-09-17T09:30:00Z' }),
      rec({ id: 'a', batch_id: 'b1', batch_position: 1, created_at: '2026-09-17T09:00:00Z' }),
      rec({ id: 'b', batch_id: 'b1', batch_position: 2, anchor_record_id: 'a', created_at: '2026-09-17T09:00:01Z' }),
      rec({ id: 'y', created_at: '2026-09-17T08:00:00Z' }),
    ], []))
    expect(g.map(x => x.items.map(i => i.key).join())).toEqual(['y', 'a,b,c', 'x'])
    expect(g[1]!.items[0]!.anchor).toBe(true)
  })
})

describe('request bubble', () => {
  const items = groupItems(mergeItems([
    rec({ id: 'a', batch_id: 'b', batch_position: 1, params: { aspect_ratio: '1:1', resolution: '2K' } }),
    rec({ id: 'b', batch_id: 'b', batch_position: 2, params: { aspect_ratio: '16:9', resolution: '2K' } }),
  ], []))[0]!.items
  it('collapses identical prompts', () => {
    expect(sharedPrompt(items)).toBe('cat')
    expect(sharedPrompt([items[0]!, { ...items[1]!, prompt: 'dog' }])).toBeNull()
  })
  it('highlights only differing params / model', () => {
    expect([...differingParams(items)]).toEqual(['aspect_ratio'])
    expect(differingParams([items[0]!, { ...items[1]!, model: 'z' }]).has('model')).toBe(true)
    expect(differingParams([items[0]!]).size).toBe(0)
  })
})

describe('optimistic reconciliation', () => {
  it('shows placeholders, keeps accepted-unlisted as queued, drops them once the record is listed', () => {
    const p = [pending('i1'), pending('i2', { batch_position: 2 }, { status: 'success', result: { status: 'accepted' } }), pending('i3', {}, { status: 'error', error: { outcome: { status: 'rejected', error: { code: 'x', message: '不支持' } } } })]
    const before = mergeItems([], p)
    expect(before.map(i => i.status)).toEqual(['submitting', 'queued', 'submit_failed'])
    expect(before[2]!.failure).toBe('不支持')
    const after = mergeItems([rec({ id: 'r2', idempotency_key: 'q:i2', status: 'running' }), rec({ id: 'r1', idempotency_key: 'q:i1', status: 'queued' })], p)
    expect(after.map(i => i.key).sort()).toEqual(['p:i3', 'r1', 'r2'])
  })
  it('latest mutation per item wins (retries do not duplicate)', () => {
    const out = mergeItems([], [pending('i1', {}, { status: 'error' }), pending('i1')])
    expect(out).toHaveLength(1)
    expect(out[0]!.status).toBe('submitting')
  })
})

describe('anchors', () => {
  it('fires once per anchor, waits for an archived result', () => {
    const watched = new Map([['r1', 'item1'], ['r2', 'item2']])
    expect(anchorCalls([rec({ id: 'r1', status: 'running' })], watched)).toEqual([])
    expect(anchorCalls([rec({ id: 'r1', status: 'succeeded', results: [] })], watched)).toEqual([])
    const done = [rec({ id: 'r1', results: [{ id: 'gone', status: 'deleted', missing: true }, { id: 'asset1', kind: 'image', source: 'generation', status: 'ready', width: 1, height: 1, duration_ms: null, thumb_state: 'done', created_at: '', urls: { orig: '' } }] }), rec({ id: 'r2', status: 'failed' })]
    expect(anchorCalls(done, watched)).toEqual([{ itemId: 'item1', recordId: 'r1', assetId: 'asset1' }, { itemId: 'item2', recordId: 'r2', assetId: null }])
    expect(anchorCalls(done, watched)).toEqual([])
  })
})

describe('charges', () => {
  it('结算中 until every success is settled; failures count as 0', () => {
    expect(chargeLabel([{ status: 'running', charged_points: null }])).toBeNull()
    expect(chargeLabel([{ status: 'succeeded', charged_points: null }, { status: 'succeeded', charged_points: '6' }])).toBe('结算中')
    expect(chargeLabel([{ status: 'succeeded', charged_points: '6' }, { status: 'failed', charged_points: '0' }, { status: 'succeeded', charged_points: '1.5' }])).toBe('消耗 ¥0.08')
  })
  it('a failure whose hold is under review is never shown as 未扣费 nor summed as 0', () => {
    expect(chargeText({ status: 'failed', charged_points: null })).toBe('扣费待核对')
    expect(chargeText({ status: 'cancelled', charged_points: null })).toBe('扣费待核对')
    expect(chargeText({ status: 'cancelled', charged_points: '6' })).toBe('消耗 ¥0.06')
    expect(chargeText({ status: 'failed', charged_points: '0' })).toBe('未扣费')
    expect(chargeText({ status: 'succeeded', charged_points: null })).toBe('结算中')
    expect(chargeText({ status: 'submit_failed', charged_points: null, submit_code: 'insufficient_balance' })).toBe('未扣费')
    expect(chargeText({ status: 'submit_failed', charged_points: null, submit_code: 'network_error' })).toBe('扣费以记录为准')
    expect(chargeLabel([{ status: 'succeeded', charged_points: '6' }, { status: 'failed', charged_points: null }])).toBe('扣费待核对')
  })
})

describe('failure texts', () => {
  it('maps gateway task and upstream codes to readable Chinese', () => {
    expect(failureText('upstream_result_uncertain')).toMatch(/待核对/)
    expect(failureText('upstream_http_500')).toMatch(/待核对/)
    expect(failureText('upstream_http_400')).toMatch(/修改后重试/)
    expect(failureText('upstream_http_429')).toMatch(/稍后重试/)
    expect(failureText('image_result_missing')).toBe('任务结束但没有返回图片')
    expect(failureText('media_task_failed')).toBe('生成失败（上游任务失败）')
    expect(failureText('brand_new_code')).toBe('生成失败（brand_new_code）')
  })
})

describe('new results pill', () => {
  it('jumps first, scrolls at bottom, pills when scrolled up', () => {
    const s1 = streamSignature(groupItems(mergeItems([rec({ id: 'a', status: 'running' })], [])))
    const s2 = streamSignature(groupItems(mergeItems([rec({ id: 'a' })], [])))
    expect(newResultsAction(null, s1, false)).toBe('jump')
    expect(newResultsAction(s1, s1, false)).toBe('none')
    expect(newResultsAction(s1, s2, true)).toBe('scroll')
    expect(newResultsAction(s1, s2, false)).toBe('pill')
  })
})
