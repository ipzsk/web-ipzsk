import { useEffect, useState } from 'react'
import {
  AtSign, BookmarkPlus, Copy, Download, FolderPlus, ImagePlus, LayoutDashboard, LoaderCircle, Maximize2, MoreHorizontal, PencilLine, RefreshCw, Star, Trash2, TriangleAlert, UserPlus, type LucideIcon,
} from 'lucide-react'
import { Badge, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, IndeterminateBar, SegmentedControl, cn, focusRing, toast } from '@/ui'
import { formatPoints } from '@/shared/points'
import { MediaImage, MediaVideo, useMediaDraggable, type MediaAsset } from '@/media'
import {
  addToCanvas, copyText, deleteBatch, downloadAsset, deleteItem, fillFromItem, referenceFrom, regenerate, useStars,
} from './actions'
import { useModels } from '../composer/hooks'
import { summaryParams } from '../composer/logic'
import { AvatarResultMeta, avatarItemSummary, avatarTileLabel } from '../avatar/AvatarResult'
import { avatarDisplayParams, isAvatarParams } from '../avatar/logic'
import { openSaveTemplate } from '../templates/actions'

/** 批次「存为模板」: fresh item ids, in-batch anchors re-pointed by record id; covers = the batch's results. */
function saveBatchAsTemplate(items: ItemView[]) {
  const ids = new Map(items.map(i => [i.key, crypto.randomUUID()]))
  const byRecord = new Map(items.filter(i => i.record_id).map(i => [i.record_id!, ids.get(i.key)!]))
  openSaveTemplate({
    origin: 'batch',
    covers: items.flatMap(i => i.results.filter(a => a.kind === 'image')),
    sources: items.map(i => ({
      item_id: ids.get(i.key)!, kind: i.kind, model: i.model, prompt: i.prompt, params: i.params, mentions: i.mentions, prompt_doc: i.prompt_doc,
      anchor_of: i.anchor_record_id ? byRecord.get(i.anchor_record_id) ?? null : null, reference_asset_ids: i.references.map(r => r.id),
    })),
  })
}
import { chargeLabel, circled, differingParams, formatWait, paramText, sharedPrompt, type Group, type ItemView } from './lib'

/** Catalog display name, falling back to the id. */
function useModelName() {
  const models = useModels().data
  return (id: string) => models?.find(m => m.id === id)?.name ?? id
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function Prompt({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const long = text.split('\n').length > 4 || text.length > 180
  return (
    <div className={className}>
      <p className={cn('whitespace-pre-wrap break-words text-sm leading-6', long && !open && 'line-clamp-4')}>{text || <span className="text-muted">（无提示词）</span>}</p>
      {long && <button type="button" className="mt-0.5 cursor-pointer text-xs font-semibold text-muted hover:text-ink" onClick={() => setOpen(!open)}>{open ? '收起' : '展开全文'}</button>}
    </div>
  )
}

function ParamLine({ item, diff, label }: { item: ItemView; diff: Set<string>; label?: string }) {
  const hl = (name: string) => diff.has(name) ? 'font-bold text-ink' : 'text-muted'
  const modelName = useModelName()
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      {label && <span className="font-semibold text-ink">{label}</span>}
      <span className={hl('model')}>{isAvatarParams(item.params) ? avatarItemSummary(item) : modelName(item.model)}</span>
      {summaryParams(isAvatarParams(item.params) ? avatarDisplayParams(item.params) : item.params).map(([k, v]) => <span key={k} className={hl(k)}>· {paramText(v, k)}</span>)}
      {item.anchor_record_id && <Badge tone="outline" className="h-5 px-1.5 text-[11px]">引用锚图</Badge>}
    </div>
  )
}

/** Right side: what was sent. */
export function RequestBubble({ group, onEditBatch }: { group: Group; onEditBatch: (items: ItemView[]) => void }) {
  const { items } = group
  const shared = sharedPrompt(items)
  const diff = differingParams(items)
  const first = items[0]!
  const batch = items.length > 1
  const mentions = [...new Map(items.flatMap(i => i.mentions).map(m => [`${m.type}:${m.id}`, m])).values()]
  const refs = [...new Map(items.flatMap(i => i.references).map(r => [r.id, r])).values()]
  return (
    <div className="flex justify-end">
      <article aria-label="请求" className="group/req w-fit max-w-[min(640px,88%)] rounded-panel rounded-tr-control border border-line bg-card px-4 py-3">
        {shared !== null && <Prompt text={shared} />}
        {mentions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {mentions.map(m => <Badge key={`${m.type}:${m.id}`} tone="neutral" className="h-6"><AtSign className="size-3" />{m.name}</Badge>)}
          </div>
        )}
        {refs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {refs.map(r => <MediaImage key={r.id} asset={r} alt="参考图" hideBadge className="size-12 rounded-control" />)}
          </div>
        )}
        <div className={cn('mt-2 grid gap-1.5', batch && 'border-t border-line pt-2')}>
          {items.map((it, i) => (
            <div key={it.key} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <ParamLine item={it} diff={diff} label={batch ? circled(i + 1) : undefined} />
                {shared === null && <Prompt text={it.prompt} className="mt-0.5 text-muted" />}
              </div>
              {batch && <IconButton label="编辑此项后重发" size="icon-sm" className="-my-1 size-7" onClick={() => fillFromItem(it)}><PencilLine className="size-3.5" /></IconButton>}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1">
          <time className="mr-auto text-xs text-muted" dateTime={group.created_at}>{time(group.created_at)}</time>
          <IconButton label="复制提示词" size="icon-sm" onClick={() => void copyText(shared ?? items.map((it, i) => `${circled(i + 1)} ${it.prompt}`).join('\n'))}><Copy className="size-4" /></IconButton>
          <Button size="sm" variant="ghost" icon={<PencilLine className="size-4" />} onClick={() => batch ? onEditBatch(items) : fillFromItem(first)}>编辑后重发</Button>
        </div>
      </article>
    </div>
  )
}

/** §4.2 staged copy + elapsed + indeterminate bar. The gateway sends no progress, so never a percentage. */
function Stage({ text, waited }: { text: string; waited: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="flex items-center gap-1.5 text-sm"><LoaderCircle className="size-4 motion-safe:animate-spin-slow" />{text}<span className="text-xs text-muted tabular-nums">· {waited}</span></p>
      <IndeterminateBar label={text} />
    </div>
  )
}

function Status({ item, now }: { item: ItemView; now: number }) {
  const waited = `已等待 ${formatWait(now - Date.parse(item.created_at))}`
  switch (item.status) {
    case 'submitting':
      return <p className="flex items-center gap-1.5 text-sm text-muted"><LoaderCircle className="size-4 motion-safe:animate-spin-slow" />提交中</p>
    case 'queued':
    case 'running':
      return <Stage text={item.status === 'queued' ? '排队中' : '生成中'} waited={waited} />
    case 'failed':
    case 'submit_failed':
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-danger"><TriangleAlert className="size-4" />{item.failure}</span>
          <span className="text-xs text-muted">{item.status === 'submit_failed' || Number(item.charged_points ?? 0) === 0 ? '未消耗积分' : `消耗积分 ${formatPoints(item.charged_points)}`}</span>
          <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => regenerate(item)}>重试</Button>
        </div>
      )
    case 'cancelled':
      return <p className="text-sm text-muted">已取消{item.failure ? ` · ${item.failure}` : ''} · 未消耗积分</p>
    default:
      return null
  }
}

function ResultTile({ asset, item, index, onPreview }: { asset: MediaAsset; item: ItemView; index: number; onPreview: () => void }) {
  const starred = useStars(s => s.ids.has(asset.id))
  const toggle = useStars(s => s.toggle)
  // Drag into the composer slots / asset folders (keyboard alternative: 以此为参考). No drag attributes: the tile already holds buttons.
  const drag = useMediaDraggable(`result:${item.item_id ?? item.record_id}:${asset.id}`, [asset])
  const ratio = asset.width && asset.height ? asset.width / asset.height : 1
  const stub = (t: string) => () => toast({ title: t, description: '即将开放' })
  const actions: { label: string; icon: LucideIcon; run: () => void }[] = [
    { label: '再生成', icon: RefreshCw, run: () => regenerate(item) },
    ...(asset.kind === 'image' ? [{ label: '以此为参考', icon: ImagePlus, run: () => referenceFrom(asset) }] : []),
    { label: '放大预览', icon: Maximize2, run: onPreview },
    { label: '下载', icon: Download, run: () => void downloadAsset(asset, item.record_id ?? item.item_id ?? 'result', index) },
    { label: '放到画布', icon: LayoutDashboard, run: () => addToCanvas(item, asset) },
    { label: '存入素材', icon: FolderPlus, run: stub('存入素材') },
    { label: '存为主体', icon: UserPlus, run: stub('存为主体') },
  ]
  return (
    <figure ref={drag.setNodeRef} {...drag.listeners} className={cn('group/tile relative shrink-0 cursor-grab overflow-hidden rounded-card bg-subtle', drag.isDragging && 'opacity-50')} style={{ height: 'var(--tile-h)', width: `calc(var(--tile-h) * ${ratio})` }}>
      <button type="button" aria-label={`放大预览第 ${index + 1} 张`} className="block h-full w-full cursor-zoom-in" onClick={onPreview}>
        {asset.kind === 'video'
          ? <MediaVideo asset={asset} label={`${item.model} 结果`} className="h-full w-full" focusable={false} />
          : <MediaImage asset={asset} alt={`${item.model} 结果 ${index + 1}`} className="h-full w-full" />}
      </button>
      {avatarTileLabel(item.params, index) && <Badge tone="ink" className="absolute left-2 top-2 h-5 px-1.5 text-[11px]">带字幕版</Badge>}
      {item.anchor && index === 0 && <Badge tone="ink" className="absolute left-2 top-2 h-5 px-1.5 text-[11px]">锚</Badge>}
      <IconButton label={starred ? '取消最佳' : '选为最佳'} size="icon-sm" aria-pressed={starred}
        className={cn('absolute right-1.5 top-1.5 bg-card/90', !starred && 'md:opacity-0 md:group-hover/tile:opacity-100 md:focus-visible:opacity-100')} onClick={() => toggle(asset.id)}>
        <Star className={cn('size-4', starred && 'fill-current')} />
      </IconButton>
      <div className="absolute inset-x-1.5 bottom-1.5 hidden flex-wrap justify-end gap-0.5 rounded-control bg-card/92 p-0.5 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 md:flex">
        {actions.map(a => <IconButton key={a.label} label={a.label} size="icon-sm" onClick={a.run}><a.icon className="size-4" /></IconButton>)}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="更多操作" className={cn('absolute bottom-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-card/92 md:hidden', focusRing)}><MoreHorizontal className="size-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map(a => <DropdownMenuItem key={a.label} onSelect={a.run}><a.icon className="size-4" />{a.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </figure>
  )
}

function ItemCell({ item, label, now, onPreview, canDelete }: { item: ItemView; label?: string; now: number; onPreview: (assets: MediaAsset[], i: number) => void; canDelete: boolean }) {
  const stars = useStars(s => s.ids)
  const results = [...item.results].sort((a, b) => Number(stars.has(b.id)) - Number(stars.has(a.id)))
  return (
    <div className="grid gap-2">
      {(label || canDelete) && (
        <div className="flex items-center gap-2 text-xs">
          {label && <span className="font-semibold">{label}</span>}
          {item.status === 'succeeded' && <span className="text-muted">{item.charged_points == null ? '结算中' : formatPoints(item.charged_points)}</span>}
          {canDelete && item.record_id && <IconButton label="删除此项" size="icon-sm" className="ml-auto size-7" onClick={() => deleteItem(item)}><Trash2 className="size-3.5" /></IconButton>}
        </div>
      )}
      <Status item={item} now={now} />
      <AvatarResultMeta item={item} />
      {item.status === 'succeeded' && !results.length && (item.kind === 'video'
        ? <p className="text-sm text-muted">视频已生成，结果暂不可预览</p>
        : <Stage text="处理结果" waited={`已等待 ${formatWait(now - Date.parse(item.created_at))}`} />)}
      {results.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [--tile-h:180px] max-md:[--tile-h:132px]">
          {results.map((a, i) => <ResultTile key={a.id} asset={a} item={item} index={i} onPreview={() => onPreview(results, i)} />)}
        </div>
      )}
    </div>
  )
}

/** Left side: per-item status and results. */
export function ResultBubble({ group, onPreview }: { group: Group; onPreview: (assets: MediaAsset[], i: number) => void }) {
  const { items } = group
  const batch = items.length > 1
  const [layout, setLayout] = useState<'position' | 'model'>('position')
  const now = useNow(items.some(i => i.status === 'queued' || i.status === 'running' || (i.status === 'succeeded' && !i.results.length && i.kind === 'image')))
  const charge = chargeLabel(items)
  const done = items.filter(i => i.status === 'succeeded').length
  const models = [...new Set(items.map(i => i.model))]
  const deletable = items.some(i => i.record_id)
  const modelName = useModelName()
  return (
    <article aria-label="结果" className="w-full max-w-[min(960px,100%)] rounded-panel rounded-tl-control border border-line bg-paper px-4 py-3">
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {batch && <span>{items.length} 项 · 完成 {done}</span>}
        {charge && <span className={cn('tabular-nums', charge === '结算中' ? 'text-warning' : 'text-ink')}>{charge}</span>}
        <div className="ml-auto flex items-center gap-1">
          {batch && models.length > 1 && (
            <SegmentedControl label="结果排列" value={layout} onValueChange={setLayout} className="h-8" options={[{ value: 'position', label: '按序号' }, { value: 'model', label: '按型号分列' }]} />
          )}
          {batch && <IconButton label="存为模板" size="icon-sm" onClick={() => saveBatchAsTemplate(items)}><BookmarkPlus className="size-4" /></IconButton>}
          {deletable && (group.batch_id && batch
            ? <IconButton label="删除整批" size="icon-sm" onClick={() => deleteBatch(group.batch_id!)}><Trash2 className="size-4" /></IconButton>
            : !batch && <IconButton label="删除" size="icon-sm" onClick={() => deleteItem(items[0]!)}><Trash2 className="size-4" /></IconButton>)}
        </div>
      </header>
      {layout === 'model' && batch && models.length > 1 ? (
        <div className="grid gap-4 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${models.length}, minmax(200px, 1fr))` }}>
          {models.map(m => {
            const col = items.filter(i => i.model === m)
            return (
              <section key={m} aria-label={m} className="grid content-start gap-3">
                <h3 className="flex items-center gap-2 border-b border-line pb-1 text-xs font-semibold">{modelName(m)}<span className="font-normal text-muted">{chargeLabel(col) ?? ''}</span></h3>
                {col.map(it => <ItemCell key={it.key} item={it} label={circled(items.indexOf(it) + 1)} now={now} onPreview={onPreview} canDelete />)}
              </section>
            )
          })}
        </div>
      ) : (
        <div className={cn('grid gap-3', batch && 'divide-y divide-line [&>*:not(:first-child)]:pt-3')}>
          {items.map((it, i) => <ItemCell key={it.key} item={it} label={batch ? `${circled(i + 1)} ${modelName(it.model)}` : undefined} now={now} onPreview={onPreview} canDelete={batch} />)}
        </div>
      )}
    </article>
  )
}
