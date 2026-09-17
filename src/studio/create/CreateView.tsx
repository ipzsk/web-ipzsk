import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useMutationState } from '@tanstack/react-query'
import { ArrowDown, ChevronDown, MessageSquarePlus, MessagesSquare, MoreHorizontal, PencilLine, Sparkles, Trash2 } from 'lucide-react'
import {
  Button, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  ErrorState, IconButton, Input, Skeleton, cn, focusRing, toast,
} from '@/ui'
import { MediaLightbox, type MediaAsset } from '@/media'
import { reducedMotion } from '@/media/types'
import { queryClient } from '@/shared/query'
import { COMPOSER_FILL_EVENT, dispatchStudioEvent } from '@/shared/events'
import { GENERATION_SUBMIT_KEY, type PendingGeneration, type SubmitOutcome } from '../api/generation'
import { recordKeys, recordsApi, useActiveGenerations, useThreadRecords, useThreads, type GenerationRecord, type Thread } from '../api/records'
import { useComposer } from '../store'
import { deleteWithUndo, fillQueue, useHidden } from './actions'
import { RequestBubble, ResultBubble } from './Bubbles'
import { groupItems, mergeItems, newResultsAction, streamSignature, todayTitle, type ItemView, type PendingState } from './lib'

const SUGGESTIONS = ['一只橘猫戴着宇航员头盔，漂浮在空间站里，电影感光影', '极简风格的青柠气泡水产品图，白色背景，柔和阴影', '雨夜霓虹街头的少女背影，胶片质感']

export function CreateView() {
  const { threadId: urlThread } = useParams()
  const { search } = useLocation()
  const navigate = useNavigate()
  const threads = useThreads()
  const hidden = useHidden(s => s.ids)
  const today = threads.data?.find(t => t.title === todayTitle())
  const list = (threads.data ?? []).filter(t => !hidden.has(`thread:${t.id}`))
  const threadId = urlThread ?? null
  const go = (id: string | null, replace = false) => navigate({ pathname: id ? `/studio/create/${id}` : '/studio/create', search }, { replace })

  // Default thread: today's, once it exists (created on the first send, see api/records.ts).
  useEffect(() => { if (!urlThread && today) go(today.id, true) }, [urlThread, today?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { useComposer.setState({ threadId }) }, [threadId])

  const [renaming, setRenaming] = useState<Thread | null>(null)
  const newThread = async () => {
    try {
      const t = await recordsApi.createThread(`新会话 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`)
      await queryClient.invalidateQueries({ queryKey: recordKeys.threads })
      go(t.id)
    } catch { toast({ title: '新建会话失败', description: '请检查网络后重试', tone: 'error' }) }
  }
  const removeThread = (t: Thread) => {
    if (t.id === threadId) go(list.find(x => x.id !== t.id)?.id ?? null)
    deleteWithUndo(`会话「${t.title}」`, `thread:${t.id}`, async () => {
      await recordsApi.deleteThread(t.id)
      await queryClient.invalidateQueries({ queryKey: recordKeys.threads })
    })
  }
  const current = list.find(t => t.id === threadId)

  const menu = (t: Thread) => (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setRenaming(t)}><PencilLine className="size-4" />重命名</DropdownMenuItem>
      <DropdownMenuItem danger onSelect={() => removeThread(t)}><Trash2 className="size-4" />删除会话</DropdownMenuItem>
    </DropdownMenuContent>
  )

  return (
    <div className="md:grid md:grid-cols-[220px_1fr] md:gap-6">
      {/* Desktop rail */}
      <aside aria-label="会话" className="sticky top-22 hidden max-h-[calc(100dvh-120px)] flex-col gap-1 overflow-y-auto md:flex">
        <Button variant="secondary" size="sm" icon={<MessageSquarePlus className="size-4" />} onClick={() => void newThread()} className="mb-2">新建会话</Button>
        {threads.isPending && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9" />)}
        {threads.isError && <ErrorState reason="会话列表加载失败" action={{ label: '重试', onClick: () => void threads.refetch() }} />}
        {list.map(t => (
          <div key={t.id} className={cn('group/t flex h-9 items-center rounded-control text-sm', t.id === threadId ? 'bg-ink text-acid' : 'hover:bg-subtle')}>
            <Link to={{ pathname: `/studio/create/${t.id}`, search }} aria-current={t.id === threadId ? 'page' : undefined} className={cn('min-w-0 flex-1 truncate px-3 leading-9', focusRing)}>{t.title || '未命名会话'}</Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`管理会话 ${t.title}`} className={cn('mr-1 grid size-7 cursor-pointer place-items-center rounded-[8px] md:opacity-0 md:group-hover/t:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', t.id === threadId ? 'hover:bg-card/15' : 'hover:bg-line', focusRing)}>
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              {menu(t)}
            </DropdownMenu>
          </div>
        ))}
        {threads.isSuccess && !list.length && <p className="px-3 py-2 text-xs text-muted">发送第一条后会自动创建今天的会话</p>}
      </aside>

      <div className="min-w-0">
        {/* Mobile thread picker */}
        <div className="mb-4 flex items-center gap-2 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="min-w-0 flex-1 justify-between"><span className="truncate">{current?.title ?? todayTitle()}</span><ChevronDown className="size-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              {list.map(t => <DropdownMenuItem key={t.id} onSelect={() => go(t.id)} className={cn(t.id === threadId && 'font-semibold')}>{t.title || '未命名会话'}</DropdownMenuItem>)}
              {list.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => void newThread()}><MessageSquarePlus className="size-4" />新建会话</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {current && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><IconButton label="管理会话" variant="secondary" size="icon-sm"><MoreHorizontal className="size-4" /></IconButton></DropdownMenuTrigger>
              {menu(current)}
            </DropdownMenu>
          )}
        </div>
        <Stream key={threadId ?? 'none'} threadId={threadId} acceptsUnfiled={!threadId || threadId === today?.id} waitingForThreads={threads.isPending} />
      </div>

      <RenameDialog thread={renaming} onClose={() => setRenaming(null)} />
    </div>
  )
}

function RenameDialog({ thread, onClose }: { thread: Thread | null; onClose: () => void }) {
  const [title, setTitle] = useState('')
  useEffect(() => { if (thread) setTitle(thread.title) }, [thread])
  const save = async () => {
    if (!thread) return
    const t = title.trim().slice(0, 80)
    onClose()
    const prev = queryClient.getQueryData<Thread[]>(recordKeys.threads)
    queryClient.setQueryData<Thread[]>(recordKeys.threads, old => old?.map(x => x.id === thread.id ? { ...x, title: t } : x))
    try { await recordsApi.renameThread(thread.id, t) } catch {
      queryClient.setQueryData(recordKeys.threads, prev)
      toast({ title: '重命名失败，已恢复', tone: 'error' })
    }
  }
  return (
    <Dialog open={!!thread} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent title="重命名会话">
        <form onSubmit={e => { e.preventDefault(); void save() }}>
          <Input label="会话名称" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} autoFocus />
          <DialogFooter>
            <Button onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" disabled={!title.trim()} disabledReason="名称不能为空">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240

function Stream({ threadId, acceptsUnfiled, waitingForThreads }: { threadId: string | null; acceptsUnfiled: boolean; waitingForThreads: boolean }) {
  const records = useThreadRecords(threadId)
  const active = useActiveGenerations()
  const hidden = useHidden(s => s.ids)
  const queueLength = useComposer(s => s.queue.length)
  const pendings = useMutationState({
    filters: { mutationKey: GENERATION_SUBMIT_KEY },
    select: (m): PendingState => ({
      status: m.state.status, item: m.state.variables as PendingGeneration, result: m.state.data as SubmitOutcome | undefined,
      error: m.state.error as PendingState['error'], submittedAt: m.state.submittedAt,
    }),
  })

  const groups = useMemo(() => {
    const byId = new Map<string, GenerationRecord>()
    for (const r of records.data?.pages.flatMap(p => p.items) ?? []) byId.set(r.id, r)
    // The single active poll is fresher than the thread page.
    for (const r of active.data ?? []) if (r.thread_id === threadId && threadId) byId.set(r.id, r)
    const recs = [...byId.values()].filter(r => !hidden.has(r.id) && !(r.batch_id && hidden.has(`batch:${r.batch_id}`)))
    const mine = pendings.filter(p => p.item && (p.item.thread_id ? p.item.thread_id === threadId : acceptsUnfiled))
    const items: ItemView[] = mergeItems(recs, mine)
    return groupItems(items.filter(i => !(i.batch_id && hidden.has(`batch:${i.batch_id}`))))
  }, [records.data, active.data, pendings, hidden, threadId, acceptsUnfiled])

  // Preview
  const [preview, setPreview] = useState<{ assets: MediaAsset[]; index: number } | null>(null)
  // Batch 编辑后重发 with a non-empty queue → confirm first.
  const [confirmBatch, setConfirmBatch] = useState<ItemView[] | null>(null)
  const editBatch = (items: ItemView[]) => queueLength ? setConfirmBatch(items) : fillQueue(items)

  // 「有新结果 ↓」
  const loading = (!!threadId && records.isPending) || waitingForThreads
  const sig = streamSignature(groups)
  const prevSig = useRef<string | null>(null)
  const [pill, setPill] = useState(false)
  const toBottom = (smooth: boolean) => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' })
  useEffect(() => {
    if (loading) return
    const action = newResultsAction(prevSig.current, sig, atBottom())
    prevSig.current = sig
    if (action === 'jump') requestAnimationFrame(() => toBottom(false))
    else if (action === 'scroll') requestAnimationFrame(() => toBottom(true))
    else if (action === 'pill') setPill(true)
  }, [sig, loading])
  useEffect(() => {
    if (!pill) return
    const onScroll = () => { if (atBottom()) setPill(false) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pill])

  if (loading) {
    return (
      <div aria-busy className="grid gap-4">
        {[0, 1].map(i => (
          <div key={i} className="grid gap-3">
            <Skeleton className="ml-auto h-24 w-[min(420px,80%)] rounded-panel" />
            <Skeleton className="h-52 w-[min(640px,100%)] rounded-panel" />
          </div>
        ))}
      </div>
    )
  }
  if (records.isError) return <ErrorState reason="创作记录加载失败，请检查网络后重试。" action={{ label: '重试', onClick: () => void records.refetch() }} />

  return (
    <div className="grid gap-4 pb-24 md:pb-40">
      {records.hasNextPage && (
        <Button variant="ghost" size="sm" className="mx-auto" loading={records.isFetchingNextPage} onClick={() => void records.fetchNextPage()}>加载更早的记录</Button>
      )}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <MessagesSquare className="size-8 text-muted" />
          <p className="text-sm text-muted">这个会话还没有内容。在下方输入框描述画面并发送，结果会出现在这里。</p>
          <div className="flex max-w-xl flex-wrap justify-center gap-2">
            {SUGGESTIONS.map(s => (
              <Button key={s} size="sm" variant="secondary" className="h-auto max-w-full whitespace-normal py-1.5 text-left font-normal"
                onClick={() => dispatchStudioEvent(COMPOSER_FILL_EVENT, { source: 'case', kind: 'image', model: null, prompt: s, params: {}, reference_urls: [] })}>
                {s}
              </Button>
            ))}
          </div>
          <Link to={{ pathname: '/studio', search: '' }} className={cn('mt-1 inline-flex items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline', focusRing)}><Sparkles className="size-4" />去灵感里找找</Link>
        </div>
      ) : groups.map(g => (
        <section key={g.key} aria-label="生成记录" className="grid gap-2 motion-safe:animate-fade-in">
          <RequestBubble group={g} onEditBatch={editBatch} />
          <ResultBubble group={g} onPreview={(assets, index) => setPreview({ assets, index })} />
        </section>
      ))}

      {pill && (
        <button type="button" onClick={() => { setPill(false); toBottom(true) }}
          className={cn('fixed bottom-44 left-1/2 z-30 inline-flex h-9 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-acid shadow-xl md:left-[calc(50%+104px)] max-md:bottom-40', focusRing)}>
          有新结果<ArrowDown className="size-4" />
        </button>
      )}

      <MediaLightbox open={!!preview} items={(preview?.assets ?? []).map(asset => ({ asset }))} index={preview?.index ?? 0}
        onIndexChange={index => setPreview(p => p && { ...p, index })} onClose={() => setPreview(null)} />

      <Dialog open={!!confirmBatch} onOpenChange={o => { if (!o) setConfirmBatch(null) }}>
        <DialogContent title="覆盖当前队列？" description={`队列里已有 ${queueLength} 项，回填后会被这批的 ${confirmBatch?.length ?? 0} 项替换。`}>
          <DialogFooter>
            <Button onClick={() => setConfirmBatch(null)}>取消</Button>
            <Button variant="primary" onClick={() => { if (confirmBatch) fillQueue(confirmBatch); setConfirmBatch(null) }}>覆盖队列</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
