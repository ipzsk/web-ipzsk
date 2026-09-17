// Mocks must produce exactly the generated gateway shapes. Two layers:
//  1. compile time: the typed mock exports below `satisfies` the generated types (tsc -b fails on drift);
//  2. run time: every object is checked against the interface's keys parsed from generated/ipzsk-api.d.ts —
//     all required keys present, no keys the contract doesn't declare (catches extra fields TS lets through).
import { describe, expect, it } from 'vitest'
import type {
  AdminCase as GenAdminCase, AdminGenerationDetail, AdminMe, AdminUserDetail, AuditEvent, Folder, GenerationRecord, InspirationCase, MediaAsset, ModelSpec, Page, Subject, UserTemplateCreate,
} from '.'
import { MOCK_MODELS } from '@/studio/api/catalog'
import { MOCK_MODELS as CANVAS_MODELS } from '@/studio/canvas/mock'
import { MOCK_SUBJECTS } from '@/studio/api/subjects'
import { buildTemplate } from '@/studio/templates/logic'
import { advanceMockRecord, mockRecord } from '@/studio/api/records'
import { createMockApi as createAssetsMock } from '@/studio/assets/mock'
import { createMockApi as createAdminMock } from '@/admin/api'
import type { AdminCase } from '@/admin/lib'
import { fromManifest, type ManifestCase } from '@/studio/inspiration/lib'
import manifest from '@/studio/inspiration/data/cases.manifest.json'
import dts from './generated/ipzsk-api.d.ts?raw'

/** Top-level keys of `export interface Name { … }` (2-space indented members). */
function keysOf(name: string) {
  const m = dts.match(new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`interface ${name} not in generated d.ts`)
  const required: string[] = [], optional: string[] = []
  let open = false
  for (const line of m[1]!.split('\n')) {
    const k = line.match(/^ {2}("?[\w-]+"?)(\?)?:/)
    if (k) (k[2] ? optional : required).push(k[1]!.replace(/"/g, ''))
    if (/^ {2}\[extra/.test(line)) open = true
  }
  return { required, optional, open }
}

/** Problems of `obj` against interface `name`; `extra` = website-only keys tolerated on purpose. */
function check(name: string, obj: unknown, extra: string[] = []): string[] {
  if (!obj || typeof obj !== 'object') return [`${name}: not an object`]
  const { required, optional, open } = keysOf(name)
  const keys = Object.keys(obj)
  return [
    ...required.filter(k => !keys.includes(k)).map(k => `${name}: missing ${k}`),
    ...(open ? [] : keys.filter(k => !required.includes(k) && !optional.includes(k) && !extra.includes(k)).map(k => `${name}: unexpected ${k}`)),
  ]
}
const asset = (a: unknown) => (a as { missing?: boolean }).missing ? check('MissingAsset', a) : [...check('MediaAsset', a), ...check('AssetUrls', (a as MediaAsset).urls)]
const all = (xs: string[][]) => xs.flat()

describe('mocks match generated contracts', () => {
  it('model catalogs (studio + canvas)', () => {
    ;[MOCK_MODELS, CANVAS_MODELS] satisfies ModelSpec[][]
    const problems = all([...MOCK_MODELS, ...CANVAS_MODELS].flatMap(m => [
      check('ModelSpec', m), check('ModelReferences', m.references), ...m.params.map(p => check('ParamSpec', p)),
    ]))
    expect(problems).toEqual([])
  })

  it('subjects (with a missing asset)', () => {
    MOCK_SUBJECTS satisfies Subject[]
    expect(MOCK_SUBJECTS.some(s => s.assets.some(a => 'missing' in a))).toBe(true)
    expect(all(MOCK_SUBJECTS.flatMap(s => [check('Subject', s), ...s.assets.map(asset), s.cover ? asset(s.cover) : []]))).toEqual([])
  })

  it('generation records', () => {
    const pending = {
      item_id: 'i1', kind: 'image' as const, model: 'gpt-image-2', prompt: 'cat', params: { n: 2 }, reference_asset_ids: [], references: [],
      batch_id: null, batch_position: null, parent_record_id: null, thread_id: null, anchor_record_id: null, anchor_of: null, mentions: [], prompt_doc: null,
    }
    const created = '2026-09-17T10:00:00.000Z'
    const done = advanceMockRecord({ ...mockRecord(pending, 'r1', created), _fail: false }, Date.parse(created) + 60_000) satisfies GenerationRecord
    expect(done.status).toBe('succeeded')
    expect([...check('GenerationRecord', done), ...done.results.flatMap(asset)]).toEqual([])
  })

  it('user template body (存为模板)', () => {
    const body = buildTemplate({
      name: 't', cover_id: null, refMode: 'slot', variables: [{ name: 'c', label: '颜色', default: '', required: true }],
      items: [{ item_id: 'i1', kind: 'image', model: 'gpt-image-2', prompt: '{{c}}', params: { n: 1 }, anchor_of: null, mentions: [], prompt_doc: null, reference_asset_ids: ['a'] }],
    }) satisfies UserTemplateCreate
    expect(all([check('UserTemplateCreate', body), ...body.items.map(i => check('TemplateItem', i)), ...body.variables!.map(v => check('TemplateVariable', v))])).toEqual([])
  })

  it('assets + folders', async () => {
    const api = createAssetsMock({ load: async () => undefined, save: async () => {}, latency: () => 0, failRate: 0 })
    const page = await api.listAssets({}, null) satisfies Page<MediaAsset>
    const folders = await api.listFolders() satisfies Folder[]
    expect(page.items.length).toBeGreaterThan(0)
    expect(Object.keys(page).sort()).toEqual(['items', 'next_cursor'])
    expect(all([...page.items.map(asset), ...folders.map(f => check('Folder', f))])).toEqual([])
  })

  it('admin', async () => {
    const api = createAdminMock('admin', async () => {})
    const me = await api.me() satisfies AdminMe
    const cases = await api.cases.list({})
    const gens = await api.generations.list({})
    const detail = await api.generations.get(gens.items[0]!.id) satisfies AdminGenerationDetail
    const user = await api.users.get('u-1') satisfies AdminUserDetail
    const audit = await api.audit.list({})
    ;({} as AdminCase) satisfies GenAdminCase
    audit.items satisfies AuditEvent[]
    expect(all([
      check('AdminMe', me),
      check('AdminCasePage', cases, []), ...cases.items.flatMap(c => [check('AdminCase', c), c.cover ? asset(c.cover) : []]),
      ...gens.items.map(g => check('AdminGeneration', g)),
      check('AdminGenerationDetail', detail), ...detail.references.map(asset), ...detail.results.map(asset),
      check('AdminUserDetail', user), ...audit.items.map(a => check('AuditEvent', a)),
    ])).toEqual([])
  })

  it('inspiration manifest adapter', () => {
    const cases = (manifest as ManifestCase[]).map(fromManifest) satisfies InspirationCase[]
    expect(all(cases.map(c => [...check('InspirationCase', c), ...check('CaseImage', c.image)]))).toEqual([])
  })
})
