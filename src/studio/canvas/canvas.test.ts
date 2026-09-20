import { describe, expect, it } from 'vitest'
import {
  assembleInputs, connectionError, copySelection, decideMode, fromDocument, groupSelection, pasteClip, toDocument, ungroupSelection,
  type AssetRef, type CanvasEdge, type CanvasNode, type NodeKind,
} from './graph'
import { emptyHistory, record, redo, undo, HISTORY_LIMIT } from './history'
import { createLocalRepo, createMockServer, createSyncedRepo, resolveConflict, syncDirty, type KV } from './repo'
import { buildCanvasAdd } from './canvasAdd'
import { parseCanvasAdd } from '@/shared/events'
import { absolutePosition, dropTarget, nudge, reparent, sortParentsFirst } from './graph'

const img = (id: string): AssetRef => ({ id, kind: 'image', width: 10, height: 10, urls: { orig: `https://x/${id}.png` } })
const node = (id: string, type: NodeKind, data: CanvasNode['data'] = {}, position = { x: 0, y: 0 }): CanvasNode => ({ id, type, position, data })
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string): CanvasEdge =>
  ({ id: `${source}>${target}:${targetHandle}`, source, sourceHandle, target, targetHandle })

describe('connection validation', () => {
  const nodes = [
    node('t', 'text'), node('i', 'image', { asset: img('a') }), node('v', 'video'),
    node('g', 'gen-image'), node('gv', 'gen-video'), node('g2', 'gen-image'),
  ]
  const outs: [string, string][] = [['t', 'out-text'], ['i', 'out-image'], ['v', 'out-video'], ['g', 'out-image'], ['gv', 'out-video']]
  const ins: [string, string][] = [['g2', 'in-text'], ['g2', 'in-image'], ['gv', 'in-text'], ['gv', 'in-image']]

  it('matrix: only same-type output→input', () => {
    const result: Record<string, boolean> = {}
    for (const [s, sh] of outs) for (const [t, th] of ins) {
      if (s === t) continue
      result[`${s}.${sh}→${t}.${th}`] = connectionError({ source: s, sourceHandle: sh, target: t, targetHandle: th }, nodes, []) === null
    }
    expect(result).toEqual({
      't.out-text→g2.in-text': true, 't.out-text→g2.in-image': false, 't.out-text→gv.in-text': true, 't.out-text→gv.in-image': false,
      'i.out-image→g2.in-text': false, 'i.out-image→g2.in-image': true, 'i.out-image→gv.in-text': false, 'i.out-image→gv.in-image': true,
      'v.out-video→g2.in-text': false, 'v.out-video→g2.in-image': false, 'v.out-video→gv.in-text': false, 'v.out-video→gv.in-image': false,
      'g.out-image→g2.in-text': false, 'g.out-image→g2.in-image': true, 'g.out-image→gv.in-text': false, 'g.out-image→gv.in-image': true,
      'gv.out-video→g2.in-text': false, 'gv.out-video→g2.in-image': false,
    })
  })

  it('gives reasons', () => {
    expect(connectionError({ source: 'v', sourceHandle: 'out-video', target: 'g2', targetHandle: 'in-image' }, nodes, [])).toBe('视频输出不能接到图片输入')
    expect(connectionError({ source: 'g', sourceHandle: 'out-image', target: 'g', targetHandle: 'in-image' }, nodes, [])).toBe('不能连到节点自己')
    expect(connectionError({ source: 'g2', sourceHandle: 'in-text', target: 't', targetHandle: 'out-text' }, nodes, [])).toBe('只能从输出端口连到输入端口')
    expect(connectionError({ source: 'i', sourceHandle: 'out-image', target: 'g', targetHandle: 'in-text' }, nodes, [])).toMatch('不能接到')
    const e = [edge('i', 'out-image', 'g2', 'in-image')]
    expect(connectionError({ source: 'i', sourceHandle: 'out-image', target: 'g2', targetHandle: 'in-image' }, nodes, e)).toBe('这两个端口已经连着了')
    // g → g2 exists, so g2 → g would loop
    expect(connectionError({ source: 'g2', sourceHandle: 'out-image', target: 'g', targetHandle: 'in-image' }, nodes, [edge('g', 'out-image', 'g2', 'in-image')])).toMatch('循环')
  })
})

describe('history', () => {
  it('undo/redo round trip and redo cleared by new change', () => {
    let h = emptyHistory<number>()
    h = record(h, 0, undefined, 0)
    h = record(h, 1, undefined, 10)
    let r = undo(h, 2)!
    expect(r[1]).toBe(1)
    r = undo(r[0], 1)!
    expect(r[1]).toBe(0)
    expect(undo(r[0], 0)).toBeNull()
    const re = redo(r[0], 0)!
    expect(re[1]).toBe(1)
    expect(record(re[0], 1, undefined, 20).future).toEqual([])
  })

  it('keeps ≥100 steps', () => {
    let h = emptyHistory<number>()
    for (let i = 0; i < 150; i++) h = record(h, i, undefined, i * 5000)
    expect(h.past.length).toBe(150)
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(100)
  })

  it('coalesces same key within 1s (typing) and batches a drag into one step', () => {
    let h = emptyHistory<string>()
    h = record(h, '', 'text:1', 0)
    h = record(h, 'a', 'text:1', 300)
    h = record(h, 'ab', 'text:1', 600)
    expect(h.past).toEqual([''])
    // Drag: one record at drag start, position changes during the drag don't record.
    let state = { x: 0 }
    h = emptyHistory()
    const dragH = record(emptyHistory<{ x: number }>(), state, undefined, 0)
    for (let i = 1; i <= 60; i++) state = { x: i * 4 }
    const back = undo(dragH, state)!
    expect(back[1]).toEqual({ x: 0 })
    expect(back[0].past.length).toBe(0)
  })
})

describe('clipboard', () => {
  it('remaps ids, keeps internal edges only, re-parents children, offsets roots', () => {
    const nodes: CanvasNode[] = [
      { ...node('grp', 'group', { title: 'G' }, { x: 100, y: 100 }), selected: true },
      { ...node('a', 'text', { text: 'hi' }, { x: 10, y: 50 }), parentId: 'grp' },
      { ...node('b', 'gen-image', {}, { x: 300, y: 0 }), selected: true },
      node('c', 'image', {}, { x: 0, y: 500 }),
    ]
    const edges = [edge('a', 'out-text', 'b', 'in-text'), edge('c', 'out-image', 'b', 'in-image')]
    const clip = copySelection(nodes, edges)
    expect(clip.nodes.map(n => n.id)).toEqual(['grp', 'a', 'b'])
    expect(clip.edges).toHaveLength(1)
    let i = 0
    const p = pasteClip(clip, { x: 32, y: 32 }, () => `n${++i}`)
    const ids = p.nodes.map(n => n.id)
    expect(ids.some(id => ['grp', 'a', 'b'].includes(id))).toBe(false)
    const grp = p.nodes.find(n => n.type === 'group')!, a = p.nodes.find(n => n.type === 'text')!, b = p.nodes.find(n => n.type === 'gen-image')!
    expect(a.parentId).toBe(grp.id)
    expect(a.position).toEqual({ x: 10, y: 50 })
    expect(grp.position).toEqual({ x: 132, y: 132 })
    expect(b.position).toEqual({ x: 332, y: 32 })
    expect(p.edges[0]).toMatchObject({ source: a.id, target: b.id, sourceHandle: 'out-text' })
    expect(p.edges[0]!.id).not.toBe(edges[0]!.id)
  })

  it('child copied without its group becomes absolute', () => {
    const nodes: CanvasNode[] = [node('grp', 'group', {}, { x: 100, y: 100 }), { ...node('a', 'text', {}, { x: 10, y: 20 }), parentId: 'grp', selected: true }]
    const clip = copySelection(nodes, [])
    expect(clip.nodes[0]).toMatchObject({ position: { x: 110, y: 120 } })
    expect(clip.nodes[0]!.parentId).toBeUndefined()
  })
})

describe('group / ungroup', () => {
  it('round-trips absolute positions', () => {
    const nodes = [{ ...node('a', 'text', {}, { x: 100, y: 200 }), selected: true }, { ...node('b', 'text', {}, { x: 500, y: 260 }), selected: true }]
    const g = groupSelection(nodes, 'G') as CanvasNode[]
    expect(g[0]).toMatchObject({ id: 'G', type: 'group' })
    expect(g[1]!.parentId).toBe('G')
    const u = ungroupSelection(g.map(n => ({ ...n, selected: n.id === 'G' })))!
    expect(u.map(n => n.position)).toEqual([{ x: 100, y: 200 }, { x: 500, y: 260 }])
  })
})

describe('inputs assembly & mode decision', () => {
  const nodes = [
    node('t2', 'text', { text: '第二段' }, { x: 0, y: 300 }),
    node('t1', 'text', { text: '第一段' }, { x: 0, y: 0 }),
    node('empty', 'text', { text: '  ' }, { x: 0, y: 600 }),
    node('i1', 'image', { asset: img('a') }, { x: 0, y: 100 }),
    node('g0', 'gen-image', { results: [img('r0'), img('r1')], primary: 1 }, { x: 0, y: 200 }),
    node('g', 'gen-image', { prompt: '自己的描述' }),
  ]
  const edges = [
    edge('t2', 'out-text', 'g', 'in-text'), edge('t1', 'out-text', 'g', 'in-text'), edge('empty', 'out-text', 'g', 'in-text'),
    edge('i1', 'out-image', 'g', 'in-image'), edge('g0', 'out-image', 'g', 'in-image'),
  ]
  it('concatenates upstream texts in reading order then own prompt; primary result becomes a reference', () => {
    const r = assembleInputs('g', nodes, edges)
    expect(r.prompt).toBe('第一段\n第二段\n自己的描述')
    expect(r.references.map(x => x.id)).toEqual(['a', 'r1'])
  })
  it('no upstream images → text-to-image; with → image-to-image; model without refs ignores them', () => {
    expect(decideMode('image', [], { references: { maxImages: 15 } }).mode).toBe('text-to-image')
    expect(decideMode('image', [img('a')], { references: { maxImages: 15 } }).mode).toBe('image-to-image')
    expect(decideMode('image', [img('a')], { references: { maxImages: 0 } })).toMatchObject({ mode: 'text-to-image', ignored: 1 })
    expect(decideMode('image', [img('a'), img('b'), img('c')], { references: { maxImages: 2 } })).toMatchObject({ mode: 'image-to-image', ignored: 1 })
    expect(decideMode('video', [img('a')], { references: { maxImages: 0 } }).mode).toBe('text-to-video')
  })
})

const memKV = (): KV => {
  const m = new Map<string, unknown>()
  return { get: async k => structuredClone(m.get(k)) as never, set: async (k, v) => { m.set(k, structuredClone(v)) }, del: async k => { m.delete(k) } }
}

describe('local repo', () => {
  it('persists document round trip, rename, duplicate, remove/restore', async () => {
    const kv = memKV()
    const repo = createLocalRepo(kv, () => true)
    const p = await repo.create()
    expect(p.title).toBe('未命名画布')
    const nodes: CanvasNode[] = [{ ...node('grp', 'group', { title: 'G' }), width: 300, height: 200, selected: true }, { ...node('a', 'text', { text: 'x' }, { x: 5, y: 40 }), parentId: 'grp' }]
    const doc = toDocument(nodes, [edge('a', 'out-text', 'b', 'in-text')], { x: 1, y: 2, zoom: 0.5 })
    expect(doc.groups).toHaveLength(1)
    await repo.save(p.id, doc)

    const again = createLocalRepo(kv, () => true) // "reload"
    const got = (await again.get(p.id))!
    expect(got.document).toEqual(doc)
    const loaded = fromDocument(got.document)
    expect(loaded.nodes.map(n => n.id)).toEqual(['grp', 'a'])
    expect(loaded.nodes[0]!.selected).toBeUndefined()
    expect(got.meta.preview).toHaveLength(2)

    await again.rename(p.id, '  海报流程 ')
    expect((await again.list())[0]!.title).toBe('海报流程')
    const copy = (await again.duplicate(p.id))!
    expect(copy.title).toBe('海报流程 副本')
    expect((await again.get(copy.id))!.document).toEqual(doc)

    const removed = (await again.remove(p.id))!
    expect(await again.get(p.id)).toBeNull()
    await again.restore(removed)
    expect((await again.get(p.id))!.document).toEqual(doc)
    expect((await again.list()).map(m => m.id).sort()).toEqual([p.id, copy.id].sort())
    expect(await again.sync(p.id)).toBe('synced')
    expect(await createLocalRepo(kv, () => false).sync(p.id)).toBe('offline')
  })
})

describe('放到画布 detail', () => {
  const media = (id: string, kind = 'image', status = 'ready') => ({ id, kind, status, width: 800, height: 600, duration_ms: null, urls: { w480: `https://s/${id}/480`, w960: `https://s/${id}/960`, orig: `https://s/${id}` } })
  it('validates shapes defensively', () => {
    expect(parseCanvasAdd(null)).toBeNull()
    expect(parseCanvasAdd({ source: 'asset', assets: [] })).toBeNull()
    expect(parseCanvasAdd({ source: 'asset', assets: [{ id: 1 }, media('p', 'image', 'pending')] })).toBeNull()
    expect(parseCanvasAdd({ source: 'record', record_id: 'r', results: 'x' })).toBeNull()
    expect(parseCanvasAdd({ source: 'case', case_id: 'c', image: {} })).toBeNull()
    expect(parseCanvasAdd({ source: 'nope' })).toBeNull()
    // legacy shape without `source` from the assets/create views
    const legacy = parseCanvasAdd({ assets: [media('a'), { junk: true }] })
    expect(legacy).toMatchObject({ source: 'asset', assets: [{ id: 'a', urls: { orig: 'https://s/a' } }] })
    expect(parseCanvasAdd({ source: 'case', case_id: 'c', image: { url: 'u', width: 'x', height: 5 }, prompt: 7 }))
      .toEqual({ source: 'case', case_id: 'c', image: { url: 'u', width: null, height: 5 }, prompt: '' })
  })
  it('builds nodes per source around the centre', () => {
    let i = 0
    const id = () => `n${++i}`
    const a = buildCanvasAdd(parseCanvasAdd({ source: 'asset', assets: [media('a'), media('v', 'video')] })!, { x: 0, y: 0 }, id)
    expect(a.nodes.map(n => [n.type, n.data.asset?.asset_id, n.selected])).toEqual([['image', 'a', true], ['video', 'v', true]])
    expect(a.nodes[0]!.position.x).toBe(-(240 + 40 + 280) / 2)
    expect(a.edges).toEqual([])

    const r = buildCanvasAdd(parseCanvasAdd({ source: 'record', record_id: 'rec', results: [media('x'), media('y')], prompt: '猫', model: 'gpt-image-2', params: { n: 2 } })!, { x: 0, y: 0 }, id)
    expect(r.nodes.map(n => n.type)).toEqual(['text', 'gen-image'])
    expect(r.nodes[0]!.data.text).toBe('猫')
    expect(r.nodes[1]!.data).toMatchObject({ model: 'gpt-image-2', params: { n: 2 }, primary: 0, prompt: '', source: { record_id: 'rec' } })
    expect(r.nodes[1]!.data.results!.map(x => x.asset_id)).toEqual(['x', 'y'])
    expect(r.edges).toEqual([{ id: expect.any(String), source: r.nodes[0]!.id, sourceHandle: 'out-text', target: r.nodes[1]!.id, targetHandle: 'in-text' }])
    expect(assembleInputs(r.nodes[1]!.id, r.nodes, r.edges).prompt).toBe('猫')

    const c = buildCanvasAdd(parseCanvasAdd({ source: 'case', case_id: 'k', image: { url: 'https://c/1.jpg', width: 3, height: 4 }, prompt: '海报' })!, { x: 0, y: 0 }, id)
    expect(c.nodes.map(n => n.type)).toEqual(['image', 'text'])
    expect(c.nodes[0]!.data.asset).toMatchObject({ urls: { orig: 'https://c/1.jpg' } })
    expect(c.nodes[0]!.data.asset!.asset_id).toBeUndefined()
  })
})

describe('nested groups & reparenting', () => {
  // G1 (100,100) ⊃ G2 (at 50,60 → abs 150,160) ⊃ a (10,40 → abs 160,200); b top-level
  const base = (): CanvasNode[] => [
    { ...node('G1', 'group', {}, { x: 100, y: 100 }), width: 600, height: 500 },
    { ...node('G2', 'group', {}, { x: 50, y: 60 }), parentId: 'G1', width: 300, height: 300 },
    { ...node('a', 'text', {}, { x: 10, y: 40 }), parentId: 'G2' },
    node('b', 'text', {}, { x: 1000, y: 1000 }),
  ]
  const abs = (ns: CanvasNode[], id: string) => absolutePosition(ns.find(n => n.id === id)!, new Map(ns.map(n => [n.id, n])))

  it('absolute position walks every ancestor', () => {
    expect(abs(base(), 'a')).toEqual({ x: 160, y: 200 })
  })
  it('drag out of nested group to top level keeps absolute position', () => {
    const out = reparent(base(), ['a'], undefined)
    const a = out.find(n => n.id === 'a')!
    expect(a.parentId).toBeUndefined()
    expect(a.position).toEqual({ x: 160, y: 200 })
  })
  it('drag into a group: relative position, parents first, group grows to fit', () => {
    const ns = base().map(n => (n.id === 'b' ? { ...n, position: { x: 680, y: 200 } } : n))
    const out = reparent(ns, ['b'], 'G1')
    expect(out.map(n => n.id).indexOf('G1')).toBeLessThan(out.map(n => n.id).indexOf('b'))
    expect(abs(out, 'b')).toEqual({ x: 680, y: 200 })
    const g1 = out.find(n => n.id === 'G1')!
    expect(g1.width).toBeGreaterThanOrEqual(680 - 100 + 240 + 24)
    // growing leftwards shifts the group and compensates its children
    const left = reparent(base().map(n => (n.id === 'b' ? { ...n, position: { x: 90, y: 300 } } : n)), ['b'], 'G1')
    expect(abs(left, 'a')).toEqual({ x: 160, y: 200 })
    expect(abs(left, 'b')).toEqual({ x: 90, y: 300 })
  })
  it('drop target: deepest valid group; depth limit; never into itself', () => {
    const ns = base()
    expect(dropTarget(ns, ['b'], { x: 170, y: 210 })).toBe('G2')
    expect(dropTarget(ns, ['b'], { x: 650, y: 550 })).toBe('G1')
    expect(dropTarget(ns, ['b'], { x: 5000, y: 5000 })).toBeUndefined()
    const withGroup = [...ns, { ...node('G3', 'group', {}, { x: 2000, y: 0 }), width: 100, height: 100 }]
    // a group can go into G1 (level 2) but not into G2 (would be level 3)
    expect(dropTarget(withGroup, ['G3'], { x: 170, y: 210 })).toBe('G1')
    expect(dropTarget(ns, ['G1'], { x: 170, y: 210 })).toBeUndefined()
  })
  it('group selection respects depth; ungroup keeps absolute positions of nested children', () => {
    const sel = base().map(n => ({ ...n, selected: n.id === 'a' }))
    expect(groupSelection(sel, 'G4')).toMatch('嵌套')
    expect(groupSelection(base().map(n => ({ ...n, selected: n.id === 'G2' })), 'G0')).toMatch('嵌套')
    const withX = [...base(), { ...node('x', 'text', {}, { x: 400, y: 50 }), parentId: 'G1', selected: true }]
    const g = groupSelection(withX, 'G0') as CanvasNode[]
    expect(g.find(n => n.id === 'G0')!.parentId).toBe('G1')
    expect(g.map(n => n.id).indexOf('G0')).toBeLessThan(g.map(n => n.id).indexOf('x'))
    expect(abs(g, 'x')).toEqual({ x: 500, y: 150 })
    const u = ungroupSelection(base().map(n => ({ ...n, selected: n.id === 'G1' || n.id === 'G2' })))!
    expect(u.find(n => n.id === 'a')).toMatchObject({ position: { x: 160, y: 200 } })
    expect(u.find(n => n.id === 'a')!.parentId).toBeUndefined()
    const u2 = ungroupSelection(base().map(n => ({ ...n, selected: n.id === 'G2' })))!
    expect(u2.find(n => n.id === 'a')).toMatchObject({ parentId: 'G1', position: { x: 60, y: 100 } })
  })
  it('sortParentsFirst', () => {
    expect(sortParentsFirst([...base()].reverse()).map(n => n.id)).toEqual(['b', 'G1', 'G2', 'a'])
  })
})

describe('nudge', () => {
  it('moves unlocked selection roots; key bursts coalesce into one undo step', () => {
    const ns: CanvasNode[] = [
      { ...node('g', 'group', {}, { x: 0, y: 0 }), selected: true },
      { ...node('c', 'text', {}, { x: 5, y: 5 }), parentId: 'g', selected: true },
      { ...node('l', 'text', { locked: true }, { x: 9, y: 9 }), selected: true },
    ]
    const out = nudge(ns, 10, -1)!
    expect(out.map(n => n.position)).toEqual([{ x: 10, y: -1 }, { x: 5, y: 5 }, { x: 9, y: 9 }])
    expect(nudge(ns.map(n => ({ ...n, selected: false })), 1, 0)).toBeNull()
    let h = emptyHistory<number>()
    for (const t of [0, 50, 100, 350]) h = record(h, t, 'nudge', t, 300)
    expect(h.past).toEqual([0])
    h = record(h, 9, 'nudge', 700, 300) // 350ms gap → new step
    expect(h.past).toEqual([0, 9])
  })
})

describe('remote sync', () => {
  const doc = (text: string) => toDocument([node('t', 'text', { text })], [], { x: 0, y: 0, zoom: 1 })
  const setup = () => {
    let online = true
    const server = createMockServer(memKV(), () => online, 0)
    const kv = memKV()
    const repo = createSyncedRepo(createLocalRepo(kv, () => online), server.transport, () => online)
    return { repo, server, kv, setOnline: (v: boolean) => { online = v } }
  }

  it('a new project syncs with POST directly (no PUT → 404 first)', async () => {
    const server = createMockServer(memKV(), () => true, 0)
    const calls: string[] = []
    const repo = createSyncedRepo(createLocalRepo(memKV(), () => true), (m, path, body) => { calls.push(m); return server.transport(m, path, body) }, () => true)
    const p = await repo.create('A')
    expect(await repo.sync(p.id)).toBe('synced')
    await repo.save(p.id, doc('v2'))
    expect(await repo.sync(p.id)).toBe('synced')
    expect(calls).toEqual(['POST', 'PUT'])
  })

  it('create → POST, edit → PUT with revision; remote edit → 409 conflict → each resolution', async () => {
    const { repo, server, kv, setOnline } = setup()
    const p = await repo.create('A')
    await repo.save(p.id, doc('v1'))
    expect(await repo.sync(p.id)).toBe('synced')
    expect((await repo.get(p.id))!.meta).toMatchObject({ revision: 1, dirty: false })
    await repo.save(p.id, doc('v2'))
    expect(await repo.sync(p.id)).toBe('synced')
    expect((await repo.get(p.id))!.meta.revision).toBe(2)

    // concurrent edit elsewhere, then a local edit
    await server.simulateRemoteEdit(p.id)
    await repo.save(p.id, doc('mine'))
    const r = await repo.sync(p.id)
    expect(typeof r).toBe('object')
    const remote = (r as { conflict: any }).conflict
    expect(remote.meta.revision).toBe(3)
    expect(remote.document.nodes).toHaveLength(2)

    // 保留我的并覆盖远端
    await resolveConflict(repo, p.id, 'mine', remote)
    expect(await repo.sync(p.id)).toBe('synced')
    const after = (await repo.get(p.id))!
    expect(after.meta.revision).toBe(4)
    expect(after.document.nodes[0]!.data.text).toBe('mine')

    // 用远端覆盖本地
    await server.simulateRemoteEdit(p.id)
    await repo.save(p.id, doc('lost'))
    const r2 = (await repo.sync(p.id)) as { conflict: any }
    await resolveConflict(repo, p.id, 'remote', r2.conflict)
    const local = (await repo.get(p.id))!
    expect(local.meta).toMatchObject({ revision: 5, dirty: false })
    expect(local.document.nodes.map(n => n.data.text)).toEqual(['mine', '另一台设备上的改动'])

    // 另存为副本
    await server.simulateRemoteEdit(p.id)
    await repo.save(p.id, doc('copy me'))
    const r3 = (await repo.sync(p.id)) as { conflict: any }
    const copyId = (await resolveConflict(repo, p.id, 'copy', r3.conflict))!
    expect((await repo.get(copyId))!.document.nodes[0]!.data.text).toBe('copy me')
    expect((await repo.get(p.id))!.meta.revision).toBe(6)
    expect(await repo.sync(copyId)).toBe('synced')

    // another device (fresh local store) sees both
    const other = createSyncedRepo(createLocalRepo(memKV(), () => true), server.transport, () => true)
    expect((await other.list()).map(m => m.id).sort()).toEqual([p.id, copyId].sort())
    void kv; void setOnline
  })

  it('offline edits queue as dirty and flush when back online', async () => {
    const { repo, setOnline } = setup()
    const a = await repo.create('A'), b = await repo.create('B')
    setOnline(false)
    await repo.save(a.id, doc('offline a'))
    await repo.save(b.id, doc('offline b'))
    expect(await repo.sync(a.id)).toBe('offline')
    expect((await repo.list()).every(m => m.dirty)).toBe(true)
    setOnline(true)
    const res = await syncDirty(repo, a.id)
    expect(res).toEqual({ [b.id]: 'synced' })
    expect(await syncDirty(repo)).toEqual({ [a.id]: 'synced' })
    expect((await repo.list()).some(m => m.dirty)).toBe(false)
  })
})
