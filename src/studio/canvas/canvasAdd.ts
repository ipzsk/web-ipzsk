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
 * Receiver: useCanvasAddListener() in CanvasAddReceiver.tsx.
 */
import type { GenerationParams } from '@/shared/contracts'
import { DEFAULT_SIZE, assetRef, type AssetRef, type CanvasEdge, type CanvasNode, type MediaAssetLike, type NodeKind } from './graph'

export const CANVAS_ADD_EVENT = 'ipzsk:canvas-add'

export type CanvasAddDetail =
  | { source: 'asset'; assets: AssetRef[] }
  | { source: 'record'; record_id: string; results: AssetRef[]; prompt: string; model: string; params: GenerationParams }
  | { source: 'case'; case_id: string; image: { url: string; width: number | null; height: number | null }; prompt: string }

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const dim = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)

function parseAsset(a: unknown): AssetRef | null {
  if (!obj(a) || !str(a.id) || (a.kind !== 'image' && a.kind !== 'video') || !obj(a.urls) || !str(a.urls.orig)) return null
  if (a.status !== undefined && a.status !== 'ready') return null
  return assetRef({ ...(a as MediaAssetLike), width: dim(a.width), height: dim(a.height) })
}
const parseAssets = (xs: unknown) => (Array.isArray(xs) ? xs.map(parseAsset).filter((x): x is AssetRef => !!x) : [])

export function parseCanvasAdd(d: unknown): CanvasAddDetail | null {
  if (!obj(d)) return null
  if (d.source === 'asset' || (d.source === undefined && Array.isArray(d.assets))) {
    const assets = parseAssets(d.assets)
    return assets.length ? { source: 'asset', assets } : null
  }
  if (d.source === 'record') {
    const results = parseAssets(d.results)
    if (!str(d.record_id) || !results.length) return null
    return { source: 'record', record_id: d.record_id, results, prompt: str(d.prompt) ? d.prompt : '', model: str(d.model) ? d.model : '', params: obj(d.params) ? d.params : {} }
  }
  if (d.source === 'case') {
    if (!str(d.case_id) || !obj(d.image) || !str(d.image.url)) return null
    return { source: 'case', case_id: d.case_id, image: { url: d.image.url, width: dim(d.image.width), height: dim(d.image.height) }, prompt: str(d.prompt) ? d.prompt : '' }
  }
  return null
}

const GAP = 40

/** Nodes laid out left→right, centred on `center` (flow coords). New nodes are selected. */
export function buildCanvasAdd(d: CanvasAddDetail, center: { x: number; y: number }, newId: () => string = () => crypto.randomUUID()) {
  const items: { kind: NodeKind; data: CanvasNode['data'] }[] = []
  const edges: CanvasEdge[] = []
  if (d.source === 'asset') for (const a of d.assets) items.push({ kind: a.kind, data: { asset: a } })
  if (d.source === 'case') {
    items.push({ kind: 'image', data: { asset: { id: `case-${d.case_id}`, kind: 'image', width: d.image.width, height: d.image.height, urls: { orig: d.image.url } }, source: { case_id: d.case_id } } })
    if (d.prompt) items.push({ kind: 'text', data: { text: d.prompt } })
  }
  if (d.source === 'record') {
    const kind = d.results[0]!.kind === 'video' ? 'gen-video' : 'gen-image'
    items.push({ kind: 'text', data: { text: d.prompt } })
    // Own prompt stays empty: the connected text node supplies it, so re-running doesn't duplicate the text.
    items.push({ kind, data: { prompt: '', model: d.model, params: d.params, results: d.results, primary: 0, source: { record_id: d.record_id } } })
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
