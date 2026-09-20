/**
 * 「放到画布」 — window CustomEvent `ipzsk:canvas-add`. Detail shapes (validated defensively; anything else is ignored with a toast):
 *
 *   { source: 'asset', assets: MediaAsset[] }                                      assets view  (`source` may be omitted)
 *     → one image / video node per ready asset.
 *   { source: 'record', record_id, results: MediaAsset[], prompt, model, params }  create view
 *     → text node (prompt) ─text→ generation node (model/params, results, marked done).
 *   { source: 'case', case_id, image: { url, width, height }, prompt }             inspiration
 *     → image node (url only, no asset id) + text node with the prompt.
 *
 * Shapes + validation live in @/shared/events (CanvasAddDetail / parseCanvasAdd); this file only lays out nodes.
 * Receiver: useCanvasAddListener() in CanvasAddReceiver.tsx.
 */
import type { CanvasAddDetail } from '@/shared/events'
import { DEFAULT_SIZE, assetRef, type CanvasEdge, type CanvasNode, type NodeKind } from './graph'

const GAP = 40

/** Nodes laid out left→right, centred on `center` (flow coords). New nodes are selected. */
export function buildCanvasAdd(d: CanvasAddDetail, center: { x: number; y: number }, newId: () => string = () => crypto.randomUUID()) {
  const items: { kind: NodeKind; data: CanvasNode['data'] }[] = []
  const edges: CanvasEdge[] = []
  if (d.source === 'asset') for (const a of d.assets) if (a.kind !== 'audio') items.push({ kind: a.kind, data: { asset: assetRef({ ...a, kind: a.kind }) } })
  if (d.source === 'case') {
    items.push({ kind: 'image', data: { asset: { id: `case-${d.case_id}`, kind: 'image', width: d.image.width, height: d.image.height, urls: { orig: d.image.url } }, source: { case_id: d.case_id } } })
    if (d.prompt) items.push({ kind: 'text', data: { text: d.prompt } })
  }
  if (d.source === 'record') {
    const kind = d.results[0]!.kind === 'video' ? 'gen-video' : 'gen-image'
    items.push({ kind: 'text', data: { text: d.prompt } })
    // Own prompt stays empty: the connected text node supplies it, so re-running doesn't duplicate the text.
    items.push({ kind, data: { prompt: '', model: d.model, params: d.params, results: d.results.flatMap(a => a.kind === 'audio' ? [] : [assetRef({ ...a, kind: a.kind })]), primary: 0, source: { record_id: d.record_id } } })
  }
  const total = items.reduce((w, it) => w + DEFAULT_SIZE[it.kind].w, 0) + GAP * (items.length - 1)
  let x = center.x - total / 2
  const nodes: CanvasNode[] = items.map(it => {
    const s = DEFAULT_SIZE[it.kind]
    const n: CanvasNode = { id: newId(), type: it.kind, selected: true, position: { x: Math.round(x), y: Math.round(center.y - s.h / 2) }, data: it.data }
    x += s.w + GAP
    return n
  })
  if (d.source === 'record') edges.push({ id: newId(), source: nodes[0]!.id, sourceHandle: 'out-text', target: nodes[1]!.id, targetHandle: 'in-text' })
  return { nodes, edges }
}
