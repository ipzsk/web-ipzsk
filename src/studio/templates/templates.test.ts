import { describe, expect, it } from 'vitest'
import { buildTemplate, copyTemplateName, fillDoc, fillText, mergeVariables, resolveValues, slotsOf, validateTemplate, variableNames, type TemplateSource } from './logic'

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
})
