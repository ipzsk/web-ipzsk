import { useState, type FormEvent } from 'react'
import { BookmarkPlus, Copy, ImagePlus, Layers, ListPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { MediaImage, MissingMedia } from '@/media'
import {
  Button, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  EmptyState, ErrorState, Input, Skeleton, cn, focusRing,
} from '@/ui'
import type { UserTemplate } from '../api/templates'
import { isMissingAsset } from '../api/subjects'
import { AssetPicker } from '../subjects/SubjectEditor'
import { deleteTemplateWithUndo, duplicateTemplate, patchTemplate, useTemplates } from './actions'
import { TEMPLATE_NAME_MAX, slotsOf, templateAvatarSlots } from './logic'
import { startApply } from './TemplateDialogs'

function Cover({ t }: { t: UserTemplate }) {
  if (isMissingAsset(t.cover)) return <MissingMedia label="封面已删除" className="size-full" />
  if (t.cover) return <MediaImage asset={t.cover} alt="" hideBadge className="size-full" />
  return <div className="grid size-full place-items-center bg-subtle text-muted"><Layers className="size-8" aria-hidden /></div>
}

function TemplateCard({ t, onRename, onCover }: { t: UserTemplate; onRename: () => void; onCover: () => void }) {
  const temp = t.id.startsWith('temp-')
  const slots = t.items.reduce((n, i) => n + slotsOf(i).length, 0) + templateAvatarSlots(t.items).length
  return (
    <li className={cn('group relative flex flex-col overflow-hidden rounded-card border border-line bg-card transition-[transform,box-shadow] duration-(--duration-fast) hover:-translate-y-px hover:shadow-lg', temp && 'opacity-70')}>
      <div className="aspect-[4/3] overflow-hidden"><Cover t={t} /></div>
      <div className="grid gap-1 px-3 pt-2.5">
        <p className="truncate text-sm font-semibold" title={t.name}>{t.name}</p>
        <p className="text-xs text-muted">{t.items.length} 项{t.variables.length ? ` · ${t.variables.length} 个变量` : ''}{slots ? ` · 需放入 ${slots} 个素材` : ''}</p>
      </div>
      <div className="mt-auto flex items-center gap-1 px-2 py-2">
        <Button size="sm" variant="primary" icon={<ListPlus className="size-4" />} disabled={temp} disabledReason="正在保存…" onClick={() => void startApply(t)}>应用</Button>
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={temp} aria-label={`管理模板 ${t.name}`} className={cn('grid size-8 cursor-pointer place-items-center rounded-control hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45', focusRing)}><MoreHorizontal className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}><Pencil className="size-4" />重命名</DropdownMenuItem>
            <DropdownMenuItem onSelect={onCover}><ImagePlus className="size-4" />改封面</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void duplicateTemplate(t)}><Copy className="size-4" />复制成新模板</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => deleteTemplateWithUndo(t)} className="text-danger"><Trash2 className="size-4" />删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/** §2.8 「我的模板」: inspiration category and assets tab (same list; apply + manage). */
export function TemplatesPanel() {
  const q = useTemplates()
  const [renaming, setRenaming] = useState<UserTemplate | null>(null)
  const [covering, setCovering] = useState<UserTemplate | null>(null)
  const [title, setTitle] = useState('')

  const rename = (e: FormEvent) => {
    e.preventDefault()
    const t = renaming, name = title.trim()
    setRenaming(null)
    if (t && name && name !== t.name) void patchTemplate(t, { name })
  }

  return (
    <section aria-label="我的模板">
      {q.isPending ? (
        <ul aria-busy className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {Array.from({ length: 6 }, (_, i) => <li key={i} className="overflow-hidden rounded-card border border-line"><Skeleton className="aspect-[4/3] rounded-none" /><Skeleton className="m-3 h-4 w-2/3" /></li>)}
        </ul>
      ) : q.isError ? (
        <ErrorState reason="模板加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void q.refetch() }} />
      ) : !q.data.length ? (
        <EmptyState icon={BookmarkPlus} illustration="board" text="还没有模板：在队列条或批次结果上点「存为模板」" />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 max-sm:grid-cols-2 max-sm:gap-3">
          {q.data.map(t => <TemplateCard key={t.id} t={t} onRename={() => { setTitle(t.name); setRenaming(t) }} onCover={() => setCovering(t)} />)}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} loadingText="加载中" onClick={() => void q.fetchNextPage()}>加载更多模板</Button>
        </div>
      )}

      <Dialog open={!!renaming} onOpenChange={o => { if (!o) setRenaming(null) }}>
        <DialogContent title="重命名模板">
          <form onSubmit={rename}>
            <Input label="模板名称" value={title} maxLength={TEMPLATE_NAME_MAX} autoFocus onChange={e => setTitle(e.target.value)} />
            <DialogFooter>
              <Button type="button" onClick={() => setRenaming(null)}>取消</Button>
              <Button type="submit" variant="primary" disabled={!title.trim()} disabledReason="名称不能为空">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AssetPicker open={!!covering} onOpenChange={o => { if (!o) setCovering(null) }} room={1} existing={[]}
        onPick={([a]) => { if (covering && a) void patchTemplate(covering, { cover_id: a.id }, a) }} />
    </section>
  )
}
