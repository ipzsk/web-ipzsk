import '@xyflow/react/dist/base.css'
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, UNSAFE_DataRouterContext, useBlocker, useNavigate } from 'react-router'
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, ReactFlowProvider, SelectionMode, ViewportPortal,
  useReactFlow, useStore, type FinalConnectionState, type XYPosition,
} from '@xyflow/react'
import {
  ArrowLeft, Check, CloudOff, Group, ImagePlus, Keyboard, LoaderCircle, Maximize, Minus, MousePointerClick, Plus, Redo2, TriangleAlert, Undo2,
} from 'lucide-react'
import { Button, Dialog, DialogContent, DialogFooter, EmptyState, IconButton, cn, toast } from '@/ui'
import { DEFAULT_SIZE, handleId, kindsForDangling, parseHandle, type CanvasEdge, type NodeKind } from './graph'
import { ADDABLE, NodeMenu } from './NodeMenu'
import { NodePanel } from './NodePanel'
import { MediaRefreshProvider } from '@/media'
import { refreshCanvasAsset } from './mock'
import { nodeTypes } from './nodes'
import {
  addFiles, addNodes, beginGesture, checkConnection, closeProject, connect, copy, deleteSelected, dragOver, duplicate, endGesture, group, loadProject,
  newNode, nudgeSelection, onEdgesChange, onNodesChange, paste, redoAction, renameProject, resolveConflictAction, selectAll, setEditorCenter, setLocked,
  setViewport, undoAction, ungroup, useCanvas,
} from './store'
import { ago } from './ProjectList'
import type { ConflictChoice } from './repo'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const SHORTCUTS: [string, string][] = [
  ['双击空白 · /', '添加节点'],
  ['拖动空白', '框选（触屏：平移）'],
  ['Shift / ' + MOD + ' + 点击', '多选'],
  ['空格 + 拖动 / 中键或右键拖动 / 滚轮', '平移画布'],
  [MOD + ' + 滚轮 / 双指捏合', '缩放'],
  [MOD + ' Z / ' + MOD + ' ⇧ Z', '撤销 / 重做'],
  [MOD + ' C / V / D', '复制 / 粘贴 / 复制一份'],
  [MOD + ' A', '全选'],
  [MOD + ' G / ' + MOD + ' ⇧ G', '编组 / 取消编组'],
  [MOD + ' ⇧ L', '锁定 / 解锁选中节点'],
  ['方向键 / ⇧ + 方向键', '微移 1px / 10px'],
  ['拖进 / 拖出编组', '加入或移出编组（最多嵌套 2 层）'],
  ['Delete / Backspace', '删除'],
  ['⇧ 1 / ' + MOD + ' 0', '适应视图 / 缩放到 100%'],
  ['?', '快捷键帮助'],
]

const flowVars = {
  '--xy-edge-stroke': 'var(--color-muted)',
  '--xy-edge-stroke-width': 2,
  '--xy-edge-stroke-selected': 'var(--color-acid)',
  '--xy-connectionline-stroke': 'var(--color-ink)',
  '--xy-connectionline-stroke-width': 2,
  '--xy-selection-background-color': 'color-mix(in srgb, var(--color-acid) 16%, transparent)',
  '--xy-selection-border': '1px dashed var(--color-acid-deep)',
  '--xy-minimap-background-color': 'var(--color-card)',
  '--xy-minimap-mask-background-color': 'rgb(29 31 32 / .08)',
  '--xy-attribution-background-color': 'transparent',
} as CSSProperties

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

interface MenuState {
  x: number; y: number; at: XYPosition; kinds: NodeKind[]; title: string
  from?: { nodeId: string; handle: string }
}

function SaveStatus({ onConflict }: { onConflict: () => void }) {
  const status = useCanvas(s => s.status)
  if (status === 'conflict') {
    return (
      <button type="button" aria-live="polite" onClick={onConflict} title="远端有更新，点击处理"
        className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-warning/50 bg-warning/10 px-2.5 text-xs font-semibold text-warning hover:bg-warning/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid-deep">
        <TriangleAlert className="size-4" />冲突
      </button>
    )
  }
  const map = {
    saved: { icon: <Check className="size-4 text-label" />, text: '已保存' },
    saving: { icon: <LoaderCircle className="size-4 motion-safe:animate-spin-slow" />, text: '保存中' },
    offline: { icon: <CloudOff className="size-4 text-warning" />, text: '离线 · 已存本地' },
  }[status]
  return <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">{map.icon}{map.text}</span>
}

function Preview({ label, nodes, edges, at }: { label: string; nodes: number; edges: number; at: string }) {
  return (
    <div className="flex-1 rounded-card border border-line bg-paper p-3">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums">{nodes} 个节点 · {edges} 条连线</p>
      <p className="mt-0.5 text-xs text-muted">{ago(at)}更新</p>
    </div>
  )
}

function ConflictDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const conflict = useCanvas(s => s.conflict)
  const local = { nodes: useCanvas(s => s.nodes.length), edges: useCanvas(s => s.edges.length) }
  const editedAt = useCanvas(s => s.editedAt)
  const navigate = useNavigate()
  const [busy, setBusy] = useState<ConflictChoice | null>(null)
  if (!conflict) return null
  const doc = conflict.document
  const choose = async (c: ConflictChoice) => {
    setBusy(c)
    try {
      const copyId = await resolveConflictAction(c)
      onOpenChange(false)
      if (c === 'remote') toast({ title: '已用远端版本覆盖本地' })
      if (c === 'mine') toast({ title: '正在用你的版本覆盖远端' })
      if (copyId) toast({ title: '已另存为副本，当前画布已更新为远端版本', tone: 'success', action: { label: '打开副本', onClick: () => navigate(`/studio/canvas/${copyId}`) } })
    } catch {
      toast({ title: '处理冲突失败', description: '浏览器存储不可用，请重试', tone: 'error' })
    } finally { setBusy(null) }
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent title="远端有更新" description="这个画布在其他设备或窗口里被改过。你的改动已存在本机，选择保留哪个版本；处理前不会同步。" className="max-w-lg">
        <div className="flex gap-3 max-sm:flex-col">
          <Preview label="我的（本机）" nodes={local.nodes} edges={local.edges} at={new Date(editedAt || Date.now()).toISOString()} />
          <Preview label="远端" nodes={doc.nodes.length + doc.groups.length} edges={doc.edges.length} at={conflict.meta.updated_at} />
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" loading={busy === 'copy'} disabled={!!busy} onClick={() => void choose('copy')}>另存为副本</Button>
          <Button variant="secondary" loading={busy === 'remote'} disabled={!!busy} onClick={() => void choose('remote')}>用远端覆盖本地</Button>
          <Button variant="primary" loading={busy === 'mine'} disabled={!!busy} onClick={() => void choose('mine')}>保留我的并覆盖远端</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveDialog({ open, onLeave, onStay }: { open: boolean; onLeave: () => void; onStay: () => void }) {
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onStay() }}>
      <DialogContent title="改动还没同步到云端" description="改动已保存在本机浏览器，离开后联网时会自动同步。在其他设备上暂时看不到这些改动。">
        <DialogFooter>
          <Button variant="ghost" onClick={onLeave}>继续离开</Button>
          <Button variant="primary" onClick={onStay} autoFocus>留下</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** §4.4 in-app leave guard. useBlocker needs a data router; with <BrowserRouter> we intercept in-app link clicks instead. */
function LeaveGuard() {
  const dirty = useCanvas(s => s.status !== 'saved')
  const dataRouter = useContext(UNSAFE_DataRouterContext)
  return dataRouter ? <BlockerGuard dirty={dirty} /> : <LinkGuard dirty={dirty} />
}

function BlockerGuard({ dirty }: { dirty: boolean }) {
  const b = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  return <LeaveDialog open={b.state === 'blocked'} onLeave={() => b.proceed?.()} onStay={() => b.reset?.()} />
}

function LinkGuard({ dirty }: { dirty: boolean }) {
  const navigate = useNavigate()
  const [to, setTo] = useState<string | null>(null)
  useEffect(() => {
    if (!dirty) return
    // ponytail: covers <Link>/<NavLink> clicks; browser back/forward can't be blocked without a data router (beforeunload covers reload/close).
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.origin !== location.origin || a.pathname === location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      setTo(a.pathname + a.search + a.hash)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty])
  return <LeaveDialog open={!!to} onLeave={() => { const t = to!; setTo(null); navigate(t) }} onStay={() => setTo(null)} />
}

function TitleInput() {
  const title = useCanvas(s => s.title)
  return (
    <input
      key={title}
      aria-label="画布名称"
      defaultValue={title}
      maxLength={80}
      className="h-8 min-w-24 max-w-64 flex-1 truncate rounded-[8px] border border-transparent bg-transparent px-2 text-sm font-bold hover:border-line focus:border-acid focus:ring-3 focus:ring-acid/10 focus:bg-card focus:outline-none"
      onBlur={e => { if (e.target.value.trim() !== title) void renameProject(e.target.value) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = title; e.currentTarget.blur() } }}
    />
  )
}

function ZoomControls() {
  const rf = useReactFlow()
  const zoom = useStore(s => s.transform[2])
  return (
    <div className="flex items-center gap-0.5 rounded-control border border-line bg-card p-1 shadow-sm">
      <IconButton size="icon-sm" label="缩小" onClick={() => void rf.zoomOut({ duration: 180 })}><Minus /></IconButton>
      <Button size="sm" variant="ghost" className="h-8 w-14 px-0 tabular-nums" aria-label="缩放到 100%" title="缩放到 100%" onClick={() => void rf.zoomTo(1, { duration: 180 })}>
        {Math.round(zoom * 100)}%
      </Button>
      <IconButton size="icon-sm" label="放大" onClick={() => void rf.zoomIn({ duration: 180 })}><Plus /></IconButton>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <IconButton size="icon-sm" label="适应视图 (⇧1)" onClick={() => void rf.fitView({ duration: 240, padding: 0.2 })}><Maximize /></IconButton>
    </div>
  )
}

function Guides() {
  const g = useCanvas(s => s.guides)
  const zoom = useStore(s => s.transform[2])
  const w = 1 / zoom
  return (
    <ViewportPortal>
      {g.vertical !== undefined && <div aria-hidden className="pointer-events-none absolute bg-acid-deep" style={{ left: g.vertical, top: -1e5, width: w, height: 2e5 }} />}
      {g.horizontal !== undefined && <div aria-hidden className="pointer-events-none absolute bg-acid-deep" style={{ top: g.horizontal, left: -1e5, height: w, width: 2e5 }} />}
    </ViewportPortal>
  )
}

function Inner() {
  const rf = useReactFlow()
  const nodes = useCanvas(s => s.nodes)
  const edges = useCanvas(s => s.edges)
  const canUndo = useCanvas(s => s.history.past.length > 0)
  const canRedo = useCanvas(s => s.history.future.length > 0)
  const hasSelection = useCanvas(s => s.nodes.some(n => n.selected))
  const panelNode = useCanvas(s => {
    let found = null, count = 0
    for (const n of s.nodes) if (n.selected) { count++; found = n }
    return count === 1 && (found?.type === 'gen-image' || found?.type === 'gen-video') ? found : null
  })
  const wrap = useRef<HTMLDivElement>(null)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingFiles = useRef<MenuState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [help, setHelp] = useState(false)
  const [fileDrag, setFileDrag] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const hasConflict = useCanvas(s => !!s.conflict)
  useEffect(() => { setConflictOpen(hasConflict) }, [hasConflict])

  // 放到画布 lands at the viewport centre while this editor is mounted.
  useEffect(() => {
    setEditorCenter(() => {
      const r = wrap.current!.getBoundingClientRect()
      return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    })
    return () => setEditorCenter(null)
  }, [rf])

  const openMenuAt = useCallback((clientX: number, clientY: number, extra?: Partial<MenuState>) => {
    const r = wrap.current!.getBoundingClientRect()
    setMenu({ x: clientX - r.left, y: clientY - r.top, at: rf.screenToFlowPosition({ x: clientX, y: clientY }), kinds: ADDABLE, title: '添加节点', ...extra })
  }, [rf])
  const openMenuHere = useCallback(() => {
    const r = wrap.current!.getBoundingClientRect()
    const p = pointer.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    openMenuAt(p.x, p.y)
  }, [openMenuAt])

  const connectNew = (m: MenuState, nodeId: string) => {
    const from = m.from && parseHandle(m.from.handle)
    if (!m.from || !from) return undefined
    const edge: CanvasEdge = from.dir === 'out'
      ? { id: crypto.randomUUID(), source: m.from.nodeId, sourceHandle: m.from.handle, target: nodeId, targetHandle: handleId('in', from.type) }
      : { id: crypto.randomUUID(), source: nodeId, sourceHandle: handleId('out', from.type), target: m.from.nodeId, targetHandle: m.from.handle }
    return edge
  }

  const pick = (kind: NodeKind) => {
    const m = menu!
    setMenu(null)
    if (kind === 'image' || kind === 'video') {
      pendingFiles.current = m
      fileInput.current!.accept = kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'video/mp4'
      fileInput.current!.click()
      return
    }
    const w = DEFAULT_SIZE[kind].w
    const dir = m.from && parseHandle(m.from.handle)?.dir
    const center = { x: m.at.x + (dir === 'out' ? w / 2 + 16 : dir === 'in' ? -w / 2 - 16 : 0), y: m.at.y }
    const n = newNode(kind, center)
    const e = connectNew(m, n.id)
    addNodes([n], e ? [e] : [])
  }

  const onFilesPicked = async (files: File[]) => {
    const m = pendingFiles.current
    pendingFiles.current = null
    if (!m || !files.length) return
    const w = DEFAULT_SIZE.image.w
    const dir = m.from && parseHandle(m.from.handle)?.dir
    const ids = await addFiles(files, { x: m.at.x + (dir === 'in' ? -w / 2 - 16 : 0), y: m.at.y })
    const e = ids[0] && connectNew(m, ids[0])
    if (e) connect({ source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })
  }

  const onConnectEnd = (event: MouseEvent | TouchEvent, s: FinalConnectionState) => {
    if (s.isValid || !s.fromNode || !s.fromHandle?.id) return
    if (s.toHandle && s.toNode) {
      const out = s.fromHandle.type === 'source'
      const c = out
        ? { source: s.fromNode.id, sourceHandle: s.fromHandle.id, target: s.toNode.id, targetHandle: s.toHandle.id }
        : { source: s.toNode.id, sourceHandle: s.toHandle.id, target: s.fromNode.id, targetHandle: s.fromHandle.id }
      toast({ title: '无法连接', description: checkConnection({ ...c, id: '' }) ?? '端口类型不兼容', tone: 'error' })
      return
    }
    const target = event.target as Element | null
    if (!target?.classList.contains('react-flow__pane')) return
    const from = parseHandle(s.fromHandle.id)
    if (!from) return
    const kinds = kindsForDangling(from).filter(k => k !== 'group')
    const pt = 'changedTouches' in event ? event.changedTouches[0]! : event
    if (!kinds.length) { toast({ title: '没有可接的节点', description: `目前没有节点接收${from.type === 'video' ? '视频' : from.type === 'image' ? '图片' : '文本'}输入` }); return }
    openMenuAt(pt.clientX, pt.clientY, { kinds, title: '接一个什么节点', from: { nodeId: s.fromNode.id, handle: s.fromHandle.id } })
  }

  // Keyboard
  useEffect(() => {
    let pasteSeen = false
    const onKey = (e: KeyboardEvent) => {
      if (editable(e.target) || document.querySelector('[role=dialog][data-state=open]')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redoAction(); else undoAction() }
      else if (mod && k === 'y') { e.preventDefault(); redoAction() }
      else if (mod && k === 'c') { if (copy()) e.preventDefault() }
      else if (mod && k === 'v') {
        // Real paste arrives as a `paste` event (may carry images); fall back to the internal clipboard if the browser doesn't fire one.
        pasteSeen = false
        setTimeout(() => { if (!pasteSeen) paste() }, 60)
      }
      else if (mod && k === 'd') { e.preventDefault(); duplicate() }
      else if (mod && k === 'a') { e.preventDefault(); selectAll() }
      else if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group() }
      else if (mod && e.shiftKey && k === 'l') {
        e.preventDefault()
        const sel = useCanvas.getState().nodes.filter(n => n.selected)
        if (sel.length) setLocked(sel.map(n => n.id), !sel.every(n => n.data.locked))
      }
      else if (mod && k === '0') { e.preventDefault(); void rf.zoomTo(1, { duration: 180 }) }
      else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); void rf.fitView({ duration: 240, padding: 0.2 }) }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected() }
      else if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setHelp(true) }
      else if (e.key === '/') { e.preventDefault(); openMenuHere() }
      else if (e.key === 'Escape') setMenu(null)
      else if (!mod && e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
        if (d && nudgeSelection(d[0]!, d[1]!)) e.preventDefault()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (editable(e.target)) return
      pasteSeen = true
      const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/'))
      e.preventDefault()
      if (files.length) {
        const r = wrap.current!.getBoundingClientRect()
        const p = pointer.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
        void addFiles(files, rf.screenToFlowPosition(p))
      } else paste()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste) }
  }, [rf, openMenuHere])

  const closePanel = () => useCanvas.setState(s => ({ nodes: s.nodes.map(n => (n.selected ? { ...n, selected: false } : n)) }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
        <Link to="/studio/canvas" aria-label="返回画布列表" title="返回画布列表" className="grid size-8 shrink-0 place-items-center rounded-control hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acid-deep"><ArrowLeft className="size-[18px]" /></Link>
        <TitleInput />
        <SaveStatus onConflict={() => setConflictOpen(true)} />
        <span className="flex-1" />
        <IconButton size="icon-sm" label={`撤销 (${MOD} Z)`} disabled={!canUndo} disabledReason="没有可撤销的操作" onClick={undoAction}><Undo2 /></IconButton>
        <IconButton size="icon-sm" label={`重做 (${MOD} ⇧ Z)`} disabled={!canRedo} disabledReason="没有可重做的操作" onClick={redoAction}><Redo2 /></IconButton>
        <span className="mx-0.5 h-5 w-px bg-line max-sm:hidden" />
        <IconButton size="icon-sm" label={`编组 (${MOD} G)`} className="max-sm:hidden" disabled={!hasSelection} disabledReason="先选中要编组的节点" onClick={group}><Group /></IconButton>
        <IconButton size="icon-sm" label="快捷键 (?)" className="max-sm:hidden" onClick={() => setHelp(true)}><Keyboard /></IconButton>
        <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={openMenuHere} aria-label="添加节点"><span className="max-sm:hidden">添加节点</span></Button>
      </div>

      <div
        ref={wrap}
        className="relative min-h-0 flex-1"
        onPointerMove={e => { pointer.current = { x: e.clientX, y: e.clientY } }}
        onDoubleClick={e => { if ((e.target as Element).classList.contains('react-flow__pane')) openMenuAt(e.clientX, e.clientY) }}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setFileDrag(true) } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileDrag(false) }}
        onDrop={e => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          setFileDrag(false)
          void addFiles([...e.dataTransfer.files], rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          isValidConnection={c => !checkConnection(c)}
          onConnectEnd={onConnectEnd}
          onNodeDragStart={() => beginGesture('drag')}
          onNodeDrag={(_, node, dragged) => dragOver(node.id, dragged.map(n => n.id))}
          onNodeDragStop={endGesture}
          onSelectionDragStart={() => beginGesture('drag')}
          onSelectionDrag={(_, dragged) => { if (dragged[0]) dragOver(dragged[0].id, dragged.map(n => n.id)) }}
          onSelectionDragStop={endGesture}
          disableKeyboardA11y
          defaultViewport={useCanvas.getState().viewport}
          onMoveEnd={(_, viewport) => setViewport(viewport)}
          onPaneClick={() => setMenu(null)}
          snapToGrid
          snapGrid={[16, 16]}
          onlyRenderVisibleElements
          selectionOnDrag={!coarse}
          panOnDrag={coarse ? true : [1, 2]}
          panOnScroll={!coarse}
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          connectionRadius={28}
          minZoom={0.1}
          maxZoom={4}
          attributionPosition="bottom-center"
          style={flowVars}
          className="bg-paper [&_.react-flow__edge:hover_.react-flow__edge-path]:stroke-ink"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="var(--color-line)" />
          <Guides />
          <Panel position="bottom-left" className="max-md:!mb-3"><ZoomControls /></Panel>
          <MiniMap
            pannable
            zoomable
            ariaLabel="小地图"
            position="bottom-right"
            nodeBorderRadius={4}
            nodeColor={n => (n.type === 'group' ? 'transparent' : n.type?.startsWith('gen') ? 'var(--color-acid)' : 'var(--color-subtle)')}
            nodeStrokeColor={n => (n.type === 'group' ? 'var(--color-muted)' : 'transparent')}
            className={cn('!overflow-hidden !rounded-card border border-line shadow-sm max-md:!hidden', panelNode && 'md:!mr-[340px]')}
          />
        </ReactFlow>

        {nodes.length === 0 && !menu && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="pointer-events-auto rounded-panel border border-line bg-card/90 shadow-sm">
              <EmptyState icon={MousePointerClick} text="双击空白处或按 / 添加节点，也可以把图片直接拖进来" action={{ label: '添加节点', onClick: openMenuHere }} />
            </div>
          </div>
        )}

        {fileDrag && (
          <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-panel border-2 border-dashed border-acid bg-acid-soft/70 motion-safe:animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"><ImagePlus className="size-[18px]" />松开，在这里创建图片 / 视频节点</span>
          </div>
        )}

        {menu && <NodeMenu {...menu} onPick={pick} onClose={() => setMenu(null)} />}
        {panelNode && <NodePanel key={panelNode.id} node={panelNode} onClose={closePanel} />}

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={e => { void onFilesPicked([...(e.target.files ?? [])]); e.target.value = '' }}
        />
      </div>

      <ConflictDialog open={conflictOpen} onOpenChange={setConflictOpen} />
      <LeaveGuard />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent title="快捷键与操作" description="框选为默认拖动行为；平移用空格 + 拖动、中键 / 右键拖动或滚轮。" className="max-w-lg">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="rounded-[6px] border border-line bg-subtle px-1.5 py-0.5 font-sans text-xs">{k}</kbd></dt>
                <dd className="text-muted">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function Editor({ projectId }: { projectId: string }) {
  const ready = useCanvas(s => s.projectId === projectId && (s.title !== '' || s.missing))
  const missing = useCanvas(s => s.missing)
  const status = useCanvas(s => s.status)

  useEffect(() => {
    void loadProject(projectId)
    return () => { void closeProject(projectId) }
  }, [projectId])

  // §4.4: warn before leaving while changes haven't synced.
  useEffect(() => {
    if (status === 'saved') return // includes 'conflict': unresolved local changes
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [status])

  return (
    <div className="relative -mx-4 -mt-6 -mb-60 h-[calc(100dvh-64px-56px)] overflow-hidden md:-mx-8 md:-mb-48 md:h-[calc(100dvh-64px)] max-[720px]:h-[calc(100dvh-104px-56px)]">
      {!ready ? (
        <div className="grid h-full place-items-center text-sm text-muted"><LoaderCircle className="size-5 motion-safe:animate-spin-slow" /></div>
      ) : missing ? (
        <div className="grid h-full place-items-center">
          <EmptyState icon={CloudOff} text="找不到这个画布，可能已被删除" action={{ label: '返回画布列表', onClick: () => { location.href = '/studio/canvas' } }} />
        </div>
      ) : (
        <MediaRefreshProvider value={refreshCanvasAsset}><ReactFlowProvider><Inner /></ReactFlowProvider></MediaRefreshProvider>
      )}
    </div>
  )
}
