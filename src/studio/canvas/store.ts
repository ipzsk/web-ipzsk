import { create } from 'zustand'
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type XYPosition } from '@xyflow/react'
import { toast } from '@/ui'
import { validateFile } from '@/media'
import {
  DEFAULT_SIZE, NODE_LABEL, absolutePosition, alignGuides, assembleInputs, connectionError, copySelection, decideMode, deletionSet, dropTarget, fromDocument,
  groupSelection, nudge, pasteClip, reparent, selectionRoots, sizeOf, toDocument, ungroupSelection,
  type AssetRef, type CanvasEdge, type CanvasNode, type CanvasNodeData, type Clip, type NodeKind,
} from './graph'
import { emptyHistory, record, redo, undo, type History } from './history'
import { canvasRepo, mockServer, resolveConflict, syncDirty, type CanvasProjectSnapshot, type ConflictChoice } from './repo'
import { buildCanvasAdd } from './canvasAdd'
import { COMPOSER_FILL_EVENT, dispatchStudioEvent, type CanvasAddDetail } from '@/shared/events'
import { defaultParams, findModel, mockGenerate, mockUpload, modelsFor, readImageSize, resolveUrl, seedResolved } from './mock'

type Snap = { nodes: CanvasNode[]; edges: CanvasEdge[] }
/** `progress` is real only for uploads; generation has no server progress (§4.2), so running carries `startedAt` instead. */
export type RunState = { status: 'running' | 'uploading' | 'failed'; progress: number; startedAt?: number; error?: string }
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'conflict'

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
  /** Remote version that rejected our PUT (409). Local writes continue; sync pauses until resolved. */
  conflict: CanvasProjectSnapshot | null
  /** Group highlighted as the drop target while dragging. */
  dropGroup: string | null
  editedAt: number
}

const initial = (): Omit<CanvasState, 'projectId'> => ({
  title: '', missing: false, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  history: emptyHistory(), runs: {}, status: 'saved', dragging: false, guides: {}, conflict: null, dropGroup: null, editedAt: 0,
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

let editSeq = 0

async function syncNow() {
  const id = get().projectId
  if (!id || get().status === 'conflict') return
  const seq = editSeq
  await writeNow()
  const r = await canvasRepo.sync(id)
  if (get().projectId !== id) return
  if (typeof r === 'object') { set({ status: 'conflict', conflict: r.conflict }); return }
  if (r === 'offline') { set({ status: 'offline' }); return }
  // Newer edits arrived mid-request: their own timer will sync them.
  if (seq === editSeq) set({ status: 'saved' })
}

/** Local write within ~100ms of a change; "sync" 1.5s after the last change (§2.7). */
function markDirty(silent = false) {
  if (!get().projectId) return
  const conflict = get().status === 'conflict'
  if (!silent) { editSeq++; set({ editedAt: Date.now(), ...(conflict ? {} : { status: online() ? 'saving' : 'offline' }) }) }
  if (get().dragging) return
  clearTimeout(writeTimer)
  writeTimer = setTimeout(writeNow, 100)
  if (conflict) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(syncNow, 1500)
}

// Offline queue: dirty projects (open or not) are pushed when the connection returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (get().projectId && get().status === 'offline') markDirty()
    void syncDirty(canvasRepo, get().projectId)
  })
  window.addEventListener('offline', () => { if (get().projectId && get().status === 'saving') set({ status: 'offline' }) })
}

export async function loadProject(id: string) {
  await flush()
  set({ projectId: id, ...initial() })
  const p = await canvasRepo.get(id)
  if (get().projectId !== id) return
  if (!p) { set({ missing: true }); return }
  const { nodes, edges, viewport } = fromDocument(p.document)
  set({ title: p.meta.title, nodes, edges, viewport })
  if (p.meta.dirty) { set({ status: online() ? 'saving' : 'offline' }); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 300) }
}

/** Local write now; sync continues in the background (a conflict surfaces next time the project opens). */
export async function flush() {
  const id = get().projectId
  if (!id) return
  clearTimeout(syncTimer)
  await writeNow()
  if (get().status !== 'conflict') void canvasRepo.sync(id)
}

/** Editor unmounted: drop the in-memory copy so nothing stale is written over later changes (e.g. 放到画布 into this project). */
export async function closeProject(id: string) {
  await flush()
  if (get().projectId === id) set({ projectId: null, ...initial() })
}

export async function resolveConflictAction(choice: ConflictChoice): Promise<string | undefined> {
  const { projectId: id, conflict } = get()
  if (!id || !conflict) return undefined
  await writeNow()
  const copyId = await resolveConflict(canvasRepo, id, choice, conflict)
  if (get().projectId !== id) return copyId
  set({ conflict: null, status: 'saved' })
  if (choice === 'mine') markDirty()
  else {
    const { nodes, edges } = fromDocument(conflict.document)
    set({ nodes, edges, title: conflict.meta.title, history: emptyHistory() })
  }
  if (copyId) void canvasRepo.sync(copyId)
  return copyId
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

export function mutate(recipe: (s: Snap) => Partial<Snap> | null | undefined, key?: string, windowMs?: number) {
  const before = snap()
  const next = recipe(before)
  if (!next) return false
  set({ ...next, history: record(get().history, before, key, Date.now(), windowMs) })
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
  let next = nodes
  const { dropGroup } = get()
  if (dragIds.length) {
    const toMove = selectionRoots(nodes, new Set(dragIds)).filter(n => (n.parentId ?? null) !== dropGroup).map(n => n.id)
    if (toMove.length) next = reparent(nodes, toMove, dropGroup ?? undefined)
  }
  dragIds = []
  const changed = moved || next !== nodes
  set({ nodes: next, dragging: false, guides: {}, dropGroup: null, history: changed ? history : { ...history, past: history.past.slice(0, -1) } })
  if (changed) markDirty()
}

let dragIds: string[] = []
/** During a drag: find the group under the dragged node's centre (drag into / out of groups). */
export function dragOver(primaryId: string, ids: string[]) {
  dragIds = ids
  const s = get()
  const byId = new Map(s.nodes.map(n => [n.id, n]))
  const n = byId.get(primaryId)
  if (!n) return
  const p = absolutePosition(n, byId), size = sizeOf(n)
  const target = dropTarget(s.nodes, ids, { x: p.x + size.w / 2, y: p.y + size.h / 2 }) ?? null
  const roots = selectionRoots(s.nodes, new Set(ids))
  const highlight = roots.every(r => (r.parentId ?? null) === target) ? null : target
  if (highlight !== s.dropGroup) set({ dropGroup: highlight })
}

/** Arrow keys: 1px / Shift 10px; a burst of presses (<300ms apart) is one undo step. */
export const nudgeSelection = (dx: number, dy: number) =>
  mutate(s => { const nodes = nudge(s.nodes, dx, dy); return nodes && { nodes } }, 'nudge', 300)

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
  const r = groupSelection(get().nodes, crypto.randomUUID())
  if (typeof r === 'string') { toast({ title: '无法编组', description: r }); return }
  mutate(() => ({ nodes: r }))
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
  setRun(id, { status: 'running', progress: 0, startedAt: Date.now() })
  try {
    const results = await mockGenerate({ kind, params: n.data.params ?? {}, onProgress: () => {} })
    clearRun(id)
    patchEverywhere(id, { results, primary: 0, lastMode: decision.mode })
  } catch (e) {
    setRun(id, { status: 'failed', progress: 0, error: e instanceof Error ? e.message : '生成失败' })
  }
}

export const nodeLabel = (n: CanvasNode) => NODE_LABEL[n.type!]

// ---------- interop ----------

/** 「加入输入框」: nodes with an asset id go as `reference_assets` (sent); URL-only nodes as `reference_urls` (display only). */
export function sendToComposer(nodeId: string) {
  const s = get()
  const n = s.nodes.find(x => x.id === nodeId)
  if (!n || !s.projectId) return
  let prompt = ''
  let assets: AssetRef[] = []
  if (n.type === 'gen-image' || n.type === 'gen-video') {
    const inputs = assembleInputs(nodeId, s.nodes, s.edges)
    prompt = inputs.prompt
    assets = inputs.references
  } else if (n.type === 'text') prompt = n.data.text ?? ''
  else if (n.data.asset) assets = [n.data.asset]
  const reference_assets = assets.flatMap(a => a.asset_id
    ? [{ id: a.asset_id, kind: a.kind, status: 'ready' as const, width: a.width, height: a.height, duration_ms: null, urls: { ...a.urls, orig: resolveUrl(a.urls.orig) } }]
    : [])
  const reference_urls = assets.filter(a => !a.asset_id).map(a => resolveUrl(a.urls.orig))
  const count = reference_assets.length + reference_urls.length
  if (!dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'canvas', project_id: s.projectId, node_id: nodeId, prompt, reference_assets, reference_urls })) {
    toast({ title: '没有加入输入框', description: '内容格式无法识别，请刷新页面后重试', tone: 'error' })
    return
  }
  toast({ title: '已加入输入框', description: count ? `${count} 张参考图${prompt ? ' + 提示词' : ''}` : '提示词已带入' })
}


// ---------- 放到画布 ----------

let editorCenter: (() => XYPosition) | null = null
/** The editor registers its viewport centre while mounted; null = no canvas open. */
export const setEditorCenter = (fn: (() => XYPosition) | null) => { editorCenter = fn }

/** Returns true when handled by the open editor (nodes added + selected, one undo step). */
export function addToOpenCanvas(d: CanvasAddDetail) {
  const center = editorCenter?.()
  if (!center || !get().projectId) return false
  const { nodes, edges } = buildCanvasAdd(d, center)
  addNodes(nodes, edges)
  return true
}

/** Appends into a (closed) project's stored document, around its saved viewport centre. */
export async function addToProject(id: string, d: CanvasAddDetail) {
  const p = await canvasRepo.get(id)
  if (!p) throw new Error('project not found')
  const v = p.document.viewport
  // ponytail: assumes a ~1200×800 editor; exact once the project is opened and nodes are selected anyway.
  const center = { x: (600 - v.x) / v.zoom, y: (400 - v.y) / v.zoom }
  const built = buildCanvasAdd(d, center)
  const nodes = built.nodes.map(({ selected: _s, ...n }) => n)
  await canvasRepo.save(id, { ...p.document, nodes: [...p.document.nodes, ...nodes], edges: [...p.document.edges, ...built.edges] })
  void canvasRepo.sync(id)
  return p.meta.title
}

// Dev-only hooks for e2e/perf scripts; never in production bundles.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  Object.assign(window, {
    __ipzskCanvas: {
      useCanvas, addNodes, newNode,
      simulateRemoteEdit: (id = get().projectId) => (id && mockServer ? mockServer.simulateRemoteEdit(id) : Promise.resolve(false)),
      syncNow,
    },
  })
}
