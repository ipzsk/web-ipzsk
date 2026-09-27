import { useEffect, useState } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'
import { MessageSquarePlus, MoreHorizontal, PencilLine, Trash2 } from 'lucide-react'
import {
  Button, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  ErrorState, Input, Skeleton, cn, focusRing, toast,
} from '@/ui'
import { ApiError } from '@/shared/api'
import { queryClient, useCurrentUser } from '@/shared/query'
import { recordKeys, recordsApi, useThreads, type Thread } from '../api/records'
import { deleteWithUndo, useHidden } from './actions'
import { useLegacy } from './LegacyImport'
import { LEGACY_THREAD_ID, LEGACY_THREAD_TITLE } from './legacy'

/** Thread list state + actions, shared by the sidebar list and the create view's mobile picker. Works on any studio route. */
export function useThreadList() {
  const { pathname, search: rawSearch } = useLocation()
  const navigate = useNavigate()
  const threads = useThreads()
  const hidden = useHidden(s => s.ids)
  const onCreate = pathname.startsWith('/studio/create')
  const search = onCreate ? rawSearch : ''
  const threadId = useMatch('/studio/create/:threadId')?.params.threadId ?? null
  const list = (threads.data ?? []).filter(t => !hidden.has(`thread:${t.id}`))
  const legacyListed = useLegacy().marker?.state === 'imported'
  const me = useCurrentUser() // useThreads is disabled while signed out, so a null user is the signal (401 covers expiry)
  const signedOut = (me.isSuccess && !me.data) || threads.error instanceof ApiError && (threads.error.status === 401 || threads.error.status === 403)
  const go = (id: string | null, replace = false) => navigate({ pathname: id ? `/studio/create/${id}` : '/studio/create', search }, { replace })

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
  const menu = (t: Thread) => (
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => setRenaming(t)}><PencilLine className="size-4" />重命名</DropdownMenuItem>
      <DropdownMenuItem danger onSelect={() => removeThread(t)}><Trash2 className="size-4" />删除会话</DropdownMenuItem>
    </DropdownMenuContent>
  )
  const renameDialog = <RenameDialog thread={renaming} onClose={() => setRenaming(null)} />
  return { threads, list, threadId, legacyListed, signedOut, search, go, newThread, menu, renameDialog }
}

/** Sidebar: 「新建会话」 + threads, under the studio nav. */
export function ThreadList() {
  const { threads, list, threadId, legacyListed, signedOut, search, newThread, menu, renameDialog } = useThreadList()
  const legacyOpen = threadId === LEGACY_THREAD_ID
  if (signedOut) return <p className="px-3 py-2 text-xs text-muted">登录后可查看会话</p>
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <Button variant="secondary" size="sm" icon={<MessageSquarePlus className="size-4" />} onClick={() => void newThread()} className="mb-1">新建会话</Button>
      <nav aria-label="会话" className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
        {threads.isPending && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 shrink-0" />)}
        {threads.isError && <ErrorState reason="会话列表加载失败" action={{ label: '重试', onClick: () => void threads.refetch() }} />}
        {list.map(t => (
          <div key={t.id} className={cn('group/t flex h-9 shrink-0 items-center rounded-control text-sm embed:h-8', t.id === threadId ? 'bg-subtle font-semibold embed:font-normal' : 'text-ink/80 hover:bg-subtle')}>
            <Link to={{ pathname: `/studio/create/${t.id}`, search }} aria-current={t.id === threadId ? 'page' : undefined} className={cn('min-w-0 flex-1 truncate px-3 leading-9 embed:px-2 embed:leading-8', focusRing)}>{t.title || '未命名会话'}</Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`管理会话 ${t.title}`} className={cn('mr-1 grid size-7 cursor-pointer place-items-center rounded-[8px] opacity-0 hover:bg-line group-hover/t:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', focusRing)}>
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              {menu(t)}
            </DropdownMenu>
          </div>
        ))}
        {legacyListed && (
          <Link to={{ pathname: `/studio/create/${LEGACY_THREAD_ID}`, search }} aria-current={legacyOpen ? 'page' : undefined}
            className={cn('flex h-9 shrink-0 items-center truncate rounded-control px-3 text-sm', legacyOpen ? 'bg-subtle font-semibold' : 'text-muted hover:bg-subtle hover:text-ink', focusRing)}>{LEGACY_THREAD_TITLE}</Link>
        )}
        {threads.isSuccess && !list.length && <p className="px-3 py-2 text-xs text-muted">发送第一条后会自动创建今天的会话</p>}
      </nav>
      {renameDialog}
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
