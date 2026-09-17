import { useMemo, useState } from 'react'
import { AtSign, Copy, Images, Pencil, Search, Trash2, UserPlus, Users } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, IconButton, Input, Skeleton, cn, focusRing } from '@/ui'
import { MediaImage, MissingMedia } from '@/media'
import { SUBJECT_KINDS, SUBJECT_KIND_LABEL, isMissingAsset, type Subject, type SubjectKind } from '../api/subjects'
import { useSubjects } from '../composer/hooks'
import { insertSubjectMention } from '../composer/PromptEditor'
import { selectAvatarSubject } from '../avatar/AvatarResult'
import { deleteSubjectWithUndo, duplicateSubject } from './actions'
import { SUBJECT_KIND_ICON, openSubjectEditor } from './SubjectEditor'

const KIND_ORDER = Object.fromEntries(SUBJECT_KINDS.map((k, i) => [k, i])) as Record<SubjectKind, number>

function SubjectCard({ subject }: { subject: Subject }) {
  const Icon = SUBJECT_KIND_ICON[subject.kind]
  const temp = subject.id.startsWith('temp-')
  const reason = temp ? '正在创建…' : undefined
  return (
    <li className={cn('group relative overflow-hidden rounded-card border border-line bg-card transition-[transform,box-shadow] duration-(--duration-fast) hover:-translate-y-px hover:shadow-lg', temp && 'opacity-70')}>
      <button type="button" disabled={temp} onClick={() => openSubjectEditor({ subject })} aria-label={`编辑主体 ${subject.name}`} className={cn('block w-full cursor-pointer text-left', focusRing)}>
        <div className="relative aspect-square bg-subtle">
          {!subject.cover && subject.external_ref?.preview_image_url && <MediaImage urls={{ orig: subject.external_ref.preview_image_url }} alt="" hideBadge className="size-full" />}
          {subject.cover && (isMissingAsset(subject.cover) ? <MissingMedia className="size-full" /> : <MediaImage asset={subject.cover} alt="" hideBadge className="size-full" />)}
          {/* hover: first 4 references */}
          <div className="absolute inset-0 grid grid-cols-2 gap-px bg-line opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 max-md:hidden" aria-hidden>
            {subject.assets.slice(0, 4).map(a => isMissingAsset(a) ? <MissingMedia key={a.id} className="size-full" /> : <MediaImage key={a.id} asset={a} alt="" hideBadge className="size-full" />)}
          </div>
          <Badge tone="ink" className="absolute left-2 top-2 h-6"><Icon className="size-3.5" />{SUBJECT_KIND_LABEL[subject.kind]}</Badge>
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{subject.name}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted tabular-nums"><Images className="size-3.5" />{subject.assets.length}</span>
        </div>
      </button>
      <div className="flex items-center gap-0.5 border-t border-line px-1.5 py-1">
        <Button size="sm" variant="ghost" icon={<AtSign className="size-4" />} disabled={temp} disabledReason={reason} onClick={() => subject.kind === 'avatar' ? void selectAvatarSubject(subject) : insertSubjectMention(subject)} aria-label={`@ ${subject.name} 到输入框`}>到输入框</Button>
        <div className="flex-1" />
        <IconButton size="icon-sm" label="编辑" disabled={temp} disabledReason={reason} onClick={() => openSubjectEditor({ subject })}><Pencil className="size-3.5" /></IconButton>
        <IconButton size="icon-sm" label="复制" disabled={temp} disabledReason={reason} onClick={() => void duplicateSubject(subject)}><Copy className="size-3.5" /></IconButton>
        <IconButton size="icon-sm" label="删除" disabled={temp} disabledReason={reason} onClick={() => deleteSubjectWithUndo(subject)} className="text-danger"><Trash2 className="size-3.5" /></IconButton>
      </div>
    </li>
  )
}

/** §2.9 主体库. Mounted at /studio/subjects; the assets view's 「主体」 tab should render this too. */
export function SubjectsPanel() {
  const q = useSubjects(true)
  const [kind, setKind] = useState<SubjectKind | null>(null)
  const [search, setSearch] = useState('')
  const counts = useMemo(() => Object.fromEntries(SUBJECT_KINDS.map(k => [k, (q.data ?? []).filter(s => s.kind === k).length])), [q.data])
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (q.data ?? [])
      .filter(s => (!kind || s.kind === kind) && (!term || s.name.toLowerCase().includes(term)))
      .sort((a, b) => (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99)) // §2.9: kind affects ordering; stable within a kind
  }, [q.data, kind, search])

  const chip = (value: SubjectKind | null, label: string, n: number) => (
    <button
      key={value ?? 'all'} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
      className={cn('inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors duration-(--duration-fast)', kind === value ? 'border-ink bg-ink text-acid' : 'border-line bg-card hover:bg-subtle', focusRing)}
    >{value && (() => { const I = SUBJECT_KIND_ICON[value]; return <I className="size-3.5" /> })()}{label}<span className="font-normal opacity-70 tabular-nums">{n}</span></button>
  )

  return (
    <section aria-labelledby="subjects-title">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="subjects-title" className="flex items-center gap-2 text-2xl font-bold"><Users className="size-6" />主体库</h1>
        <div className="flex-1" />
        <div className="relative w-56 max-sm:w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="搜索主体" placeholder="搜索名称" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => openSubjectEditor()}>创建主体</Button>
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {chip(null, '全部', q.data?.length ?? 0)}
        {SUBJECT_KINDS.map(k => chip(k, SUBJECT_KIND_LABEL[k], counts[k] ?? 0))}
      </div>

      <div className="mt-5">
        {q.isPending ? (
          <ul aria-busy className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {Array.from({ length: 8 }, (_, i) => <li key={i} className="overflow-hidden rounded-card border border-line"><Skeleton className="aspect-square rounded-none" /><Skeleton className="m-3 h-4 w-2/3" /></li>)}
          </ul>
        ) : q.isError ? (
          <ErrorState reason="主体加载失败，请检查网络后重试" action={{ label: '重试', onClick: () => void q.refetch() }} />
        ) : !q.data.length ? (
          <EmptyState icon={Users} illustration="camera" text="还没有主体" action={{ label: '创建主体', onClick: () => openSubjectEditor() }} />
        ) : !shown.length ? (
          <EmptyState icon={Search} text={search ? `没有名称包含「${search}」的主体` : `还没有${SUBJECT_KIND_LABEL[kind!]}类主体`} action={{ label: '清除筛选', onClick: () => { setKind(null); setSearch('') } }} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4 max-sm:grid-cols-2 max-sm:gap-3">
            {shown.map(s => <SubjectCard key={s.id} subject={s} />)}
          </ul>
        )}
        {q.hasNextPage && !q.isPending && (
          <div className="mt-5 flex flex-col items-center gap-1">
            {(search || kind) && <p className="text-xs text-muted">筛选只覆盖已加载的主体</p>}
            <Button variant="secondary" size="sm" loading={q.isFetchingNextPage} loadingText="加载中" onClick={() => void q.fetchNextPage()}>加载更多</Button>
          </div>
        )}
      </div>
    </section>
  )
}
