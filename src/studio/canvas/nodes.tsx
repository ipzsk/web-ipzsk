import { memo, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Handle, NodeResizer, NodeToolbar, Position, useConnection, useStore, type NodeProps } from '@xyflow/react'
import {
  Clapperboard, Copy, Film, FolderPlus, Group, Image as ImageIcon, Lock, LockOpen, Play, RotateCw, Sparkles, Star, TextCursorInput, Trash2, Type,
  type LucideIcon,
} from 'lucide-react'
import { Button, IconButton, IndeterminateBar, cn } from '@/ui'
import { formatWait } from '../create/lib'
import { MediaImage, MediaVideo } from '@/media'
import { MODE_LABEL, NODE_LABEL, PORT_LABEL, PORTS, handleId, type AssetRef, type CanvasNode, type NodeKind, type PortType } from './graph'
import { findModel, useAssetUrls } from './mock'
import {
  beginGesture, deleteSelected, duplicate, endGesture, runBlocker, runNode, saveToAssets, sendToComposer, setLocked, updateData, useCanvas,
} from './store'

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  text: Type, image: ImageIcon, video: Film, 'gen-image': Sparkles, 'gen-video': Clapperboard, group: Group,
}

/** Only what node bodies render. Positions are left out so dragging 200 nodes doesn't re-render their contents. */
type SlimProps = { id: string; type: NodeKind; data: CanvasNode['data']; selected: boolean }

const PORT_SHAPE: Record<PortType, string> = {
  text: 'rounded-full bg-ink',
  image: 'rounded-[3px] bg-acid-deep',
  video: 'rotate-45 rounded-[2px] bg-warning',
}

/** Typed port. While a connection is being dragged, compatible ports turn acid and grow; the rest dim. */
function Port({ nodeId, dir, type, index = 0, total = 1 }: { nodeId: string; dir: 'in' | 'out'; type: PortType; index?: number; total?: number }) {
  const from = useConnection(c => (c.inProgress ? `${c.fromNode.id}|${c.fromHandle.id}` : ''))
  let state: 'idle' | 'ok' | 'no' = 'idle'
  if (from) {
    const [fromNode, fromHandle] = from.split('|')
    const [fdir, ftype] = (fromHandle ?? '').split('-')
    if (fromNode === nodeId && fromHandle === handleId(dir, type)) state = 'ok'
    else state = fromNode !== nodeId && fdir !== dir && ftype === type ? 'ok' : 'no'
  }
  const label = `${PORT_LABEL[type]}${dir === 'in' ? '输入' : '输出'}`
  return (
    <Handle
      id={handleId(dir, type)}
      type={dir === 'in' ? 'target' : 'source'}
      position={dir === 'in' ? Position.Left : Position.Right}
      title={label}
      aria-label={label}
      style={{ top: `${((index + 1) / (total + 1)) * 100}%` }}
      className={cn('!grid !size-6 place-items-center !rounded-full !border-0 !bg-transparent', state === 'no' && 'opacity-25')}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none size-3 ring-2 ring-card transition-[transform,background-color] duration-(--duration-fast)',
          PORT_SHAPE[type],
          state === 'ok' && '!bg-acid ring-ink scale-150',
          state === 'ok' && type === 'video' && 'rotate-45',
        )}
      />
    </Handle>
  )
}

function Ports({ id, kind }: { id: string; kind: NodeKind }) {
  const { inputs, output } = PORTS[kind]
  return (
    <>
      {inputs.map((t, i) => <Port key={t} nodeId={id} dir="in" type={t} index={i} total={inputs.length} />)}
      {output && <Port nodeId={id} dir="out" type={output} />}
    </>
  )
}

function Toolbar({ node, children }: { node: SlimProps; children?: ReactNode }) {
  const locked = !!node.data.locked
  return (
    <NodeToolbar position={Position.Top} offset={8} className="flex items-center gap-0.5 rounded-control border border-line bg-card p-1 shadow-lg">
      {children}
      <IconButton size="icon-sm" label={locked ? '解锁' : '锁定位置'} aria-pressed={locked} onClick={() => setLocked([node.id], !locked)}>
        {locked ? <Lock /> : <LockOpen />}
      </IconButton>
      <IconButton size="icon-sm" label="复制一份 (⌘D)" onClick={duplicate}><Copy /></IconButton>
      <IconButton size="icon-sm" label="删除 (Delete)" variant="danger-ghost" disabled={locked} disabledReason="已锁定，先解锁再删除" onClick={deleteSelected}><Trash2 /></IconButton>
    </NodeToolbar>
  )
}

function Shell({ node, kind, title, children, toolbar, className }: {
  node: SlimProps; kind: NodeKind; title?: ReactNode; children: ReactNode; toolbar?: ReactNode; className?: string
}) {
  const run = useCanvas(s => s.runs[node.id])
  const Icon = KIND_ICON[kind]
  return (
    <>
      <Toolbar node={node}>{toolbar}</Toolbar>
      <div
        className={cn(
          'group/node relative flex flex-col overflow-hidden rounded-card border border-line bg-card text-ink shadow-sm',
          'transition-[box-shadow,border-color] duration-(--duration-fast) hover:border-muted hover:shadow-md',
          node.selected && 'border-ink ring-2 ring-ink hover:border-ink',
          run?.status === 'failed' && 'border-danger ring-1 ring-danger hover:border-danger',
          node.data.locked && 'cursor-default',
          className,
        )}
      >
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-3 text-xs font-semibold">
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{title ?? NODE_LABEL[kind]}</span>
          <span className="flex-1" />
          {node.data.locked && <Lock className="size-3.5 text-muted" aria-label="已锁定" />}
        </div>
        {run?.status === 'running' && <IndeterminateBar label="生成中" className="h-1 max-w-none shrink-0 rounded-none" />}
        {run?.status === 'uploading' && (
          <div role="progressbar" aria-valuenow={Math.round(run.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="上传进度" className="h-1 shrink-0 bg-subtle">
            <div className="h-full bg-acid-deep transition-[width] duration-(--duration-base)" style={{ width: `${Math.max(4, run.progress * 100)}%` }} />
          </div>
        )}
        {children}
      </div>
      <Ports id={node.id} kind={kind} />
    </>
  )
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return <>{formatWait(now - since)}</>
}

const useFar = () => useStore(s => s.transform[2] < 0.5)

function AssetView({ asset, label, className }: { asset: AssetRef; label: string; className?: string }) {
  const urls = useAssetUrls(asset)
  const far = useFar()
  if (!urls) return null
  if (asset.kind === 'video') return <MediaVideo src={urls.orig} assetId={asset.asset_id} poster={urls.poster} width={asset.width} height={asset.height} label={label} focusable={false} className={className} />
  return <MediaImage urls={urls} assetId={asset.asset_id} width={asset.width} height={asset.height} sizes={far ? 'thumb' : 'detail'} alt={label} hideBadge className={className} />
}

export const TextNode = memo(function TextNode(p: SlimProps) {
  return (
    <Shell node={p} kind="text" className="w-60">
      <textarea
        aria-label="文本内容"
        value={p.data.text ?? ''}
        readOnly={!!p.data.locked}
        placeholder="写一段提示词…"
        onChange={e => updateData(p.id, { text: e.target.value }, `text:${p.id}`)}
        className="nodrag nowheel min-h-24 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted [field-sizing:content] max-h-60"
      />
    </Shell>
  )
})

export const MediaNode = memo(function MediaNode(p: SlimProps) {
  const kind = p.type as 'image' | 'video'
  const run = useCanvas(s => s.runs[p.id])
  return (
    <Shell
      node={p}
      kind={kind}
      title={p.data.name}
      className={kind === 'image' ? 'w-60' : 'w-70'}
      toolbar={kind === 'image' && p.data.asset && (
        <>
          <IconButton size="icon-sm" label="加入输入框" onClick={() => sendToComposer(p.id)}><TextCursorInput /></IconButton>
          <IconButton size="icon-sm" label="存入素材" onClick={saveToAssets}><FolderPlus /></IconButton>
          <span className="mx-0.5 h-5 w-px bg-line" />
        </>
      )}
    >
      {p.data.asset ? <AssetView asset={p.data.asset} label={p.data.name ?? NODE_LABEL[kind]} /> : <div className="grid aspect-square place-items-center text-xs text-muted">无内容</div>}
      {run?.status === 'uploading' && <p className="px-3 py-1.5 text-xs text-muted tabular-nums">上传中 {Math.round(run.progress * 100)}%</p>}
      {run?.status === 'failed' && <p role="alert" className="px-3 py-1.5 text-xs text-danger">{run.error}</p>}
    </Shell>
  )
})

export const GenNode = memo(function GenNode(p: SlimProps) {
  const kind = p.type as 'gen-image' | 'gen-video'
  const run = useCanvas(s => s.runs[p.id])
  // Subscribing to the blocker string keeps the run button's disabled reason live without re-rendering on unrelated changes.
  const blocker = useCanvas(s => (s.nodes, s.edges, runBlocker(p.id)))
  const model = findModel(p.data.model)
  const results = p.data.results ?? []
  const primary = Math.min(p.data.primary ?? 0, Math.max(0, results.length - 1))
  const [showAll, setShowAll] = useState(false)
  const main = results[primary]
  return (
    <Shell
      node={p}
      kind={kind}
      title={<>{NODE_LABEL[kind]} <span className="font-normal text-muted">· {model?.name ?? '未选型号'}</span></>}
      className="w-70"
      toolbar={<>
        <IconButton size="icon-sm" label="加入输入框" onClick={() => sendToComposer(p.id)}><TextCursorInput /></IconButton>
        <span className="mx-0.5 h-5 w-px bg-line" />
      </>}
    >
      {main ? (
        <div className="relative">
          <AssetView asset={main} label="主结果" />
          {results.length > 1 && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-0.5 text-[11px] text-acid"><Star className="size-3 fill-current" />主结果</span>}
        </div>
      ) : run?.status !== 'running' && (
        <p className={cn('line-clamp-3 px-3 pt-2 text-sm leading-6', !p.data.prompt && 'text-muted')}>{p.data.prompt || '选中节点，在面板里写提示词'}</p>
      )}
      {run?.status === 'running' && (
        <div className="grid aspect-[4/3] place-items-center bg-subtle text-xs text-muted tabular-nums"><span>生成中 · 已等待 <Elapsed since={run.startedAt ?? Date.now()} /></span></div>
      )}
      {results.length > 1 && (
        <div className="px-2 pt-2">
          <button type="button" className="nodrag text-xs text-muted hover:text-ink" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>
            {showAll ? '收起其余结果' : `其余 ${results.length - 1} 张`}
          </button>
          {showAll && (
            <div className="mt-1 grid grid-cols-4 gap-1">
              {results.map((r, i) => (
                <div key={r.id} className={cn('relative overflow-hidden rounded-[6px]', i === primary && 'ring-2 ring-ink')}>
                  <AssetView asset={r} label={`结果 ${i + 1}`} />
                  <button
                    type="button"
                    aria-label={i === primary ? '当前主结果' : `设为主结果（结果 ${i + 1}）`}
                    title={i === primary ? '当前主结果' : '设为主结果'}
                    aria-pressed={i === primary}
                    onClick={() => updateData(p.id, { primary: i })}
                    className="nodrag absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-card/90 hover:bg-acid"
                  >
                    <Star className={cn('size-3', i === primary && 'fill-current')} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {run?.status === 'failed' && (
        <p role="alert" className="px-3 pt-2 text-xs leading-5 text-danger">{run.error}</p>
      )}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          {p.data.lastMode ? `${MODE_LABEL[p.data.lastMode]} · ${results.length} ${kind === 'gen-video' ? '条' : '张'}` : results.length ? `已完成 · ${results.length} ${kind === 'gen-video' ? '条' : '张'}` : '未运行'}
        </span>
        <Button
          size="sm"
          variant={run?.status === 'failed' ? 'secondary' : 'primary'}
          className="nodrag h-7 px-2.5"
          icon={run?.status === 'failed' ? <RotateCw className="size-3.5" /> : <Play className="size-3.5" />}
          loading={run?.status === 'running'}
          disabled={!!blocker && run?.status !== 'running'}
          disabledReason={blocker ?? undefined}
          onClick={() => void runNode(p.id)}
        >
          {run?.status === 'failed' ? '重试' : '运行'}
        </Button>
      </div>
    </Shell>
  )
})

export const GroupNode = memo(function GroupNode(p: SlimProps) {
  const [editing, setEditing] = useState(false)
  const dropping = useCanvas(s => s.dropGroup === p.id)
  return (
    <>
      <NodeResizer
        isVisible={p.selected && !p.data.locked}
        minWidth={160}
        minHeight={100}
        onResizeStart={() => beginGesture('resize')}
        onResizeEnd={endGesture}
        lineClassName="!border-ink"
        handleClassName="!size-2.5 !rounded-[3px] !border-ink !bg-card"
      />
      <div
        className={cn(
          'h-full w-full rounded-panel border-2 border-dashed border-line bg-ink/[.025] transition-colors duration-(--duration-fast) hover:border-muted',
          p.selected && 'border-solid border-ink hover:border-ink',
          dropping && 'border-acid-deep bg-acid/15 hover:border-acid-deep',
        )}
        data-drop-target={dropping || undefined}
      >
        <div className="flex h-9 items-center gap-1.5 px-3 text-sm font-semibold">
          {editing ? (
            <input
              autoFocus
              aria-label="编组标题"
              defaultValue={p.data.title}
              maxLength={40}
              className="nodrag h-7 w-48 rounded-[6px] border border-ink bg-card px-2 outline-none"
              onBlur={e => { setEditing(false); if (e.target.value !== p.data.title) updateData(p.id, { title: e.target.value || '编组' }) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = p.data.title ?? ''; e.currentTarget.blur() } e.stopPropagation() }}
            />
          ) : (
            <button type="button" className="nodrag truncate rounded-[6px] px-1 hover:bg-subtle" title="双击重命名" onDoubleClick={() => setEditing(true)}>{p.data.title || '编组'}</button>
          )}
          {p.data.locked && <Lock className="size-3.5 text-muted" aria-label="已锁定" />}
        </div>
      </div>
      <Toolbar node={p} />
    </>
  )
})

const slim = (C: ComponentType<SlimProps>) => memo(function Slim(p: NodeProps<CanvasNode>) {
  return <C id={p.id} type={p.type} data={p.data} selected={!!p.selected} />
})

export const nodeTypes = { text: slim(TextNode), image: slim(MediaNode), video: slim(MediaNode), 'gen-image': slim(GenNode), 'gen-video': slim(GenNode), group: slim(GroupNode) }
