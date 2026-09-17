import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ImageUp, Images, RotateCw, Search, UserRound, X } from 'lucide-react'
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, Input, SegmentedControl, Skeleton, cn, focusRing, toast } from '@/ui'
import { MediaImage, MediaVideo, useUpload, type MediaAsset } from '@/media'
import { uploadApi } from '../composer/uploadApi'
import { listErrorMessage, useAvatars } from './api'
import type { AvatarItem } from './contract'
import { pickAvatar, pickPhoto } from './draft'
import { photoAssetReason, validatePhotoFile } from './logic'
import { AssetPicker } from '../subjects/SubjectEditor'

type Gender = 'all' | 'female' | 'male'
type Kind = 'all' | 'avatar' | 'talking_photo'
const chip = (on: boolean) => cn('inline-flex h-8 shrink-0 cursor-pointer items-center rounded-full border px-3 text-[13px] font-semibold transition-colors duration-(--duration-fast)', on ? 'border-acid bg-acid text-white' : 'border-line bg-card hover:bg-subtle', focusRing)

/** 预览图作为 MediaImage 的 urls（无 asset id，签名刷新不适用：HeyGen 公网地址）。 */
export const previewUrls = (url: string | null | undefined) => url ? { orig: url } : null

export function AvatarThumb({ avatar, className }: { avatar: Pick<AvatarItem, 'name' | 'preview_image_url'>; className?: string }) {
  const urls = previewUrls(avatar.preview_image_url)
  return urls
    ? <MediaImage urls={urls} alt={avatar.name} hideBadge className={className} />
    : <span aria-hidden className={cn('grid place-items-center bg-subtle text-muted', className)}><UserRound className="size-1/2" /></span>
}

const EngineBadges = ({ engines }: { engines: string[] }) => (
  <span className="flex gap-1">
    {engines.includes('avatar_iv') && <Badge tone="ink" className="h-5 px-1.5 text-[10px]">IV</Badge>}
    {engines.includes('avatar_iii') && <Badge tone="outline" className="h-5 bg-card/90 px-1.5 text-[10px]">III</Badge>}
  </span>
)

function AvatarCard({ avatar, selected, onPick }: { avatar: AvatarItem; selected: boolean; onPick: () => void }) {
  return (
    <li className={cn('group relative overflow-hidden rounded-card border bg-card transition-[transform,box-shadow] duration-(--duration-fast) hover:-translate-y-px hover:shadow-lg', selected ? 'border-2 border-ink' : 'border-line')}>
      <button type="button" onClick={onPick} aria-pressed={selected} aria-label={`选择形象 ${avatar.name}`} className={cn('block w-full cursor-pointer text-left', focusRing)}>
        <div className="relative aspect-[4/5] bg-subtle">
          {avatar.preview_video_url
            ? <MediaVideo src={avatar.preview_video_url} poster={avatar.preview_image_url ?? undefined} width={4} height={5} label={`${avatar.name} 预览`} className="size-full" focusable={false} />
            : <AvatarThumb avatar={avatar} className="size-full" />}
          <span className="absolute left-1.5 top-1.5"><EngineBadges engines={avatar.engines} /></span>
          {selected && <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-acid text-white"><Check className="size-4" /></span>}
        </div>
        <div className="grid gap-0.5 px-2.5 py-2">
          <span className="truncate text-[13px] font-semibold">{avatar.name}</span>
          <span className="text-[11px] text-muted">{avatar.type === 'talking_photo' ? '照片数字人' : '数字人'}{avatar.gender ? ` · ${avatar.gender === 'female' ? '女' : avatar.gender === 'male' ? '男' : avatar.gender}` : ''}{avatar.default_voice_id ? ' · 自带音色' : ''}</span>
        </div>
      </button>
    </li>
  )
}

function Library({ selectedId, onDone }: { selectedId: string | null; onDone: () => void }) {
  const q = useAvatars()
  const [search, setSearch] = useState('')
  const [gender, setGender] = useState<Gender>('all')
  const [kind, setKind] = useState<Kind>('all')
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (q.data ?? []).filter(a => (gender === 'all' || a.gender === gender) && (kind === 'all' || a.type === kind) && (!t || a.name.toLowerCase().includes(t)))
  }, [q.data, search, gender, kind])
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="搜索形象" placeholder="搜索形象名称" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="性别">
          {([['all', '全部'], ['female', '女'], ['male', '男']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={gender === v} className={chip(gender === v)} onClick={() => setGender(v)}>{l}</button>)}
        </div>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label="类型">
          {([['all', '全部类型'], ['avatar', '数字人'], ['talking_photo', '照片数字人']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={kind === v} className={chip(kind === v)} onClick={() => setKind(v)}>{l}</button>)}
        </div>
      </div>
      <div className="max-h-[min(60dvh,560px)] overflow-y-auto pr-1">
        {q.isPending ? (
          <ul aria-busy className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
            {Array.from({ length: 8 }, (_, i) => <li key={i} className="overflow-hidden rounded-card border border-line"><Skeleton className="aspect-[4/5] rounded-none" /><Skeleton className="m-2 h-3 w-2/3" /></li>)}
          </ul>
        ) : q.isError ? (
          <ErrorState reason={listErrorMessage(q.error)} action={{ label: '重试', onClick: () => void q.refetch() }} />
        ) : !q.data.length ? (
          <EmptyState icon={UserRound} text="形象库还没有可用的数字人" action={{ label: '刷新', onClick: () => void q.refetch() }} />
        ) : !shown.length ? (
          <EmptyState icon={Search} text="没有符合筛选的形象" action={{ label: '清除筛选', onClick: () => { setSearch(''); setGender('all'); setKind('all') } }} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
            {shown.map(a => <AvatarCard key={a.id} avatar={a} selected={a.id === selectedId} onPick={() => { pickAvatar(a); onDone() }} />)}
          </ul>
        )}
      </div>
    </div>
  )
}

/** 「用我的照片」：PNG/JPEG 直传（WebP 客户端拒收），完成后设为形象。授权勾选在输入框里，发送前必勾。 */
export function usePhotoUpload(onDone: (a: MediaAsset) => void, storageKey: string) {
  const upload = useUpload({ api: uploadApi, storageKey })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const done = upload.items.find(u => u.status === 'done' && u.asset)
    if (!done) return
    upload.remove(done.clientId)
    onDone(done.asset!)
  }, [upload.items]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (files: File[]) => {
    const f = files[0]
    if (!f) return
    const reason = validatePhotoFile(f)
    if (reason) { toast({ title: '无法使用这张照片', description: reason, tone: 'error' }); return }
    const errors = upload.add([f])
    if (errors.length) toast({ title: '无法上传', description: errors.join('；'), tone: 'error' })
  }
  const busy = upload.items.find(u => u.status !== 'done')
  const picker = <input ref={input} type="file" accept="image/png,image/jpeg" hidden onChange={e => { add([...(e.target.files ?? [])]); e.target.value = '' }} />
  return { add, busy, upload, open: () => input.current?.click(), picker }
}

function PhotoTab({ onDone }: { onDone: () => void }) {
  const ph = usePhotoUpload(a => { pickPhoto(a); onDone() }, 'ipzsk:avatar-photo-upload')
  const [over, setOver] = useState(false)
  const [library, setLibrary] = useState(false)
  return (
    <div className="grid gap-3">
      {ph.picker}
      <AssetPicker open={library} onOpenChange={setLibrary} room={1} existing={[]} description="选一张 PNG / JPEG 人像照片" disabledReason={photoAssetReason}
        onPick={([a]) => { if (a) { pickPhoto(a); onDone() } }} />
      <button
        type="button" onClick={ph.open}
        onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); ph.add([...e.dataTransfer.files]) }}
        className={cn('flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 text-center transition-colors', over ? 'border-acid-deep bg-acid/15' : 'border-line hover:bg-subtle', focusRing)}
      >
        <ImageUp className="size-8 text-muted" />
        <span className="text-sm font-semibold">上传一张正脸人像照片</span>
        <span className="text-xs text-muted">仅 PNG / JPEG，≤20MB；HeyGen 不支持 WebP。照片需要清晰人脸、光线充足。</span>
      </button>
      <Button variant="secondary" icon={<Images className="size-4" />} onClick={() => setLibrary(true)} className="justify-self-start">从素材选择</Button>
      {ph.busy && (
        <div role="status" className="flex items-center gap-2 rounded-control bg-subtle px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{ph.busy.name}</span>
          {ph.busy.status === 'failed'
            ? <><span className="text-danger">{ph.busy.error}</span><Button size="sm" icon={<RotateCw className="size-4" />} onClick={() => ph.upload.retry(ph.busy!.clientId)}>重试</Button></>
            : ph.busy.status === 'interrupted' ? <span className="text-muted">{ph.busy.error}</span>
            : <span className="tabular-nums text-muted">{ph.busy.status === 'processing' ? '处理中' : `${Math.round(ph.busy.progress * 100)}%`}</span>}
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => ph.upload.remove(ph.busy!.clientId)}>取消</Button>
        </div>
      )}
      <p className="text-xs text-muted">上传后需要在输入框勾选「我确认拥有该肖像的使用授权」才能发送。</p>
    </div>
  )
}

export function AvatarPicker({ open, onOpenChange, selectedId, photoReason, initialTab = 'library' }: {
  open: boolean; onOpenChange: (o: boolean) => void; selectedId: string | null; photoReason: string | null; initialTab?: 'library' | 'photo'
}) {
  const [tab, setTab] = useState<'library' | 'photo'>(initialTab)
  useEffect(() => { if (open) setTab(photoReason ? 'library' : initialTab) }, [open, initialTab, photoReason])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="选择形象" description="从形象库挑一个数字人（悬停预览），或用你自己的照片。" className="max-w-3xl max-md:top-auto max-md:bottom-0 max-md:translate-y-0 max-md:rounded-b-none max-md:p-4">
        <SegmentedControl label="形象来源" value={tab} onValueChange={setTab} className="mb-3" options={[
          { value: 'library', label: '形象库', icon: UserRound },
          { value: 'photo', label: '用我的照片', icon: ImageUp, disabledReason: photoReason ?? undefined },
        ]} />
        {tab === 'library' ? <Library selectedId={selectedId} onDone={() => onOpenChange(false)} /> : <PhotoTab onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}
