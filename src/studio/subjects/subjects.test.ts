import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { ApiError } from '@/shared/api'
import type { MediaAsset } from '@/media'
import { MOCK_MODELS } from '../api/catalog'
import type { QueueEntry } from '../api/queue'
import { subjectErrorMessage } from '../api/subjects'
import { chipsOf, fillSubjectVar, subjectBlockReason, subjectVarsOf } from '../composer/logic'
import { parseFill, planFill, type FillContext } from '../composer/fill'
import { addAssets, copyName, coverOf, moveAsset, undoable, validateSubject } from './logic'

const img = (id: string): MediaAsset => ({ id, kind: 'image', status: 'ready', width: 1, height: 1, duration_ms: null, urls: { orig: id } })

describe('subject validation', () => {
  it('name 1–30, unique (case-insensitive), note ≤500, refs 1–8', () => {
    expect(validateSubject({ name: ' ', note: '', assets: [] })).toEqual({ name: '请填写名称', assets: '至少添加 1 张参考图' })
    expect(validateSubject({ name: '一'.repeat(31), note: 'x'.repeat(501), assets: [img('a')] })).toEqual({ name: '名称最多 30 个字', note: '备注最多 500 个字' })
    expect(validateSubject({ name: 'Cat', note: '', assets: [img('a')] }, [{ id: 's1', name: 'cat' }]).name).toBe('名称已存在')
    expect(validateSubject({ name: 'Cat', note: '', assets: [img('a')] }, [{ id: 's1', name: 'cat' }], 's1')).toEqual({})
    expect(validateSubject({ name: 'x', note: '', assets: Array.from({ length: 9 }, (_, i) => img(String(i))) }).assets).toBe('最多 8 张参考图')
  })
  it('maps 409 subject_name_taken to 名称已存在', () => {
    expect(subjectErrorMessage(new ApiError('conflict', { status: 409, code: 'subject_name_taken' }))).toBe('名称已存在')
    expect(subjectErrorMessage(new ApiError('其它', { status: 500, code: 'x' }))).toBe('其它')
  })
})

describe('reorder / cover / add', () => {
  const list = [img('a'), img('b'), img('c')]
  it('moves by id', () => expect(moveAsset(list, 'c', 'a').map(a => a.id)).toEqual(['c', 'a', 'b']))
  it('cover falls back to first when removed', () => {
    expect(coverOf(list, 'b')).toBe('b')
    expect(coverOf(list.filter(a => a.id !== 'b'), 'b')).toBe('a')
    expect(coverOf([], 'b')).toBeNull()
  })
  it('adds deduped, images only, capped at 8', () => {
    const r = addAssets(list, [img('a'), img('d'), { ...img('v'), kind: 'video' }, ...Array.from({ length: 6 }, (_, i) => img(`n${i}`))])
    expect(r.assets.map(a => a.id)).toEqual(['a', 'b', 'c', 'd', 'n0', 'n1', 'n2', 'n3'])
    expect(r.dropped).toBe(2)
  })
  it('copy name picks first free', () => expect(copyName('猫', [{ name: '猫' }, { name: '猫 副本' }])).toBe('猫 副本2'))
})

describe('optimistic delete + undo', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('undo within 5s reverts and never commits', () => {
    const log: string[] = []
    const d = undoable({ apply: () => log.push('apply'), revert: () => log.push('revert'), commit: async () => { log.push('commit') } })
    vi.advanceTimersByTime(4000)
    expect(d.undo()).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(log).toEqual(['apply', 'revert'])
  })
  it('commits after 5s; failure rolls back', async () => {
    const log: string[] = []
    const d = undoable({ apply: () => log.push('apply'), revert: () => log.push('revert'), commit: () => { log.push('commit'); return Promise.reject(new Error('x')) }, onError: () => log.push('error') })
    await vi.advanceTimersByTimeAsync(5000)
    expect(d.undo()).toBe(false)
    expect(log).toEqual(['apply', 'commit', 'revert', 'error'])
  })
})

const text = (t: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const gpt = MOCK_MODELS.find(m => m.id === 'gpt-image-2')
const turbo = MOCK_MODELS.find(m => m.id === 'z-image-turbo')
let n = 0
const ctx = (over: Partial<FillContext> = {}): FillContext => ({
  models: MOCK_MODELS, kind: 'image', memory: { image: { model: 'gpt-image-2', params: { aspect_ratio: '1:1' } }, video: { params: {} } },
  slots: [], queue: [], newId: () => `id${++n}`, ...over,
})

describe('composer-fill handlers', () => {
  beforeEach(() => { n = 0 })
  it('ignores unknown sources and bad shapes', () => {
    expect(parseFill({ source: 'nope' })).toBeNull()
    expect(parseFill('x')).toBeNull()
    expect(parseFill({ source: 'asset', reference_assets: [{ id: 1 }] })).toBeNull()
    expect(parseFill({ source: 'batch', items: 'x' })).toBeNull()
  })
  it('case: fills prompt/model/params, falls back to default model with one notice', () => {
    const p = planFill(parseFill({ source: 'case', case_id: '1', kind: 'image', model: 'gone-model', prompt: '猫', params: { aspect_ratio: '16:9', resolution: '8K' }, reference_urls: [] })!, ctx())
    expect(p.model).toBe(gpt!.id)
    expect(p.params).toEqual({ aspect_ratio: '16:9', resolution: '2k', n: 1 })
    expect(chipsOf(p.doc!)).toEqual([])
    expect(p.notices).toEqual(['型号「gone-model」暂不可用，已换成 GPT Image 2'])
    expect(p.toast).toBe(false) // inspiration already toasts
  })
  it('case template: expands into queue items with ① as anchor', () => {
    const p = planFill(parseFill({
      source: 'case', case_id: '1', kind: 'image', model: 'gpt-image-2', prompt: '底', params: {}, reference_urls: [],
      template: { name: 't', items: [{ key: 'main', label: '主图', prompt: '底 主图', count: 1, references: [{ slot: '商品图' }] }, { key: 's', label: '卖点', prompt: '底 卖点', count: 2, references: [] }] },
    })!, ctx())
    expect(p.queue!.map(i => [i.item_id, i.anchor_of, i.prompt, i.params.n])).toEqual([['id1', null, '底 主图', 1], ['id2', 'id1', '底 卖点', 2]])
    expect(p.notices.join()).toContain('商品图')
  })
  it('asset: appends deduped, respects model max, rejects when unsupported', () => {
    const p = planFill({ source: 'asset', reference_assets: [img('a'), img('b')] }, ctx({ slots: [{ asset: img('a'), by: [], manual: false }] }))
    expect(p.slots!.map(s => s.asset.id)).toEqual(['a', 'b'])
    expect(p.toast).toBe(true)
    const q = planFill({ source: 'asset', reference_assets: [img('a')] }, ctx({ memory: { image: { model: turbo!.id, params: {} }, video: { params: {} } } }))
    expect(q.slots).toBeUndefined()
    expect(q.notices[0]).toContain('不使用参考图')
  })
  it('record: restores prompt_doc chips, refs and params', () => {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 's1', label: '阿福', kind: 'subject', uid: 'u' } }, { type: 'text', text: ' 跑步' }] }] }
    const p = planFill(parseFill({ source: 'record', record_id: 'r', kind: 'image', model: 'gpt-image-2', prompt: '@阿福 跑步', prompt_doc: doc, mentions: [], params: { n: 2 }, reference_assets: [img('x')] })!, ctx())
    expect(p.doc).toBe(doc)
    expect(p.slots!.map(s => s.asset.id)).toEqual(['x'])
    expect(p.params!.n).toBe(2)
    expect(p.toast).toBe(true)
  })
  it('batch: replaces queue, remaps anchors to fresh ids', () => {
    const p = planFill(parseFill({ source: 'batch', items: [{ item_id: 'old1', model: 'gpt-image-2', prompt: 'a' }, { item_id: 'old2', anchor_of: 'old1', model: 'gpt-image-2', prompt: 'b' }] })!, ctx())
    expect(p.queue!.map(i => [i.item_id, i.anchor_of])).toEqual([['id1', null], ['id2', 'id1']])
  })
  it('canvas: prompt + url references, no toast (canvas toasts)', () => {
    const p = planFill(parseFill({ source: 'canvas', project_id: 'p', node_id: 'n', prompt: '海', reference_urls: ['https://x/1.png'] })!, ctx())
    expect(p.slots!.map(s => s.asset.urls.orig)).toEqual(['https://x/1.png'])
    expect(p.toast).toBe(false)
  })
})

describe('subject send blocking', () => {
  const item = (prompt: string, mentions: QueueEntry['mentions'] = []) => ({ prompt, mentions })
  it('deleted subject chip blocks until removed', () => {
    expect(subjectBlockReason([item('@阿福', [{ type: 'subject', id: 's1', name: '阿福' }])], new Set(['s2']))).toContain('主体已删除')
    expect(subjectBlockReason([item('@阿福', [{ type: 'subject', id: 's1', name: '阿福' }])], new Set(['s1']))).toBeNull()
    expect(subjectBlockReason([item('@阿福', [{ type: 'subject', id: 's1', name: '阿福' }])], undefined)).toBeNull()
  })
  it('{{主体:商品}} requires a pick; filling replaces it with a chip', () => {
    expect(subjectVarsOf('把{{主体:商品}}放在{{主体:商品}}旁，{{主题}}')).toEqual(['{{主体:商品}}'])
    expect(subjectBlockReason([item('把{{主体:商品}}放桌上')], new Set())).toBe('请为 {{主体:商品}} 选择主体')
    const doc = fillSubjectVar(text('把{{主体:商品}}放桌上'), '{{主体:商品}}', { id: 's1', label: '气泡水', kind: 'subject', uid: 'u' })
    expect(doc.content![0]!.content!.map(c => c.type === 'text' ? c.text : `@${c.attrs!.label}`)).toEqual(['把', '@气泡水', '放桌上'])
  })
})
