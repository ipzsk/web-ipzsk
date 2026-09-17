import type { Edge, Node, XYPosition } from '@xyflow/react'
import type { GenerationParams, ModelSpec } from '@/shared/contracts'

/** Pure canvas graph logic (§2.7). No React, no storage — everything here is unit-tested. */

export type NodeKind = 'text' | 'image' | 'video' | 'gen-image' | 'gen-video' | 'group'
export type PortType = 'text' | 'image' | 'video'

/** Media reference inside a node. Backend version stores only `id` (§8.6); urls are resolved at render time. */
export interface AssetRef {
  id: string
  kind: 'image' | 'video'
  width: number | null
  height: number | null
  urls: { w480?: string; w960?: string; orig: string; poster?: string }
}

export type GenMode = 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'

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
  const p = n.parentId ? byId.get(n.parentId) : undefined
  return p ? { x: p.position.x + n.position.x, y: p.position.y + n.position.y } : n.position
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
  // parents first, React Flow requires it
  picked.sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
  return { nodes: structuredClone(picked), edges: structuredClone(edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(({ selected: _s, ...e }) => e)) }
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

// ---------- groups (one level; nested groups are flattened) ----------

export const GROUP_PAD = 24
export const GROUP_TITLE = 36

export function groupSelection(nodes: CanvasNode[], groupId: string): CanvasNode[] | null {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const members = nodes.filter(n => n.selected && n.type !== 'group' && !n.parentId)
  if (members.length < 1) return null
  const boxes = members.map(n => ({ p: absolutePosition(n, byId), s: sizeOf(n) }))
  const x = Math.min(...boxes.map(b => b.p.x)) - GROUP_PAD
  const y = Math.min(...boxes.map(b => b.p.y)) - GROUP_PAD - GROUP_TITLE
  const w = Math.max(...boxes.map(b => b.p.x + b.s.w)) - x + GROUP_PAD
  const h = Math.max(...boxes.map(b => b.p.y + b.s.h)) - y + GROUP_PAD
  const memberIds = new Set(members.map(m => m.id))
  const group: CanvasNode = { id: groupId, type: 'group', position: { x, y }, width: w, height: h, data: { title: '编组' }, selected: true }
  return [
    group,
    ...nodes.map(n => memberIds.has(n.id)
      ? { ...n, parentId: groupId, position: { x: n.position.x - x, y: n.position.y - y }, selected: false }
      : { ...n, selected: false }),
  ]
}

export function ungroupSelection(nodes: CanvasNode[]): CanvasNode[] | null {
  const groups = new Map(nodes.filter(n => n.type === 'group' && n.selected).map(g => [g.id, g]))
  if (!groups.size) return null
  return nodes.filter(n => !groups.has(n.id)).map(n => {
    const g = n.parentId ? groups.get(n.parentId) : undefined
    if (!g) return n
    const { parentId: _p, ...rest } = n
    return { ...rest, position: { x: g.position.x + n.position.x, y: g.position.y + n.position.y }, selected: true }
  })
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

export const fromDocument = (doc: CanvasDocument) => ({ nodes: [...doc.groups, ...doc.nodes], edges: doc.edges, viewport: doc.viewport })

export const emptyDocument = (): CanvasDocument => ({ version: 1, nodes: [], edges: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 } })
