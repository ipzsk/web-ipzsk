import type { Edge, Node, XYPosition } from '@xyflow/react'
import type { GenerationParams, ModelSpec } from '@/shared/contracts'

/** Pure canvas graph logic (§2.7). No React, no storage — everything here is unit-tested. */

export type NodeKind = 'text' | 'image' | 'video' | 'gen-image' | 'gen-video' | 'group'
export type PortType = 'text' | 'image' | 'video'

/**
 * Media reference inside a node (§8.6「节点里的媒体只存 media_assets.id」).
 * `asset_id` is set for real media_assets; local uploads / mock / case images only have `urls`.
 * `urls` is the payload cached when the node was created (signed URLs expire — see useAssetUrls TODO).
 * `id` is a stable local key (= asset_id when present).
 */
export interface AssetRef {
  id: string
  asset_id?: string
  kind: 'image' | 'video'
  width: number | null
  height: number | null
  urls: { w480?: string; w960?: string; orig: string; poster?: string }
}

export type GenMode = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'

/** Loose MediaAsset (media/types and shared/contracts differ on `poster`). */
export interface MediaAssetLike {
  id: string
  kind: 'image' | 'video'
  width: number | null
  height: number | null
  urls: { w480?: string; w960?: string; orig: string; poster?: string }
  poster?: { urls?: { w960?: string; orig?: string } } | null
}

export function assetRef(a: MediaAssetLike): AssetRef {
  const poster = a.urls.poster ?? a.poster?.urls?.w960 ?? a.poster?.urls?.orig
  return {
    id: a.id, asset_id: a.id, kind: a.kind, width: a.width, height: a.height,
    urls: { orig: a.urls.orig, ...(a.urls.w480 ? { w480: a.urls.w480 } : {}), ...(a.urls.w960 ? { w960: a.urls.w960 } : {}), ...(poster ? { poster } : {}) },
  }
}

export interface CanvasNodeData extends Record<string, unknown> {
  locked?: boolean
  text?: string // text
  asset?: AssetRef // image / video
  name?: string
  prompt?: string // gen-*
  model?: string
  params?: GenerationParams
  results?: AssetRef[]
  primary?: number
  lastMode?: GenMode
  title?: string // group
  source?: { record_id?: string; case_id?: string } // 放到画布 provenance
}

export type CanvasNode = Node<CanvasNodeData, NodeKind>
export type CanvasEdge = Edge

export interface CanvasDocument {
  version: 1
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  groups: CanvasNode[]
  viewport: { x: number; y: number; zoom: number }
}

export const PORTS: Record<NodeKind, { inputs: PortType[]; output?: PortType }> = {
  text: { inputs: [], output: 'text' },
  image: { inputs: [], output: 'image' },
  video: { inputs: [], output: 'video' },
  'gen-image': { inputs: ['text', 'image'], output: 'image' },
  'gen-video': { inputs: ['text', 'image'], output: 'video' },
  group: { inputs: [] },
}

export const PORT_LABEL: Record<PortType, string> = { text: '文本', image: '图片', video: '视频' }
export const NODE_LABEL: Record<NodeKind, string> = {
  text: '文本', image: '图片', video: '视频', 'gen-image': '生成·图片', 'gen-video': '生成·视频', group: '编组',
}
export const DEFAULT_SIZE: Record<NodeKind, { w: number; h: number }> = {
  text: { w: 240, h: 140 }, image: { w: 240, h: 240 }, video: { w: 280, h: 180 },
  'gen-image': { w: 280, h: 260 }, 'gen-video': { w: 280, h: 240 }, group: { w: 480, h: 320 },
}

export const handleId = (dir: 'in' | 'out', t: PortType) => `${dir}-${t}`
export const parseHandle = (h?: string | null): { dir: 'in' | 'out'; type: PortType } | null => {
  const m = h?.match(/^(in|out)-(text|image|video)$/)
  return m ? { dir: m[1] as 'in' | 'out', type: m[2] as PortType } : null
}

interface Conn { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }

/** null = valid; otherwise the Chinese reason shown to the user. */
export function connectionError(c: Conn, nodes: CanvasNode[], edges: CanvasEdge[]): string | null {
  const s = parseHandle(c.sourceHandle), t = parseHandle(c.targetHandle)
  if (!s || !t || s.dir !== 'out' || t.dir !== 'in') return '只能从输出端口连到输入端口'
  if (c.source === c.target) return '不能连到节点自己'
  const src = nodes.find(n => n.id === c.source), tgt = nodes.find(n => n.id === c.target)
  if (!src || !tgt) return '节点不存在'
  if (PORTS[src.type!].output !== s.type || !PORTS[tgt.type!].inputs.includes(t.type)) return '端口不存在'
  if (s.type !== t.type) return `${PORT_LABEL[s.type]}输出不能接到${PORT_LABEL[t.type]}输入`
  if (edges.some(e => e.source === c.source && e.target === c.target && e.targetHandle === c.targetHandle)) return '这两个端口已经连着了'
  // Cycle: does target already reach source?
  const seen = new Set<string>(), stack = [c.target]
  while (stack.length) {
    const id = stack.pop()!
    if (id === c.source) return '会形成循环，生成链路必须单向'
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of edges) if (e.source === id) stack.push(e.target)
  }
  return null
}

/** Node kinds that can be attached to a dangling connection (「接一个什么节点」). */
export function kindsForDangling(from: { dir: 'in' | 'out'; type: PortType }): NodeKind[] {
  return (Object.keys(PORTS) as NodeKind[]).filter(k =>
    from.dir === 'out' ? PORTS[k].inputs.includes(from.type) : PORTS[k].output === from.type)
}

/** What a node passes downstream. */
export function outputOf(n: CanvasNode): { text?: string; asset?: AssetRef } {
  if (n.type === 'text') return { text: n.data.text?.trim() || undefined }
  if (n.type === 'image' || n.type === 'video') return { asset: n.data.asset }
  if (n.type === 'gen-image' || n.type === 'gen-video') return { asset: n.data.results?.[n.data.primary ?? 0] }
  return {}
}

/** Upstream texts are concatenated in reading order (top→bottom, left→right), then the node's own prompt. */
export function assembleInputs(nodeId: string, nodes: CanvasNode[], edges: CanvasEdge[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const self = byId.get(nodeId)
  const incoming = edges.filter(e => e.target === nodeId)
    .map(e => ({ e, n: byId.get(e.source) }))
    .filter((x): x is { e: CanvasEdge; n: CanvasNode } => !!x.n)
    .sort((a, b) => absolutePosition(a.n, byId).y - absolutePosition(b.n, byId).y || absolutePosition(a.n, byId).x - absolutePosition(b.n, byId).x)
  const texts: string[] = []
  const references: AssetRef[] = []
  for (const { e, n } of incoming) {
    const out = outputOf(n)
    if (e.targetHandle === 'in-text' && out.text) texts.push(out.text)
    if (e.targetHandle === 'in-image' && out.asset?.kind === 'image' && !references.some(r => r.id === out.asset!.id)) references.push(out.asset)
  }
  const own = self?.data.prompt?.trim()
  const prompt = [...texts, ...(own ? [own] : [])].join('\n')
  return { texts, references, prompt }
}

/** §2.2 rule, decided only at submit time. References beyond the model's capability are dropped, never deleted from the graph. */
export function decideMode(kind: 'image' | 'video', references: AssetRef[], model: Pick<ModelSpec, 'references'> | undefined) {
  const max = model?.references?.max ?? 0
  const used = references.slice(0, max)
  const mode: GenMode = kind === 'image'
    ? (used.length ? 'image-to-image' : 'text-to-image')
    : (used.length ? 'image-to-video' : 'text-to-video')
  const ignored = references.length - used.length
  return { mode, references: used, ignored }
}

export const MODE_LABEL: Record<GenMode, string> = {
  'text-to-image': '文生图', 'image-to-image': '图生图', 'text-to-video': '文生视频', 'image-to-video': '图生视频',
}

// ---------- geometry ----------

export const sizeOf = (n: CanvasNode) => ({
  w: n.measured?.width ?? n.width ?? DEFAULT_SIZE[n.type!].w,
  h: n.measured?.height ?? n.height ?? DEFAULT_SIZE[n.type!].h,
})

export function absolutePosition(n: CanvasNode, byId: Map<string, CanvasNode>): XYPosition {
  let x = n.position.x, y = n.position.y
  const seen = new Set([n.id])
  for (let p = n.parentId ? byId.get(n.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
    seen.add(p.id)
    x += p.position.x
    y += p.position.y
  }
  return { x, y }
}

export function previewBoxes(nodes: CanvasNode[], max = 80) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return nodes.slice(0, max).map(n => {
    const p = absolutePosition(n, byId), s = sizeOf(n)
    return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(s.w), h: Math.round(s.h), kind: n.type! }
  })
}

/**
 * Alignment guides for a dragged rect vs other rects: snaps an edge/center within `threshold` and
 * returns guide lines (flow coords). ponytail: O(n) per drag frame, fine to ~1k nodes; bucket by viewport if more.
 */
export function alignGuides(r: { x: number; y: number; w: number; h: number }, others: { x: number; y: number; w: number; h: number }[], threshold = 6) {
  let bestX: { d: number; x: number; line: number } | undefined
  let bestY: { d: number; y: number; line: number } | undefined
  const xs = [0, r.w / 2, r.w], ys = [0, r.h / 2, r.h]
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const dx of xs) {
      const d = Math.abs(r.x + dx - ox)
      if (d <= threshold && (!bestX || d < bestX.d)) bestX = { d, x: ox - dx, line: ox }
    }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const dy of ys) {
      const d = Math.abs(r.y + dy - oy)
      if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, y: oy - dy, line: oy }
    }
  }
  return { x: bestX?.x, y: bestY?.y, vertical: bestX?.line, horizontal: bestY?.line }
}

// ---------- clipboard ----------

export interface Clip { nodes: CanvasNode[]; edges: CanvasEdge[] }

const strip = (n: CanvasNode): CanvasNode => {
  const { selected: _s, dragging: _d, ...rest } = n
  return rest
}

/** Selected nodes + children of selected groups; only edges with both ends inside. Orphaned children become absolute. */
export function copySelection(nodes: CanvasNode[], edges: CanvasEdge[]): Clip {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const ids = new Set(nodes.filter(n => n.selected).map(n => n.id))
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id)
  const picked = nodes.filter(n => ids.has(n.id)).map(n => {
    if (n.parentId && !ids.has(n.parentId)) {
      const { parentId: _p, extent: _e, ...rest } = n
      return strip({ ...rest, position: absolutePosition(n, byId) })
    }
    return strip(n)
  })
  return { nodes: structuredClone(sortParentsFirst(picked)), edges: structuredClone(edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(({ selected: _s, ...e }) => e)) }
}

export function pasteClip(clip: Clip, offset: XYPosition, newId: () => string = () => crypto.randomUUID()): Clip {
  const map = new Map(clip.nodes.map(n => [n.id, newId()]))
  const nodes = clip.nodes.map(n => ({
    ...structuredClone(n),
    id: map.get(n.id)!,
    parentId: n.parentId ? map.get(n.parentId) : undefined,
    position: n.parentId ? n.position : { x: n.position.x + offset.x, y: n.position.y + offset.y },
    selected: true,
  }))
  for (const n of nodes) if (!n.parentId) delete n.parentId
  const edges = clip.edges.map(e => ({
    ...structuredClone(e), id: newId(), source: map.get(e.source)!, target: map.get(e.target)!, selected: false,
  }))
  return { nodes, edges }
}

// ---------- groups (nested up to MAX_GROUP_DEPTH levels) ----------

export const GROUP_PAD = 24
export const GROUP_TITLE = 36
export const MAX_GROUP_DEPTH = 2

const indexById = (nodes: CanvasNode[]) => new Map(nodes.map(n => [n.id, n]))

/** React Flow requires a parent to appear before its children. Stable otherwise. */
export function sortParentsFirst(nodes: CanvasNode[]): CanvasNode[] {
  const byId = indexById(nodes)
  const done = new Set<string>(), out: CanvasNode[] = []
  const visit = (n: CanvasNode) => {
    if (done.has(n.id)) return
    done.add(n.id)
    const p = n.parentId ? byId.get(n.parentId) : undefined
    if (p) visit(p)
    out.push(n)
  }
  nodes.forEach(visit)
  return out
}

/** Number of group ancestors. */
function ancestorCount(n: CanvasNode, byId: Map<string, CanvasNode>) {
  let d = 0
  for (let p = n.parentId ? byId.get(n.parentId) : undefined; p && d < 50; p = p.parentId ? byId.get(p.parentId) : undefined) d++
  return d
}

/** Group levels inside the subtree rooted at `id` (a group = 1 + deepest child group; a plain node = 0). */
function groupHeight(id: string, nodes: CanvasNode[]): number {
  const n = nodes.find(x => x.id === id)
  if (n?.type !== 'group') return 0
  return 1 + Math.max(0, ...nodes.filter(c => c.parentId === id).map(c => groupHeight(c.id, nodes)))
}

const isInside = (n: CanvasNode, ids: Set<string>, byId: Map<string, CanvasNode>) => {
  for (let p = n.parentId ? byId.get(n.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (ids.has(p.id)) return true
  return false
}

/** Selected nodes whose ancestors aren't selected (moving/grouping those moves the rest). */
export function selectionRoots(nodes: CanvasNode[], ids = new Set(nodes.filter(n => n.selected).map(n => n.id))) {
  const byId = indexById(nodes)
  return nodes.filter(n => ids.has(n.id) && !isInside(n, ids, byId))
}

/** New node array, or a Chinese reason why the selection can't be grouped. */
export function groupSelection(nodes: CanvasNode[], groupId: string): CanvasNode[] | string {
  const byId = indexById(nodes)
  const members = selectionRoots(nodes)
  if (!members.length) return '先选中要编组的节点'
  const parentId = members[0]!.parentId
  if (members.some(m => m.parentId !== parentId)) return '选中的节点在不同编组里，先把它们移到同一层'
  const parent = parentId ? byId.get(parentId) : undefined
  const depth = (parent ? ancestorCount(parent, byId) + 1 : 0) + 1 + Math.max(0, ...members.map(m => groupHeight(m.id, nodes)))
  if (depth > MAX_GROUP_DEPTH) return `编组最多嵌套 ${MAX_GROUP_DEPTH} 层`
  // Positions are relative to the shared parent, so the box math stays in that space.
  const boxes = members.map(n => ({ p: n.position, s: sizeOf(n) }))
  const x = Math.min(...boxes.map(b => b.p.x)) - GROUP_PAD
  const y = Math.min(...boxes.map(b => b.p.y)) - GROUP_PAD - GROUP_TITLE
  const w = Math.max(...boxes.map(b => b.p.x + b.s.w)) - x + GROUP_PAD
  const h = Math.max(...boxes.map(b => b.p.y + b.s.h)) - y + GROUP_PAD
  const memberIds = new Set(members.map(m => m.id))
  const group: CanvasNode = { id: groupId, type: 'group', position: { x, y }, width: w, height: h, data: { title: '编组' }, selected: true, ...(parentId ? { parentId } : {}) }
  return sortParentsFirst([
    group,
    ...nodes.map(n => memberIds.has(n.id)
      ? { ...n, parentId: groupId, position: { x: n.position.x - x, y: n.position.y - y }, selected: false }
      : { ...n, selected: false }),
  ])
}

/** Removes selected groups; children keep their absolute position and move up to the nearest surviving ancestor. */
export function ungroupSelection(nodes: CanvasNode[]): CanvasNode[] | null {
  const byId = indexById(nodes)
  const removed = new Set(nodes.filter(n => n.type === 'group' && n.selected && !n.data.locked).map(g => g.id))
  if (!removed.size) return null
  return nodes.filter(n => !removed.has(n.id)).map(n => {
    if (!n.parentId || !removed.has(n.parentId)) return n
    let p = byId.get(n.parentId)
    while (p && removed.has(p.id)) p = p.parentId ? byId.get(p.parentId) : undefined
    const abs = absolutePosition(n, byId), base = p ? absolutePosition(p, byId) : { x: 0, y: 0 }
    const { parentId: _p, ...rest } = n
    return { ...rest, ...(p ? { parentId: p.id } : {}), position: { x: abs.x - base.x, y: abs.y - base.y }, selected: true }
  })
}

/**
 * Deepest group containing `point` (absolute) that the dragged nodes may enter: not one of them, not inside them,
 * and within MAX_GROUP_DEPTH. undefined = top level.
 */
export function dropTarget(nodes: CanvasNode[], draggedIds: string[], point: XYPosition): string | undefined {
  const byId = indexById(nodes)
  const dragged = new Set(draggedIds)
  const roots = selectionRoots(nodes, dragged)
  const height = Math.max(0, ...roots.map(r => groupHeight(r.id, nodes)))
  let best: { id: string; depth: number } | undefined
  for (const g of nodes) {
    if (g.type !== 'group' || dragged.has(g.id) || isInside(g, dragged, byId)) continue
    const p = absolutePosition(g, byId), s = sizeOf(g)
    if (point.x < p.x || point.y < p.y || point.x > p.x + s.w || point.y > p.y + s.h) continue
    const depth = ancestorCount(g, byId)
    if (depth + 1 + height > MAX_GROUP_DEPTH) continue
    if (!best || depth > best.depth) best = { id: g.id, depth }
  }
  return best?.id
}

/** Moves `ids` under `parentId` (or top level) keeping absolute positions; the target group grows to fit them. */
export function reparent(nodes: CanvasNode[], ids: string[], parentId: string | undefined): CanvasNode[] {
  const byId = indexById(nodes)
  const move = new Set(ids)
  const target = parentId ? byId.get(parentId) : undefined
  const base = target ? absolutePosition(target, byId) : { x: 0, y: 0 }
  let out = nodes.map(n => {
    if (!move.has(n.id)) return n
    const abs = absolutePosition(n, byId)
    const { parentId: _p, extent: _e, ...rest } = n
    return { ...rest, ...(target ? { parentId: target.id } : {}), position: { x: abs.x - base.x, y: abs.y - base.y } }
  })
  if (target) {
    // ponytail: only the direct target grows; an enlarged nested group may overhang its own parent.
    const kids = out.filter(n => n.parentId === target.id)
    const s = sizeOf(target)
    const minX = Math.min(0, ...kids.map(k => k.position.x - GROUP_PAD))
    const minY = Math.min(0, ...kids.map(k => k.position.y - GROUP_PAD - GROUP_TITLE))
    const maxX = Math.max(s.w, ...kids.map(k => k.position.x + sizeOf(k).w + GROUP_PAD))
    const maxY = Math.max(s.h, ...kids.map(k => k.position.y + sizeOf(k).h + GROUP_PAD))
    out = out.map(n => n.id === target.id
      ? { ...n, position: { x: n.position.x + minX, y: n.position.y + minY }, width: maxX - minX, height: maxY - minY }
      : n.parentId === target.id ? { ...n, position: { x: n.position.x - minX, y: n.position.y - minY } } : n)
  }
  return sortParentsFirst(out)
}

/** Arrow-key nudge: moves selection roots that aren't locked. null when nothing moves. */
export function nudge(nodes: CanvasNode[], dx: number, dy: number): CanvasNode[] | null {
  const ids = new Set(selectionRoots(nodes).filter(n => !n.data.locked).map(n => n.id))
  if (!ids.size) return null
  return nodes.map(n => (ids.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n))
}

/** Ids to delete: selected (unlocked) nodes + their children. */
export function deletionSet(nodes: CanvasNode[]) {
  const ids = new Set(nodes.filter(n => n.selected && !n.data.locked).map(n => n.id))
  for (const n of nodes) if (n.parentId && ids.has(n.parentId)) ids.add(n.id)
  return ids
}

// ---------- document ----------

export function toDocument(nodes: CanvasNode[], edges: CanvasEdge[], viewport: CanvasDocument['viewport']): CanvasDocument {
  const clean = nodes.map(strip)
  return {
    version: 1,
    groups: clean.filter(n => n.type === 'group'),
    nodes: clean.filter(n => n.type !== 'group'),
    edges: edges.map(({ selected: _s, ...e }) => e),
    viewport,
  }
}

export const fromDocument = (doc: CanvasDocument) => ({ nodes: sortParentsFirst([...doc.groups, ...doc.nodes]), edges: doc.edges, viewport: doc.viewport })

export const emptyDocument = (): CanvasDocument => ({ version: 1, nodes: [], edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
