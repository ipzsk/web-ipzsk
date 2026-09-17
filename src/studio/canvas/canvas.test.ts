import { describe, expect, it } from 'vitest'
import {
  assembleInputs, connectionError, copySelection, decideMode, fromDocument, groupSelection, pasteClip, toDocument, ungroupSelection,
  type AssetRef, type CanvasEdge, type CanvasNode, type NodeKind,
} from './graph'
import { emptyHistory, record, redo, undo, HISTORY_LIMIT } from './history'
import { createLocalRepo, type KV } from './repo'

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
    const g = groupSelection(nodes, 'G')!
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
    expect(decideMode('image', [], { references: { max: 15 } }).mode).toBe('text-to-image')
    expect(decideMode('image', [img('a')], { references: { max: 15 } }).mode).toBe('image-to-image')
    expect(decideMode('image', [img('a')], {})).toMatchObject({ mode: 'text-to-image', ignored: 1 })
    expect(decideMode('image', [img('a'), img('b'), img('c')], { references: { max: 2 } })).toMatchObject({ mode: 'image-to-image', ignored: 1 })
    expect(decideMode('video', [img('a')], {}).mode).toBe('text-to-video')
  })
})

describe('local repo', () => {
  const memKV = (): KV => {
    const m = new Map<string, unknown>()
    return { get: async k => structuredClone(m.get(k)) as never, set: async (k, v) => { m.set(k, structuredClone(v)) }, del: async k => { m.delete(k) } }
  }
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
