import { describe, expect, it, vi } from 'vitest'
import { getCase, listCases, listCategories } from './api'
import {
  COMPOSER_FILL_EVENT, copyrightLabel, dispatchComposerFill, fillDetail, pageCases, patchParams, readParams, similarCases, fromManifest, toggleCat, type CaseItem, type ManifestCase,
} from './lib'

const mk = (id: string, over: Partial<CaseItem> = {}): CaseItem => ({
  id, title: `t${id}`, prompt: `p${id}`, category: 'posters', category_zh: '封面与海报', tags: [], model: null, params: {}, template: null,
  author: null, author_url: null, source_url: null, image: { width: 3, height: 4, urls: { w480: `/t/${id}.webp`, w960: null, orig: `/o/${id}.png` } },
  source_repo: 'awesome-gpt-image-2', license_note: '', ...over,
})

describe('manifest adapter', () => {
  it('paginates 60 at a time with a cursor until exhausted', async () => {
    const first = await listCases({ cat: '', q: '' })
    expect(first.items).toHaveLength(60)
    expect(first.total).toBeGreaterThan(500)
    const second = await listCases({ cat: '', q: '', cursor: first.next_cursor })
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id)
    let cursor: string | null = first.next_cursor, seen = 60
    while (cursor) { const p = await listCases({ cat: '', q: '', cursor }); seen += p.items.length; cursor = p.next_cursor }
    expect(seen).toBe(first.total)
  })

  it('every case has dimensions and a source', async () => {
    const all = ((await import('./data/cases.manifest.json')).default as ManifestCase[]).map(fromManifest)
    expect(all).toHaveLength(561)
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    expect(all.every((c) => c.image.width! > 0 && c.image.height! > 0 && c.source_repo && c.license_note)).toBe(true)
  })

  it('filters by category and searches title/prompt/tags; counts agree', async () => {
    const eco = await listCases({ cat: 'ecommerce', q: '' })
    expect(eco.total).toBeGreaterThan(0)
    expect(eco.items.every((c) => c.category === 'ecommerce' && c.template)).toBe(true)
    const { categories, total } = await listCategories('')
    expect(categories.find((c) => c.id === 'ecommerce')!.count).toBe(eco.total)
    expect(categories.reduce((n, c) => n + c.count, 0)).toBe(total)
    expect(await getCase('nope')).toBeNull()
  })

  it('search: case-insensitive, all terms must match, tags count', () => {
    const all = [mk('1', { title: 'Neon CITY' }), mk('2', { prompt: 'a neon sign' }), mk('3', { tags: ['neon', 'city'] }), mk('4')]
    expect(pageCases(all, { cat: '', q: 'neon' }, null).items.map((c) => c.id)).toEqual(['1', '2', '3'])
    expect(pageCases(all, { cat: '', q: 'neon city' }, null).items.map((c) => c.id)).toEqual(['1', '3'])
    expect(pageCases(all, { cat: 'ui', q: '' }, null).total).toBe(0)
    const mixed = [...all, mk('5', { category: 'ui' }), mk('6', { category: 'food' })]
    expect(pageCases(mixed, { cat: 'ui,posters', q: '' }, null).total).toBe(5) // OR across categories
    expect(pageCases(mixed, { cat: 'ui,food', q: 'neon' }, null).total).toBe(0) // AND with q
    const p = pageCases(all, { cat: '', q: '' }, '2', 1)
    expect(p.items.map((c) => c.id)).toEqual(['3'])
    expect(p.next_cursor).toBe('3')
    expect(pageCases(all, { cat: '', q: '' }, '3', 1).next_cursor).toBeNull()
  })
})

describe('URL params', () => {
  it('toggleCat adds/removes in order; empty id clears', () => {
    expect(toggleCat('', 'ui')).toBe('ui')
    expect(toggleCat('ui', 'posters')).toBe('ui,posters')
    expect(toggleCat('ui,posters', 'ui')).toBe('posters')
    expect(toggleCat('ui,posters', '')).toBe('')
  })

  it('reads with defaults and patches without dropping unrelated params', () => {
    expect(readParams('')).toEqual({ cat: '', q: '', case: null })
    expect(readParams('?cat=ui&q=%20neon%20&case=12')).toEqual({ cat: 'ui', q: 'neon', case: '12' })
    const next = patchParams('?kind=video&cat=ui&case=3', { cat: '', q: 'cat 猫', case: null })
    expect(next.get('kind')).toBe('video')
    expect(next.has('cat')).toBe(false)
    expect(next.has('case')).toBe(false)
    expect(readParams(next).q).toBe('cat 猫')
    expect(readParams(patchParams(next, { case: '9' })).case).toBe('9')
  })
})

describe('similar cases', () => {
  it('ranks by same category (2) + shared tags (1), excludes self and zero scores, stable ties', () => {
    const target = mk('0', { category: 'ui', tags: ['a', 'b'] })
    const all = [
      target,
      mk('1', { category: 'ui' }), // 2
      mk('2', { tags: ['a', 'b'] }), // 2
      mk('3', { category: 'ui', tags: ['a'] }), // 3
      mk('4'), // 0
      mk('5', { tags: ['b'] }), // 1
    ]
    expect(similarCases(all, target).map((c) => c.id)).toEqual(['3', '1', '2', '5'])
    expect(similarCases(all, target, 2)).toHaveLength(2)
  })
})

describe('copyright + composer fill', () => {
  it('labels per source', () => {
    expect(copyrightLabel({ id: '1', title: 'x', source_repo: 'Punk-Skill', author: 'adrianpunk' }).detail).toContain('来源：Punk-Skill（MIT）')
    const a = copyrightLabel({ id: '2', title: 'y', source_repo: 'awesome-gpt-image-2', author: '@foo' })
    expect(a.card).toBe('来源：awesome-gpt-image-2')
    expect(a.detail).toBe('来源：awesome-gpt-image-2 · 原作者 @foo · 示例内容版权归原作者，仅供学习参考')
    expect(copyrightLabel({ id: '3', title: 'z', source_repo: 'awesome-gpt-image-2', author: null }).detail).not.toContain('· 原作者')
  })

  it('builds the fill detail (full, prompt-only, template) and dispatches it on window', () => {
    const c = mk('7', { model: 'gpt-image-2', params: { aspect_ratio: '3:4' }, template: { items: [{ key: 'main', label: '主图', description: '白底', count: 1, references: [{ slot: '商品图' }] }] } })
    const full = fillDetail(c)
    expect(full).toMatchObject({ source: 'case', case_id: '7', kind: 'image', model: 'gpt-image-2', params: { aspect_ratio: '3:4' }, reference_urls: [] })
    expect(full.template!.items[0]).toMatchObject({ prompt: 'p7\n\n主图：白底', references: [{ slot: '商品图' }] })
    expect(fillDetail(c, true)).toEqual({ source: 'case', case_id: '7', kind: 'image', model: null, prompt: 'p7', params: {}, reference_urls: [] })
    const spy = vi.fn()
    window.addEventListener(COMPOSER_FILL_EVENT, spy)
    dispatchComposerFill(full)
    expect((spy.mock.calls[0]![0] as CustomEvent).detail).toBe(full)
  })
})
