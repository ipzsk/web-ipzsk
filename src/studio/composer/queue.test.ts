import { describe, expect, it } from 'vitest'
import { ApiError } from '@/shared/api'
import type { ModelSpec } from '@/shared/contracts'
import { classify } from '../api/generation'
import { conflictQueue, reviveQueue, toWire, type QueueEntry } from '../api/queue'
import { planFill, parseFill } from './fill'
import { itemFromDraft, planSend } from './logic'

const model: ModelSpec = { id: 'm', kind: 'image', name: 'M', billing: { unit: null }, unsupported: {}, params: [{ field: 'resolution', type: 'enum', values: ['1K', '2K'], default: '1K' }], references: { maxImages: 4 } }
const asset = (id: string) => ({ id, kind: 'image' as const, status: 'ready' as const, width: 1, height: 1, duration_ms: null, urls: { orig: `https://x/${id}` } })
const entry = (id: string, extra: Partial<QueueEntry> = {}): QueueEntry => ({ ...itemFromDraft({ kind: 'image', model, params: { resolution: '1K' }, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: id }] }] }, slots: [{ asset: asset('a1'), by: [], manual: true }] }, id), ...extra })

describe('queue sync', () => {
  it('sends only gateway-accepted fields', () => {
    const w = toWire([{ ...entry('i1'), state: 'failed', error: { code: 'x', message: 'y' }, missing: true }])[0]!
    expect(Object.keys(w).sort()).toEqual(['anchor_of', 'item_id', 'kind', 'mentions', 'model', 'params', 'prompt', 'prompt_doc', 'reference_asset_ids'])
  })

  it('409 → server copy from body.queue, revived with local extras and missing flag kept', () => {
    const server = { items: toWire([entry('i1')]).map(i => ({ ...i, missing: true })), revision: 7 }
    const e = new ApiError('队列已在其他设备更新', { status: 409, code: 'queue_conflict', body: { error: { code: 'queue_conflict' }, queue: server } })
    const doc = conflictQueue(e)!
    expect(doc.revision).toBe(7)
    expect(doc.items[0]).toMatchObject({ item_id: 'i1', missing: true, slots: [{ asset: { id: 'a1' } }] })
    expect(conflictQueue(new ApiError('x', { status: 409, code: 'queue_conflict' }))).toBeNull()
    expect(reviveQueue(server.items as never, { i1: { slots: [{ asset: asset('a1'), by: [], manual: true }] } })[0]!.slots[0]!.asset.urls.orig).toBe('https://x/a1')
  })

  it('generation 4xx keeps error.field for the param chip', () => {
    const out = classify(new ApiError('bad', { status: 400, code: 'invalid_param_value', body: { error: { code: 'invalid_param_value', field: 'resolution' } } }))
    expect(out).toEqual({ status: 'rejected', error: { code: 'invalid_param_value', message: 'bad', field: 'resolution' } })
  })

  it('missing items are not sendable', () => {
    const q = [entry('a', { missing: true }), entry('b')]
    expect(planSend(q, null).map(i => i.item_id)).toEqual(['b'])
  })
})

describe('fill seams', () => {
  const ctx = { models: [model], kind: 'image' as const, memory: { image: { params: {} }, video: { params: {} } }, slots: [], queue: [] }
  it('case reference_urls are display-only: never in reference_asset_ids', () => {
    const plan = planFill(parseFill({ source: 'case', prompt: 'p', reference_urls: ['https://case/1.png'] })!, ctx)
    expect(plan.slots![0]).toMatchObject({ url_only: true })
    expect(itemFromDraft({ kind: 'image', model, params: {}, doc: plan.doc!, slots: plan.slots! }).reference_asset_ids).toEqual([])
  })
  it('canvas assets with ids are sent, URL-only ones are not', () => {
    const plan = planFill(parseFill({ source: 'canvas', project_id: 'p', node_id: 'n', prompt: 'x', reference_assets: [asset('id1')], reference_urls: ['https://u'] })!, ctx)
    expect(itemFromDraft({ kind: 'image', model, params: {}, doc: plan.doc!, slots: plan.slots! }).reference_asset_ids).toEqual(['id1'])
  })
  it('a template replaces the draft so 发送 does not append it', () => {
    const plan = planFill(parseFill({ source: 'case', prompt: 'p', reference_urls: [], template: { name: 't', items: [{ key: 'a', label: 'A', prompt: 'pa', count: 1, references: [] }, { key: 'b', label: 'B', prompt: 'pb', count: 1, references: [] }] } })!, ctx)
    expect(plan.doc).toBeNull()
    expect(plan.slots).toEqual([])
    expect(plan.queue![1]!.anchor_of).toBe(plan.queue![0]!.item_id)
  })
})
