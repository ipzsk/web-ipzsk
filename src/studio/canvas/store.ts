import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type XYPosition } from '@xyflow/react'
import { toast } from '@/ui'
import { validateFile } from '@/media'
import {
  DEFAULT_SIZE, NODE_LABEL, alignGuides, assembleInputs, connectionError, copySelection, decideMode, deletionSet, fromDocument,
  groupSelection, pasteClip, sizeOf, toDocument, ungroupSelection,
  type CanvasEdge, type CanvasNode, type CanvasNodeData, type Clip, type NodeKind,
} from './graph'
import { emptyHistory, record, redo, undo, type History } from './history'
import { canvasRepo } from './repo'
import { defaultParams, findModel, mockGenerate, mockUpload, modelsFor, readImageSize, resolveUrl, seedResolved } from './mock'

type Snap = { nodes: CanvasNode[]; edges: CanvasEdge[] }
export type RunState = { status: 'running' | 'uploading' | 'failed'; progress: number; error?: string }
export type SyncStatus = 'saved' | 'saving' | 'offline'

interface CanvasState extends Snap {
  projectId: string | null
  title: string
  missing: boolean
  viewport: { x: number; y: number; zoom: number }
  history: History<Snap>
  runs: Record<string, RunState>
  status: SyncStatus
  dragging: boolean
  guides: { vertical?: number; horizontal?: number }
}

const initial = (): Omit<CanvasState, 'projectId'> => ({
  title: '', missing: false, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  history: emptyHistory(), runs: {}, status: 'saved', dragging: false, guides: {},
})

export const useCanvas = create<CanvasState>(() => ({ projectId: null, ...initial() }))
const get = useCanvas.getState
const set = useCanvas.setState
const snap = (): Snap => ({ nodes: get().nodes, edges: get().edges })

// ---------- persistence ----------

let writeTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setTimeout> | undefined
let pendingWrite: Promise<void> = Promise.resolve()
const online = () => navigator.onLine

function writeNow() {
  clearTimeout(writeTimer)
  const { projectId, nodes, edges, viewport } = get()
  if (!projectId) return pendingWrite
  const doc = toDocument(nodes, edges, viewport)
  pendingWrite = pendingWrite.then(() => canvasRepo.save(projectId, doc)).catch(() => {
    toast({ title: '本地保存失败', description: '浏览器存储不可用或已满，请导出或清理空间后重试', tone: 'error' })
  })
  return pendingWrite
}

async function syncNow() {
  const id = get().projectId
  if (!id) return
  await writeNow()
  const r = await canvasRepo.sync(id)
  if (get().projectId !== id) return
  set({ status: r === 'synced' ? 'saved' : 'offline' })
}

/** Local write within ~100ms of a change; "sync" 1.5s after the last change (§2.7). */
function markDirty(silent = false) {
  if (!get().projectId) return
  if (!silent) set({ status: online() ? 'saving' : 'offline' })
  if (get().dragging) return
  clearTimeout(writeTimer)
  writeTimer = setTimeout(writeNow, 100)
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, 1500)
}

if (typeof window !== 'undefined') window.addEventListener('online', () => { if (get().status === 'offline') markDirty() })

export async function loadProject(id: string) {
  await flush()
  set({ projectId: id, ...initial() })
  const p = await canvasRepo.get(id)
  if (get().projectId !== id) return
  if (!p) { set({ missing: true }); return }
  const { nodes, edges, viewport } = fromDocument(p.document)
  set({ title: p.meta.title, nodes, edges, viewport })
}

export async function flush() {
  if (!get().projectId) return
  clearTimeout(syncTimer)
  await writeNow()
}

export function setViewport(viewport: CanvasState['viewport']) {
  set({ viewport })
  markDirty(true)
}

export async function renameProject(title: string) {
  const id = get().projectId
  if (!id) return
  set({ title: title.trim() || '未命名画布' })
  await canvasRepo.rename(id, title)
}

// ---------- history-aware mutations ----------

export function mutate(recipe: (s: Snap) => Partial<Snap> | null | undefined, key?: string) {
  const before = snap()
  const next = recipe(before)
  if (!next) return false
  set({ ...next, history: record(get().history, before, key) })
  markDirty()
  return true
}

/** Writes results/uploads into the node in the live graph *and* every history snapshot, so undo never drops a finished generation. */
function patchEverywhere(id: string, patch: Partial<CanvasNodeData>) {
  const fix = (s: Snap): Snap => ({ ...s, nodes: s.nodes.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) })
  const { history } = get()
  set({ ...fix(snap()), history: { ...history, past: history.past.map(fix), future: history.future.map(fix) } })
  markDirty()
}

export const undoAction = () => {
  const r = undo(get().history, snap())
  if (!r) return
  set({ history: r[0], ...r[1] })
  markDirty()
}
export const redoAction = () => {
  const r = redo(get().history, snap())
  if (!r) return
  set({ history: r[0], ...r[1] })
  markDirty()
}

export function onNodesChange(changes: NodeChange<CanvasNode>[]) {
  const s = get()
  let dirty = false
  if (s.dragging && changes.length === 1 && changes[0]!.type === 'position' && changes[0]!.position) {
    const c = changes[0]!
    const n = s.nodes.find(x => x.id === c.id)
    if (n && !n.parentId) {
      const size = sizeOf(n)
      // ponytail: guides compare against all top-level nodes; restrict to viewport if >1k nodes.
      const others = s.nodes.filter(o => o.id !== n.id && !o.parentId).map(o => ({ ...o.position, ...sizeOf(o) }))
      const g = alignGuides({ ...c.position!, w: size.w, h: size.h }, others)
      c.position = { x: g.x ?? c.position!.x, y: g.y ?? c.position!.y }
      if (g.vertical !== s.guides.vertical || g.horizontal !== s.guides.horizontal) set({ guides: { vertical: g.vertical, horizontal: g.horizontal } })
    }
  }
  for (const c of changes) if (c.type === 'position' || (c.type === 'dimensions' && c.resizing)) dirty = true
  set({ nodes: applyNodeChanges(changes, s.nodes) })
  if (dirty && !s.dragging) markDirty()
}

export const onEdgesChange = (changes: EdgeChange<CanvasEdge>[]) =>
  set({ edges: applyEdgeChanges(changes.filter(c => c.type === 'select'), get().edges) })

/** Drag and resize record one history step at start. */
export function beginGesture(kind: 'drag' | 'resize') {
  set({ history: record(get().history, snap()), dragging: kind === 'drag' })
}
export function endGesture() {
  const { history, nodes } = get()
  const before = history.past.at(-1)
  const moved = !before || before.nodes.length !== nodes.length || nodes.some((n, i) => {
    const b = before.nodes[i]
    return !b || b.id !== n.id || b.position.x !== n.position.x || b.position.y !== n.position.y || b.width !== n.width || b.height !== n.height
  })
  set({ dragging: false, guides: {}, history: moved ? history : { ...history, past: history.past.slice(0, -1) } })
  if (moved) markDirty()
}

export const checkConnection = (c: Connection | CanvasEdge) => connectionError(c, get().nodes, get().edges)

export function connect(c: Connection) {
  const reason = checkConnection(c)
  if (reason) { toast({ title: '无法连接', description: reason, tone: 'error' }); return }
  mutate(s => ({ edges: [...s.edges, { id: crypto.randomUUID(), source: c.source, target: c.target, sourceHandle: c.sourceHandle, targetHandle: c.targetHandle }] }))
}

export const updateData = (id: string, patch: Partial<CanvasNodeData>, key?: string) =>
  mutate(s => ({ nodes: s.nodes.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }), key)

export function newNode(kind: NodeKind, center: XYPosition, data: Partial<CanvasNodeData> = {}): CanvasNode {
  const size = DEFAULT_SIZE[kind]
  const base: CanvasNodeData =
    kind === 'text' ? { text: '' }
    : kind === 'gen-image' || kind === 'gen-video' ? (() => {
      const m = modelsFor(kind === 'gen-image' ? 'image' : 'video')[0]!
      return { prompt: '', model: m.id, params: defaultParams(m), results: [], primary: 0 }
    })()
    : kind === 'group' ? { title: '编组' }
    : {}
  return {
    id: crypto.randomUUID(), type: kind, selected: true,
    position: { x: Math.round(center.x - size.w / 2), y: Math.round(center.y - size.h / 2) },
    ...(kind === 'group' ? { width: size.w, height: size.h } : {}),
    data: { ...base, ...data },
  }
}

export function addNodes(nodes: CanvasNode[], edges: CanvasEdge[] = []) {
  mutate(s => ({ nodes: [...s.nodes.map(n => (n.selected ? { ...n, selected: false } : n)), ...nodes], edges: [...s.edges, ...edges] }))
}

export function deleteSelected() {
  const { nodes, edges } = get()
  const ids = deletionSet(nodes)
  const edgeIds = new Set(edges.filter(e => e.selected || ids.has(e.source) || ids.has(e.target)).map(e => e.id))
  if (!ids.size && !edgeIds.size) {
    if (nodes.some(n => n.selected && n.data.locked)) toast({ title: '节点已锁定', description: '先解锁（Lock 按钮）再删除' })
    return
  }
  mutate(s => ({ nodes: s.nodes.filter(n => !ids.has(n.id)), edges: s.edges.filter(e => !edgeIds.has(e.id)) }))
}

export function setLocked(ids: string[], locked: boolean) {
  const set_ = new Set(ids)
  mutate(s => ({ nodes: s.nodes.map(n => (set_.has(n.id) ? { ...n, draggable: !locked, data: { ...n.data, locked } } : n)) }))
}

export const selectAll = () => set({ nodes: get().nodes.map(n => ({ ...n, selected: true })) })

// ---------- clipboard ----------

let clip: Clip | null = null
let pasteCount = 0
export function copy() {
  const c = copySelection(get().nodes, get().edges)
  if (!c.nodes.length) return false
  clip = c
  pasteCount = 0
  return true
}
export const hasClip = () => !!clip
export function paste() {
  if (!clip) return false
  pasteCount++
  const p = pasteClip(clip, { x: 32 * pasteCount, y: 32 * pasteCount })
  addNodes(p.nodes, p.edges)
  return true
}
export function duplicate() {
  const c = copySelection(get().nodes, get().edges)
  if (!c.nodes.length) return
  const p = pasteClip(c, { x: 32, y: 32 })
  addNodes(p.nodes, p.edges)
}

export function group() {
  if (!mutate(s => { const nodes = groupSelection(s.nodes, crypto.randomUUID()); return nodes && { nodes } }))
    toast({ title: '先选中要编组的节点', description: '编组只包含未在其他编组里的节点' })
}
export const ungroup = () => mutate(s => { const nodes = ungroupSelection(s.nodes); return nodes && { nodes } })

// ---------- files ----------

export async function addFiles(files: File[], at: XYPosition): Promise<string[]> {
  const created: CanvasNode[] = []
  const jobs: [string, File][] = []
  for (const [i, file] of files.entries()) {
    const err = validateFile(file)
    if (err) { toast({ title: `${file.name} 未添加`, description: err, tone: 'error' }); continue }
    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    const size = await readImageSize(file)
    const blob = URL.createObjectURL(file)
    const w = DEFAULT_SIZE[kind].w
    const n = newNode(kind, { x: at.x + i * (w + 24), y: at.y }, {
      name: file.name,
      asset: { id: `upload-${crypto.randomUUID()}`, kind, width: size?.width ?? null, height: size?.height ?? null, urls: { orig: blob } },
    })
    created.push(n)
    jobs.push([n.id, file])
  }
  if (!created.length) return []
  addNodes(created)
  for (const [id, file] of jobs) {
    const blob = created.find(n => n.id === id)!.data.asset!.urls.orig
    setRun(id, { status: 'uploading', progress: 0 })
    mockUpload(file, p => setRun(id, { status: 'uploading', progress: p }))
      .then(asset => { seedResolved(asset.id, blob); clearRun(id); patchEverywhere(id, { asset }) })
      .catch(() => setRun(id, { status: 'failed', progress: 0, error: '上传失败，请重新拖入文件' }))
  }
  return created.map(n => n.id)
}

// ---------- runs ----------

const setRun = (id: string, r: RunState) => set({ runs: { ...get().runs, [id]: r } })
const clearRun = (id: string) => { const { [id]: _, ...rest } = get().runs; set({ runs: rest }) }

/** Reason the node can't run, or null. */
export function runBlocker(id: string): string | null {
  const s = get()
  const n = s.nodes.find(x => x.id === id)
  if (!n) return '节点不存在'
  if (s.runs[id]?.status === 'running') return '正在生成'
  if (!findModel(n.data.model)) return '请选择型号'
  if (!assembleInputs(id, s.nodes, s.edges).prompt) return '先写提示词，或连上一个文本节点'
  return null
}

export async function runNode(id: string) {
  const blocker = runBlocker(id)
  if (blocker) { toast({ title: '无法运行', description: blocker, tone: 'error' }); return }
  const s = get()
  const n = s.nodes.find(x => x.id === id)!
  const kind = n.type === 'gen-video' ? 'video' : 'image'
  const { references } = assembleInputs(id, s.nodes, s.edges)
  // §2.2: text-to-X vs image-to-X is decided here, at submit time, from upstream references.
  const decision = decideMode(kind, references, findModel(n.data.model))
  setRun(id, { status: 'running', progress: 0 })
  try {
    const results = await mockGenerate({ kind, params: n.data.params ?? {}, onProgress: p => { if (get().runs[id]) setRun(id, { status: 'running', progress: p }) } })
    clearRun(id)
    patchEverywhere(id, { results, primary: 0, lastMode: decision.mode })
  } catch (e) {
    setRun(id, { status: 'failed', progress: 0, error: e instanceof Error ? e.message : '生成失败' })
  }
}

export const nodeLabel = (n: CanvasNode) => NODE_LABEL[n.type!]

// ---------- interop ----------

export interface ComposerFillDetail { source: 'canvas'; project_id: string; node_id: string; prompt: string; reference_urls: string[] }
/** 「加入输入框」: the composer (F3) listens for `ipzsk:composer-fill` with ComposerFillDetail. */
export function sendToComposer(nodeId: string) {
  const s = get()
  const n = s.nodes.find(x => x.id === nodeId)
  if (!n || !s.projectId) return
  let prompt = ''
  let refs: string[] = []
  if (n.type === 'gen-image' || n.type === 'gen-video') {
    const inputs = assembleInputs(nodeId, s.nodes, s.edges)
    prompt = inputs.prompt
    refs = inputs.references.map(r => r.urls.orig)
  } else if (n.type === 'text') prompt = n.data.text ?? ''
  else if (n.data.asset) refs = [n.data.asset.urls.orig]
  const detail: ComposerFillDetail = { source: 'canvas', project_id: s.projectId, node_id: nodeId, prompt, reference_urls: refs.map(resolveUrl) }
  window.dispatchEvent(new CustomEvent('ipzsk:composer-fill', { detail }))
  toast({ title: '已加入输入框', description: refs.length ? `${refs.length} 张参考图${prompt ? ' + 提示词' : ''}` : '提示词已带入' })
}

export const saveToAssets = () => toast({ title: '存入素材即将开放', description: '素材库接口接入后可用（§2.6）' })

// Dev-only hook for e2e/perf scripts.
if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { __ipzskCanvas: { useCanvas, addNodes, newNode } })
