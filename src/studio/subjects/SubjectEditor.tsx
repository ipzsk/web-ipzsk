import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Box, Check, Drama, ImagePlus, Mountain, Package, RotateCw, ScanFace, Star, Upload, User, X, type LucideIcon } from 'lucide-react'
import { ApiError } from '@/shared/api'
import { Button, Dialog, DialogContent, DialogFooter, EmptyState, ErrorState, IconButton, Input, SegmentedControl, Skeleton, Textarea, cn, toast } from '@/ui'
import { MediaImage, useUpload, type MediaAsset } from '@/media'
import { SUBJECT_KINDS, SUBJECT_KIND_LABEL, presentAssets, subjectErrorMessage, type Subject, type SubjectKind } from '../api/subjects'
import { useSubjects } from '../composer/hooks'
import { uploadApi } from '../composer/uploadApi'
import { createSubjectOptimistic, setAssetsOptimistic, updateSubjectOptimistic } from './actions'
import { useMyImages } from './assetsApi'
import { ASSETS_MAX, NAME_MAX, NOTE_MAX, addAssets, coverOf, firstError, moveAsset, validateSubject } from './logic'

export const SUBJECT_KIND_ICON: Record<SubjectKind, LucideIcon> = { person: User, character: Drama, product: Package, object: Box, scene: Mountain, avatar: ScanFace }

// ── public API ────────────────────────────────────────────────────────────

export interface SubjectEditorOptions {
  /** Edit an existing subject; omit to create. */
  subject?: Subject
  /** Create prefilled with these images (「存为主体」 from result / asset cards). Non-images are ignored, capped at 8. */
  initialAssets?: MediaAsset[]
  kind?: SubjectKind
  name?: string
  /** Called with the server copy after a successful create/save. */
  onSaved?: (subject: Subject) => void
}

const useEditorState = create<{ open: boolean; session: number; opts: SubjectEditorOptions }>(() => ({ open: false, session: 0, opts: {} }))

/**
 * Open the subject editor from anywhere (§2.9 entries):
 *   openSubjectEditor({ initialAssets: [asset] })                     // 「存为主体」
 *   openSubjectEditor({ onSaved: s => insertSubjectMention(s) })      // @ panel 「创建主体」
 *   openSubjectEditor({ subject })                                    // edit
 * Requires <SubjectEditorHost/> mounted once (studio Layout does this).
 */
export function openSubjectEditor(opts: SubjectEditorOptions = {}) {
  useEditorState.setState(s => ({ open: true, session: s.session + 1, opts }))
}

export function SubjectEditorHost() {
  const { open, session, opts } = useEditorState()
  return (
    <Dialog open={open} onOpenChange={o => useEditorState.setState({ open: o })}>
      {open && <Editor key={session} opts={opts} close={() => useEditorState.setState({ open: false })} />}
    </Dialog>
  )
}

// ── editor ────────────────────────────────────────────────────────────────

function Tile({ asset, index, isCover, onCover, onRemove, removeReason }: {
  asset: MediaAsset; index: number; isCover: boolean; onCover: () => void; onRemove: () => void; removeReason: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: asset.id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn('group relative aspect-square', isDragging && 'z-10 opacity-50')}>
      <div
        {...attributes} {...listeners}
        aria-label={`参考图 ${index + 1}${isCover ? '（封面）' : ''}，按空格后用方向键排序`}
        className={cn('size-full cursor-grab overflow-hidden rounded-[10px] border bg-subtle outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:cursor-grabbing', isCover ? 'border-2 border-ink' : 'border-line')}
      >
        <MediaImage asset={asset} alt={`参考图 ${index + 1}`} hideBadge className="size-full" />
      </div>
      <span className="pointer-events-none absolute bottom-1 left-1 rounded-[4px] bg-ink/70 px-1 text-[10px] leading-4 text-card">{isCover ? '封面' : index + 1}</span>
      <IconButton
        label={isCover ? '当前封面' : '设为封面'} size="icon-sm" variant={isCover ? 'primary' : 'secondary'} aria-pressed={isCover} onClick={onCover}
        className={cn('absolute bottom-1 right-1 size-7 rounded-full', !isCover && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100')}
      ><Star className={cn('size-3.5', isCover && 'fill-current')} /></IconButton>
      <IconButton
        label={`移除参考图 ${index + 1}`} size="icon-sm" variant="primary" onClick={onRemove} disabled={!!removeReason} disabledReason={removeReason ?? undefined}
        className="absolute -right-1.5 -top-1.5 size-6 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      ><X className="size-3" /></IconButton>
    </li>
  )
}

function Editor({ opts, close }: { opts: SubjectEditorOptions; close: () => void }) {
  const editing = opts.subject
  const { data: all } = useSubjects(true)
  const [name, setName] = useState(editing?.name ?? opts.name ?? '')
  const [kind, setKind] = useState<SubjectKind>(editing?.kind ?? opts.kind ?? 'person')
  const [note, setNote] = useState(editing?.note ?? '')
  const [assets, setAssets] = useState<MediaAsset[]>(() => editing ? presentAssets(editing) : addAssets([], opts.initialAssets ?? []).assets)
  const [coverId, setCoverId] = useState<string | null>(editing?.cover?.id ?? null)
  const [serverNameError, setServerNameError] = useState<{ name: string; message: string } | null>(null)
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const upload = useUpload({ api: uploadApi, storageKey: 'ipzsk:subject-uploads' })
  const pending = upload.items.filter(u => u.status !== 'done')

  const errors = validateSubject({ name, note, assets }, all ?? [], editing?.id)
  if (serverNameError && serverNameError.name === name && !errors.name) errors.name = serverNameError.message
  const saveReason = pending.some(u => u.status === 'uploading' || u.status === 'processing') ? '参考图还在上传' : firstError(errors)
  const cover = coverOf(assets, coverId)

  // Edit mode: every reference change is committed right away (optimistic, rolled back on failure). Create mode: local until 「创建」.
  const commitAssets = (next: MediaAsset[], nextCover = coverId) => {
    const prev = { assets, coverId }
    setAssets(next); setCoverId(nextCover)
    if (!editing) return
    void (async () => {
      try {
        if (next !== prev.assets) await setAssetsOptimistic(editing.id, next)
        if (nextCover !== prev.coverId) await updateSubjectOptimistic(editing.id, { cover_id: coverOf(next, nextCover) })
      } catch (e) {
        setAssets(prev.assets); setCoverId(prev.coverId)
        toast({ title: '参考图没有保存，已恢复', description: subjectErrorMessage(e), tone: 'error' })
      }
    })()
  }

  const add = (incoming: MediaAsset[]) => {
    const r = addAssets(assets, incoming)
    if (r.dropped) toast({ title: `最多 ${ASSETS_MAX} 张参考图`, description: `有 ${r.dropped} 张没有加入。` })
    if (r.assets.length !== assets.length) commitAssets(r.assets)
  }

  // Finished uploads → references.
  useEffect(() => {
    const done = upload.items.filter(u => u.status === 'done' && u.asset)
    if (!done.length) return
    add(done.map(u => u.asset!))
    done.forEach(u => upload.remove(u.clientId))
  }, [upload.items]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = (files: File[]) => {
    const room = ASSETS_MAX - assets.length - pending.length
    if (room <= 0) { toast({ title: `最多 ${ASSETS_MAX} 张参考图`, tone: 'error' }); return }
    const images = files.filter(f => f.type.startsWith('image/'))
    const errs = [
      ...(images.length < files.length ? ['只能上传图片'] : []),
      ...(images.length > room ? [`最多还能加 ${room} 张，其余已忽略`] : []),
      ...upload.add(images.slice(0, room)),
    ]
    if (errs.length) toast({ title: '部分文件未添加', description: errs.join('；'), tone: 'error' })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) commitAssets(moveAsset(assets, String(active.id), String(over.id)))
  }

  const save = async () => {
    setTouched(true)
    if (saveReason || saving) return
    setSaving(true)
    try {
      const s = editing
        ? await updateSubjectOptimistic(editing.id, { name: name.trim(), kind, note })
        : await createSubjectOptimistic({ name, kind, note, assets, cover_id: cover })
      close()
      toast({ title: editing ? '已保存' : `已创建主体「${s.name}」`, tone: 'success' })
      opts.onSaved?.(s)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'subject_name_taken') setServerNameError({ name, message: subjectErrorMessage(e) })
      else toast({ title: editing ? '保存失败' : '创建失败', description: subjectErrorMessage(e), tone: 'error' })
    } finally { setSaving(false) }
  }

  const full = assets.length + pending.length >= ASSETS_MAX
  const fullReason = `最多 ${ASSETS_MAX} 张参考图`
  const showName = touched || name.length > 0

  return (
    <DialogContent
      title={editing ? '编辑主体' : '创建主体'}
      description="主体是一组有名字的参考图；在输入框里 @ 它，多次生成能保持同一个人物、角色或商品。"
      className={cn('max-h-[90dvh] max-w-xl overflow-y-auto', 'max-md:bottom-0 max-md:top-auto max-md:max-w-none max-md:w-full max-md:translate-y-0 max-md:rounded-b-none max-md:pb-[max(24px,env(safe-area-inset-bottom))]')}
      onInteractOutside={e => { if (saving) e.preventDefault() }}
    >
      <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void save() }}>
        <Input
          label="名称" value={name} maxLength={NAME_MAX + 10} autoFocus placeholder="如：橘猫阿福"
          onChange={e => setName(e.target.value)} onBlur={() => setTouched(true)}
          error={showName ? errors.name : undefined} hint={`${[...name.trim()].length}/${NAME_MAX}，同一账号内不能重名`}
        />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">类型</span>
          <SegmentedControl label="类型" value={kind} onValueChange={setKind} className="max-w-full overflow-x-auto [&>*]:shrink-0 [&_button]:whitespace-nowrap" options={SUBJECT_KINDS.map(k => ({ value: k, label: SUBJECT_KIND_LABEL[k], icon: SUBJECT_KIND_ICON[k] }))} />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">参考图</span>
            <span className="text-xs text-muted tabular-nums">{assets.length}/{ASSETS_MAX} · 拖动排序，星标设为封面</span>
            {editing && editing.assets.length > presentAssets(editing).length && <span className="text-xs text-warning">{editing.assets.length - presentAssets(editing).length} 张素材已删除，保存参考图时移除</span>}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: '按空格拿起，用方向键移动，再按空格放下' } }}>
          <ul aria-label="参考图" className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
              <SortableContext items={assets.map(a => a.id)} strategy={rectSortingStrategy}>
                {assets.map((a, i) => (
                  <Tile
                    key={a.id} asset={a} index={i} isCover={a.id === cover}
                    onCover={() => commitAssets(assets, a.id)}
                    onRemove={() => { const next = assets.filter(x => x.id !== a.id); commitAssets(next, coverOf(next, coverId)) }}
                    removeReason={editing && assets.length === 1 ? '至少保留 1 张参考图' : null}
                  />
                ))}
              </SortableContext>
            {pending.map(u => (
              <li key={u.clientId} className="relative aspect-square overflow-hidden rounded-[10px] border border-line bg-subtle">
                {u.previewUrl && <MediaImage urls={{ orig: u.previewUrl }} alt={u.name} hideBadge className="size-full opacity-60" />}
                <div className="absolute inset-0 grid place-items-center text-xs font-semibold">
                  {u.status === 'failed' || u.status === 'interrupted'
                    ? <IconButton label={`${u.error ?? '上传失败'} · 重试`} size="icon-sm" onClick={() => u.file ? upload.retry(u.clientId) : upload.remove(u.clientId)}><RotateCw className="size-4 text-danger" /></IconButton>
                    : <span role="progressbar" aria-label={`${u.name} 上传进度`} aria-valuenow={Math.round(u.progress * 100)}>{u.status === 'processing' ? '处理中' : `${Math.round(u.progress * 100)}%`}</span>}
                </div>
                <IconButton label="取消上传" size="icon-sm" variant="primary" onClick={() => upload.remove(u.clientId)} className="absolute right-1 top-1 size-6 rounded-full"><X className="size-3" /></IconButton>
              </li>
            ))}
          </ul>
          </DndContext>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Upload className="size-4" />} disabled={full} disabledReason={fullReason} onClick={() => fileInput.current?.click()}>上传</Button>
            <Button size="sm" icon={<ImagePlus className="size-4" />} disabled={full} disabledReason={fullReason} onClick={() => setPickerOpen(true)}>从素材选择</Button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </div>
          {/* Line always reserved: the error appears on blur, and on the bottom-anchored mobile sheet a growing form moves
              the button under the pointer between pointerdown and click (the click was lost). */}
          <p className="min-h-4 text-xs leading-4 text-danger">{touched && errors.assets}</p>
        </div>

        <Textarea label="备注（可选，不参与生成）" value={note} onChange={e => setNote(e.target.value)} error={errors.note} hint={`${[...note].length}/${NOTE_MAX}`} />

        <DialogFooter className="mt-2">
          <Button onClick={close}>{editing ? '关闭' : '取消'}</Button>
          <Button type="submit" variant="primary" icon={<Check className="size-4" />} loading={saving} disabled={!!saveReason} disabledReason={saveReason ?? undefined}>
            {editing ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </form>
      <AssetPicker open={pickerOpen} onOpenChange={setPickerOpen} room={ASSETS_MAX - assets.length - pending.length} existing={assets} onPick={add} />
    </DialogContent>
  )
}

// ── asset picker ──────────────────────────────────────────────────────────

export function AssetPicker({ open, onOpenChange, room, existing, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; room: number; existing: MediaAsset[]; onPick: (a: MediaAsset[]) => void
}) {
  const q = useMyImages(open)
  const [picked, setPicked] = useState<MediaAsset[]>([])
  useEffect(() => { if (open) setPicked([]) }, [open])
  const toggle = (a: MediaAsset) => setPicked(p => p.some(x => x.id === a.id) ? p.filter(x => x.id !== a.id) : p.length >= room ? p : [...p, a])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="从素材选择" description={`还能添加 ${room} 张图片`} className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        {q.isPending ? <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-square" />)}</div>
          : q.isError ? <ErrorState reason="素材加载失败" action={{ label: '重试', onClick: () => void q.refetch() }} />
          : !q.data.length ? <EmptyState icon={ImagePlus} text="素材库里还没有图片" />
          : (
            <ul className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
              {q.data.map(a => {
                const already = existing.some(x => x.id === a.id)
                const on = picked.some(x => x.id === a.id)
                const reason = already ? '已在参考图中' : !on && picked.length >= room ? `最多还能加 ${room} 张` : null
                return (
                  <li key={a.id}>
                    <button
                      type="button" aria-pressed={on} disabled={!!reason} title={reason ?? undefined} onClick={() => toggle(a)}
                      className={cn('relative block aspect-square w-full cursor-pointer overflow-hidden rounded-[10px] border-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45', on ? 'border-ink' : 'border-transparent')}
                    >
                      <MediaImage asset={a} alt="" hideBadge className="size-full" />
                      {(on || already) && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-ink text-acid"><Check className="size-3" /></span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!picked.length} disabledReason="先选择图片" onClick={() => { onPick(picked); onOpenChange(false) }}>添加 {picked.length || ''} 张</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
