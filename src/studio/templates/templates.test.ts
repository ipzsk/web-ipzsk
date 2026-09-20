import { describe, expect, it } from 'vitest'
import { avatarAssetCount, avatarQueueEntry, avatarSlotsOf, buildTemplate, copyTemplateName, isAvatarTemplateItem, templateAvatarSlots, fillDoc, fillText, mergeVariables, resolveValues, slotsOf, validateTemplate, variableNames, type TemplateSource } from './logic'

const src = (id: string, prompt: string, refs: string[] = [], anchor_of: string | null = null): TemplateSource => ({
  item_id: id, kind: 'image', model: 'gpt-image-2', prompt, params: { aspect_ratio: '1:1' }, anchor_of, mentions: [], prompt_doc: null, reference_asset_ids: refs,
})

describe('user templates (§2.8)', () => {
  it('detects {{name}} variables, skipping {{主体:…}}, deduped', () => {
    expect(variableNames(['一只{{颜色}}的猫 {{ 颜色 }}', '{{主体:商品}} 放在{{场景}}'])).toEqual(['颜色', '场景'])
    expect(mergeVariables(['颜色'], [{ name: '颜色', label: '主色', required: false }])).toEqual([{ name: '颜色', label: '主色', required: false }])
  })

  it('builds slot placeholders or owned asset refs; drops anchors outside the template', () => {
    const items = [src('a', 'x', ['as1', 'as2']), src('b', 'y', [], 'a'), src('c', 'z', [], 'gone')]
    const slot = buildTemplate({ name: ' 套图 ', cover_id: null, items, variables: [], refMode: 'slot' })
    expect(slot.name).toBe('套图')
    expect(slot.items[0]!.references).toEqual([{ slot: 0 }, { slot: 1 }])
    expect(slot.items.map(i => i.anchor_of)).toEqual([null, 'a', null])
    expect(slotsOf(slot.items[0]!)).toEqual([0, 1])
    expect(buildTemplate({ name: 'n', cover_id: 'as1', items, variables: [], refMode: 'asset' }).items[0]!.references).toEqual([{ asset_id: 'as1' }, { asset_id: 'as2' }])
  })

  it('validates name 1–60 and 1–12 items', () => {
    expect(validateTemplate('', [src('a', 'x')], [])).toBe('请填写模板名称')
    expect(validateTemplate('x'.repeat(61), [src('a', 'x')], [])).toMatch('60')
    expect(validateTemplate('ok', [], [])).toMatch('至少')
    expect(validateTemplate('ok', Array.from({ length: 13 }, (_, i) => src(String(i), 'x')), [])).toMatch('12')
    expect(validateTemplate('ok', [src('a', 'x')], [])).toBeNull()
  })

  it('fills only declared variables, applies defaults, rejects {{ in values and empty required', () => {
    const vars = [{ name: '颜色', label: '颜色', default: '橘色', required: true }, { name: '场景', label: '场景', required: true }]
    expect(resolveValues(vars, { 场景: '' }).error).toBe('请填写「场景」')
    expect(resolveValues(vars, { 场景: '{{x}}' }).error).toMatch('{{')
    const { values } = resolveValues(vars, { 场景: '海边' })
    expect(fillText('{{颜色}}猫在{{场景}}，{{未声明}}', values)).toBe('橘色猫在海边，{{未声明}}')
    expect(fillDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '{{颜色}}' }] }] }, values))
      .toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '橘色' }] }] })
  })

  it('copy names', () => {
    expect(copyTemplateName('A', ['A', 'A 副本'])).toBe('A 副本2')
  })

  describe('数字人项 {slot} 占位', () => {
    const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', AU = '33333333-3333-4333-8333-333333333333', BG = '44444444-4444-4444-8444-444444444444'
    const av = (id: string, params: Record<string, string | number | boolean>, prompt = ''): TemplateSource =>
      ({ ...src(id, prompt), kind: 'video', model: 'heygen-image', params: { aspect_ratio: '16:9', ...params } })
    // queue item (fields in params) × 2 sharing a photo, and a record-shaped item (script in prompt, record-only params)
    const items = [
      av('a', { photo_asset_id: P1, script: '你好{{名字}}', voice_id: 'v1', background_asset_id: BG }, '你好{{名字}}'),
      av('b', { photo_asset_id: P1, audio_asset_id: AU, captions: true }, '录音驱动 · 45 秒'),
      av('c', { photo_asset_id: P2, voice_id: 'v1', avatar_source: 'photo', voice_source: 'script', audio_duration_ms: 1 }, '记录里的脚本'),
    ]

    it('slot mode: prompt empty, script/params split, one slot per distinct asset per field', () => {
      const t = buildTemplate({ name: 'n', cover_id: null, items, variables: [], refMode: 'slot' })
      expect(avatarAssetCount(items)).toBe(5)
      expect(t.items[0]).toMatchObject({ prompt: '', references: [], mentions: [], params: { aspect_ratio: '16:9' }, script: '你好{{名字}}', voice_id: 'v1', photo_asset_id: { slot: 0 }, background_asset_id: { slot: 0 } })
      expect(t.items[1]).toMatchObject({ photo_asset_id: { slot: 0 }, audio_asset_id: { slot: 0 }, captions: true })
      expect(t.items[1]!.script).toBeUndefined()
      expect(t.items[2]).toMatchObject({ photo_asset_id: { slot: 1 }, script: '记录里的脚本' })
      expect(t.items[2]!.params).toEqual({ aspect_ratio: '16:9' }) // record-only fields dropped
      expect(t.items.every(isAvatarTemplateItem)).toBe(true)
      expect(avatarSlotsOf(t.items[0]!)).toEqual([{ field: 'photo_asset_id', slot: 0 }, { field: 'background_asset_id', slot: 0 }])
      expect(templateAvatarSlots(t.items).map(n => [n.key, n.label])).toEqual([
        ['photo_asset_id:0', '照片1'], ['photo_asset_id:1', '照片2'], ['audio_asset_id:0', '录音'], ['background_asset_id:0', '背景图'],
      ])
      // every slot number stays inside the gateway's 0–14
      expect(t.items.flatMap(avatarSlotsOf).every(s => s.slot >= 0 && s.slot <= 14)).toBe(true)
    })

    it('asset mode keeps owned ids', () => {
      const t = buildTemplate({ name: 'n', cover_id: null, items, variables: [], refMode: 'asset' })
      expect(t.items[0]).toMatchObject({ photo_asset_id: P1, background_asset_id: BG })
      expect(templateAvatarSlots(t.items)).toEqual([])
    })

    it('mirrors the gateway: avatar items must be complete', () => {
      expect(validateTemplate('ok', items, [])).toBeNull()
      expect(validateTemplate('ok', [av('x', { avatar_source: 'library', voice_source: 'script' }, 'hi')], [])).toMatch('第 1 项数字人还不完整')
      expect(validateTemplate('ok', [av('x', { photo_asset_id: P1, audio_asset_id: AU, script: 'hi' }, 'hi')], [])).toMatch('声音只能选一个')
      expect(validateTemplate('ok', [av('x', { photo_asset_id: P1, script: 'hi' }, 'hi')], [])).toMatch('音色')
    })

    it('apply: filled slots → asset ids, variables in the script, unfilled → red item', () => {
      const t = buildTemplate({ name: 'n', cover_id: null, items, variables: [], refMode: 'slot' })
      const ok = avatarQueueEntry(t.items[0]!, { 'photo_asset_id:0': 'new-photo', 'background_asset_id:0': 'new-bg' }, { 名字: '小满' }, 'q1')
      expect(ok).toMatchObject({ item_id: 'q1', kind: 'video', model: 'heygen-image', prompt: '你好小满', reference_asset_ids: [] })
      expect(ok.state).toBeUndefined()
      expect(ok.params).toEqual({ aspect_ratio: '16:9', photo_asset_id: 'new-photo', script: '你好小满', voice_id: 'v1', background_asset_id: 'new-bg' })
      const red = avatarQueueEntry(t.items[1]!, { 'photo_asset_id:0': 'new-photo' }, {}, 'q2')
      expect(red.state).toBe('failed')
      expect(red.error?.message).toMatch('需要放入录音')
      expect(red.params.audio_asset_id).toBeUndefined()
      expect(red.prompt).toBe('')
    })
  })
})
