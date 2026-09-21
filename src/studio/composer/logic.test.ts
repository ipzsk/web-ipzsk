import { describe, expect, it } from 'vitest'
import { hashKey } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/core'
import type { MediaAsset } from '@/media'
import type { ModelSpec, ParamSpec } from '@/shared/contracts'
import { MOCK_MODELS } from '../api/catalog'
import type { QueueEntry, RefSlot } from '../api/queue'
import { classify, type SubmitOutcome } from '../api/generation'
import { ApiError } from '@/shared/api'
import {
  addFromChip, addManual, diffItem, expandModels, itemFromDraft, normalizeParams, planSend, pruneChips,
  quoteEntry, referenceState, sentReferenceIds, serializePrompt, type Draft,
  textVarsOf, varLabel, isOptionalVar, applyVars, varOptions, varBlockReason,
  modelPriceLabel, summaryParams, unitLabel,
  boolValues, controlOf, defaultOf, defaultParams, formatParam, paramLabel,
} from './logic'
import { quoteQueryKey } from './hooks'
import { createSender } from './send'

const byId = (id: string) => MOCK_MODELS.find(m => m.id === id)!
const [gpt, flare, gemini, turbo, seedance] = ['gpt-image-2', 'gpt-image-2.5-flare', 'gemini-3.1-flash-image-preview', 'z-image-turbo', 'seedance-2.0-mini'].map(byId) as [ModelSpec, ModelSpec, ModelSpec, ModelSpec, ModelSpec]
const asset = (id: string): MediaAsset => ({ id, kind: 'image', status: 'ready', width: 1, height: 1, duration_ms: null, urls: { orig: id } })
const text = (t: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const draft = (over: Partial<Draft> = {}): Draft => ({ kind: 'image', model: gpt, params: { aspect_ratio: '16:9', resolution: '2k', n: 2 }, doc: text('橘猫'), slots: [], ...over })

describe('params', () => {
  it('multi-model expansion normalises per model and records changes', () => {
    const [a, b] = expandModels(draft(), [gpt, turbo])
    expect(a!.model).toBe('gpt-image-2')
    expect(a!.changes).toEqual([])
    expect(b!.params).toEqual({ aspect_ratio: '16:9', resolution: '1K', enhance_prompt: 'false', n: 2 })
    expect(b!.changes).toEqual([{ name: 'resolution', from: '2k', to: '1K' }])
    expect(a!.item_id).not.toBe(b!.item_id)
    expect(a!.prompt).toBe(b!.prompt)
  })
  it('out-of-range resets to model default; values are case-sensitive; undeclared params dropped', () => {
    expect(normalizeParams(flare, { resolution: '2K', aspect_ratio: '5:4' })).toEqual({
      params: { aspect_ratio: '5:4', resolution: '1k', quality: 'medium', n: 1 }, changes: [{ name: 'resolution', from: '2K', to: '1k' }],
    })
    const v = normalizeParams(seedance, { aspect_ratio: '3:1', n: 3, duration: 7 })
    expect(v.params).toEqual({ aspect_ratio: '16:9', resolution: '720p', duration: '5', sound: 'false' })
    expect(v.changes.map(c => c.name)).toEqual(['aspect_ratio', 'duration'])
    expect(normalizeParams(gpt, { n: 9 }).params.n).toBe(1)
  })

  const spec = (over: Partial<ParamSpec>): ParamSpec => ({ field: 'x', type: 'string', default: null, ...over })
  it('每个 ParamSpec 都映射到一个控件，未知类型退化成文本框', () => {
    const of = (m: ModelSpec, f: string) => controlOf(m.params.find(p => p.field === f)!)
    expect(of(flare, 'aspect_ratio')).toBe('enum')
    expect(of(flare, 'quality')).toBe('enum')
    expect(of(gemini, 'resolution')).toBe('enum')
    expect(of(seedance, 'duration')).toBe('enum') // 字符串数组 "4".."15" 仍是枚举
    expect(of(seedance, 'seed')).toBe('number')   // integer 且没有 values
    expect(of(seedance, 'sound')).toBe('boolean')
    expect(of(turbo, 'enhance_prompt')).toBe('boolean') // values ["true","false"] 其实是布尔
    expect(controlOf(spec({ type: 'string' }))).toBe('text')
    expect(controlOf(spec({ type: 'rating' as ParamSpec['type'] }))).toBe('text') // 未知类型不崩、不丢
  })
  it('布尔按目录声明的形态回写；无默认值时为关', () => {
    expect(boolValues(spec({ type: 'boolean' }))).toEqual([true, false])
    expect(boolValues(spec({ type: 'boolean', values: ['true', 'false'] }))).toEqual(['true', 'false'])
    expect(defaultOf(spec({ type: 'boolean' }))).toBe(false)
    expect(defaultOf(spec({ type: 'boolean', values: ['true', 'false'] }))).toBe('false')
    expect(defaultOf(spec({ field: 'seed', type: 'integer' }))).toBeUndefined()
  })
  it('目录 default 决定初值；没有 default 的参数不下发空值', () => {
    expect(defaultParams(flare)).toEqual({ aspect_ratio: 'auto', resolution: '1k', quality: 'medium', n: 1 })
    expect(defaultParams(seedance)).toEqual({ aspect_ratio: '16:9', resolution: '720p', duration: '5', sound: 'false' })
    expect('seed' in defaultParams(seedance)).toBe(false)
    // 记住的值仍然有效时优先于 default
    expect(normalizeParams(flare, { quality: 'max' }).params.quality).toBe('max')
    // 空字符串既不算有效值，也不算「用户改过」
    expect(normalizeParams(seedance, { seed: '' as unknown as number })).toEqual({ params: defaultParams(seedance), changes: [] })
  })
  it('中文标签；未知字段回落到原始 key', () => {
    expect(['aspect_ratio', 'resolution', 'quality', 'n', 'duration', 'seed', 'sound', 'generate_audio', 'enhance_prompt'].map(paramLabel))
      .toEqual(['比例', '分辨率', '画质', '张数', '时长', '种子', '声音', '声音', '提示词增强'])
    expect(paramLabel('cfg_scale')).toBe('cfg_scale')
    expect([formatParam('sound', true), formatParam('enhance_prompt', 'false'), formatParam('seed', undefined), formatParam('duration', '15')])
      .toEqual(['开', '关', '随机', '15秒'])
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
  const d = diffItem({ ...itemFromDraft(draft({ params: { aspect_ratio: '1:1', resolution: '2k', n: 2 } })) }, cur)
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
    const calls: { item_id: string; reference_asset_ids: string[]; anchor_record_id: string | null; batch_position: number | null }[] = []
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
      : id === 'net' ? { status: 'retryable', error: { code: 'network_error', message: '网络' } } : { status: 'accepted' })
    t.queue = ['a', 'bad', 'net', 'b', 'c'].map(id => t.item(id))
    await t.sender.sendBatch(t.queue, { thread_id: null })
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['bad', 'failed'], ['net', 'retryable']])
    expect(t.queue[0]!.error?.message).toBe('不支持')
    expect(t.calls.map(c => c.batch_position)).toEqual([0, 1, 2, 3, 4]) // 0-based: gateway CHECK batch_position BETWEEN 0 AND 11
    expect(t.maxInFlight).toBeLessThanOrEqual(3)
  })

  it('failed composer item is appended so the draft is not lost', async () => {
    const t = setup(() => ({ status: 'rejected', error: { code: 'x', message: 'x' } }))
    await t.sender.sendBatch([t.item('draft')], { thread_id: 't' })
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['draft', 'failed']])
  })

  it('anchor two-phase', async () => {
    const t = setup(() => ({ status: 'accepted' }))
    t.queue = [t.item('A'), t.item('B', { anchor_of: 'A', reference_asset_ids: ['own'] }), t.item('C', { anchor_of: 'A' })]
    await t.sender.sendBatch(t.queue, { thread_id: null })
    expect(t.calls.map(c => c.item_id)).toEqual(['A'])
    expect(t.queue.map(i => [i.item_id, i.state])).toEqual([['B', 'waiting'], ['C', 'waiting']])
    await t.sender.onAnchorSucceeded('A', 'asset-A', 'rec-A')
    expect(t.calls.slice(1)).toMatchObject([
      { item_id: 'B', reference_asset_ids: ['asset-A', 'own'], anchor_record_id: 'rec-A', batch_position: 1 },
      { item_id: 'C', reference_asset_ids: ['asset-A'], anchor_record_id: 'rec-A', batch_position: 2 },
    ])
    expect(t.queue).toEqual([])
    await t.sender.onAnchorSucceeded('A', 'asset-A', 'rec-A') // idempotent
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
    await u.sender.onAnchorSucceeded('A', 'late', 'rec-A')
    expect(u.queue.map(i => [i.item_id, i.state])).toEqual([['B', 'cancelled']])
    expect(u.calls).toHaveLength(1)
  })
})

it('quote cache key is stable across param insertion order', () => {
  const a = quoteEntry({ kind: 'image', model: 'gpt-image-2', params: { resolution: '2K', aspect_ratio: '1:1' }, reference_asset_ids: ['x'] })
  const b = quoteEntry({ reference_asset_ids: ['x'], params: { aspect_ratio: '1:1', resolution: '2K' }, model: 'gpt-image-2', kind: 'image' })
  expect(hashKey(quoteQueryKey([a]))).toBe(hashKey(quoteQueryKey([b])))
  expect(hashKey(quoteQueryKey([a]))).not.toBe(hashKey(quoteQueryKey([{ ...a, params: { ...a.params, resolution: '4K' } }])))
  // references are part of the priced body (gateway signs them for lanehub /v1/quote)
  expect(hashKey(quoteQueryKey([a]))).not.toBe(hashKey(quoteQueryKey([{ ...a, reference_asset_ids: ['y'] }])))
})

describe('summaryParams / unitLabel / modelPriceLabel', () => {
  it('drops empty params so summaries have no stray separators', () => {
    expect(summaryParams({ aspect_ratio: '', resolution: '1k', seed: '', n: 0, sound: false })).toEqual([['resolution', '1k'], ['n', 0], ['sound', false]])
  })
  it('maps billing units to Chinese, never the raw string', () => {
    expect(unitLabel('per_call')).toBe('按次')
    expect(unitLabel('per_second')).toBe('按秒')
    expect(unitLabel('per_minute')).toBe('按分钟')
    expect(unitLabel('per_minute_output')).toBe('按分钟')
    expect(unitLabel('per_1m_tokens')).toBe('按 token')
    expect(unitLabel('per_weird')).toBe('')
    expect(unitLabel(undefined)).toBe('')
  })
  it('prices per image / second / minute from the default-params quote', () => {
    const img = { ...gpt, billing: { unit: 'per_call' } }
    expect(modelPriceLabel(img, 5.70197)).toBe('约 ¥0.06/张') // default n = 1
    expect(modelPriceLabel({ ...img, params: img.params.map(p => p.field === 'n' ? { ...p, default: 2 } : p) }, 12)).toBe('约 ¥0.06/张')
    const vid = { ...seedance, billing: { unit: 'per_second' } } // default duration 5
    expect(modelPriceLabel(vid, 28.5)).toBe('约 ¥0.06/秒')
    expect(modelPriceLabel({ ...vid, billing: { unit: 'per_minute_output' } }, 1)).toBe('约 ¥0.12/分钟')
    expect(modelPriceLabel({ ...vid, billing: { unit: 'per_call' } }, 30)).toBe('约 ¥0.30/次')
    expect(modelPriceLabel(img, null)).toBe('按次')
  })
})

describe('{{填空}} 文本变量', () => {
  const doc = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const P = '标题：{{主题词}}；副标：{{副标题，可留空}}；主角 {{主体:商品}}；再说一次 {{主题词}}'

  it('只认普通空位，{{主体:…}} 归主体那套；标签取逗号前那截', () => {
    expect(textVarsOf(P)).toEqual(['{{主题词}}', '{{副标题，可留空}}'])
    expect(varLabel('{{副标题，可留空}}')).toBe('副标题')
    expect(isOptionalVar('{{副标题，可留空}}')).toBe(true)
    expect(isOptionalVar('{{主题词}}')).toBe(false)
  })

  it('空位一直留在草稿里，格子才能反复改；替换只发生在发送前', () => {
    const { prompt } = serializePrompt(doc(P), [])
    expect(prompt).toContain('{{主题词}}') // 序列化不动空位
    expect(applyVars(prompt, { '{{主题词}}': '春季新品' })).toBe('标题：春季新品；副标：；主角 {{主体:商品}}；再说一次 春季新品')
    // 改一次值，原文没被改坏，再替换就是新值
    expect(applyVars(prompt, { '{{主题词}}': '秋冬上新' })).toContain('标题：秋冬上新')
  })

  it('没填的「可留空」发送时去掉，必填的留着并拦住发送', () => {
    const { prompt } = serializePrompt(doc(P), [])
    const sent = applyVars(prompt, {})
    expect(sent).not.toContain('可留空')
    expect(varBlockReason([{ prompt: sent }])).toBe('请先填写「主题词」')
    expect(varBlockReason([{ prompt: applyVars(prompt, { '{{主题词}}': 'x' }) }])).toBeNull()
  })

  it('必填空位填了又清空，不算已填（否则界面说没填、发送却放行）', () => {
    const p = '标题：{{主题词}}；副标：{{副标题，可留空}}'
    expect(applyVars(p, { '{{主题词}}': '' })).toBe('标题：{{主题词}}；副标：')
    expect(varBlockReason([{ prompt: applyVars(p, { '{{主题词}}': '' }) }])).toBe('请先填写「主题词」')
    expect(applyVars(p, { '{{主题词}}': '春季新品' })).toBe('标题：春季新品；副标：')
  })

  it('选项型空位的拦截文案说「选一下」，不念整串也不念「补充」', () => {
    expect(varBlockReason([{ prompt: '{{4:5 / 1:1 / 3:4}}' }])).toBe('请先选择「4:5 …」')
    expect(varBlockReason([{ prompt: '{{主题词}}' }])).toBe('请先填写「主题词」')
  })

  it('带空格的 ` / ` 才是选项清单，第一项要剥掉粘着的说明', () => {
    // 不剥的话用户选第一项 = 把「请填写，例如：黑金」这句话发给模型
    expect(varOptions('{{画幅比例，例如 4:5 / 1:1 / 3:4}}')).toEqual(['4:5', '1:1', '3:4'])
    expect(varOptions('{{请填写，例如：黑金 / 深红+金 / 深蓝+银}}')).toEqual(['黑金', '深红+金', '深蓝+银'])
    expect(varOptions('{{CITY/COUNTRY}}')).toBeNull()       // 「城市或国家名」，不是二选一
    expect(varOptions('{{PART / SLICE / SEGMENT}}')).toEqual(['PART', 'SLICE', 'SEGMENT'])
  })

  it('取不到名字的空位叫「补充」，不把「可留空」当标签', () => {
    expect(varLabel('{{主题词}}')).toBe('主题词')
    expect(varLabel('{{副标题，可留空}}')).toBe('副标题')
    expect(varLabel('{{可留空；默认根据主题判断}}')).toBe('补充')
    expect(varLabel('{{建议 2–10 个汉字}}')).toBe('补充')
    expect(varLabel('{{自定义标题}}')).toBe('标题')   // 「自定义」是写法不是名字
  })

  it('内容是选项清单的给下拉，自由填空不给', () => {
    expect(varOptions('{{红色 / 绿色 / 自动判断}}')).toEqual(['红色', '绿色', '自动判断'])
    expect(varOptions('{{主题词}}')).toBeNull()
    expect(varOptions('{{辅助短句，可留空，建议 4-12 个字}}')).toBeNull() // 没有 /，是自由填空
  })
})
