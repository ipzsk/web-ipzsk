import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { ArrowDown, ArrowUp, Ellipsis, Folder as FolderIcon, FolderPlus, GripVertical, Images, Pencil, Trash2 } from 'lucide-react'
import {
  Button, Dialog, DialogClose, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Skeleton, Tooltip, cn, focusRing,
} from '@/ui'
import { DropTarget } from '@/media'
import type { Folder } from './api'
import { positionAt, useFolderMutations, useFolders } from './queries'

const rowClass = (active: boolean) => cn(
  'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control px-2.5 text-sm font-semibold transition-colors duration-(--duration-fast)',
  active ? 'bg-acid-soft text-label hover:bg-acid-soft' : 'text-ink hover:bg-subtle',
  focusRing,
)

function validName(name: string, folders: Folder[], selfId?: string): string | null {
  const n = name.trim()
  if (!n) return '名称不能为空'
  if (n.length > 60) return '名称最多 60 个字'
  if (folders.some((f) => f.name === n && f.id !== selfId)) return '已有同名文件夹'
  return null
}

function NameInput({ initial, folders, selfId, onDone }: { initial: string; folders: Folder[]; selfId?: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (value.trim() === initial) return onDone(null)
    const err = validName(value, folders, selfId)
    if (err) return setError(err)
    onDone(value.trim())
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(null) }
  }
  return (
    <div className="grid gap-1 px-0.5 py-0.5">
      <input
        autoFocus
        value={value}
        maxLength={60}
        aria-label="文件夹名称"
        aria-invalid={!!error || undefined}
        placeholder="文件夹名称"
        onChange={(e) => { setValue(e.target.value); setError(null) }}
        onKeyDown={onKeyDown}
        onBlur={() => (value.trim() && value.trim() !== initial && !validName(value, folders, selfId) ? onDone(value.trim()) : onDone(null))}
        onFocus={(e) => e.currentTarget.select()}
        className={cn('h-9 w-full rounded-control border border-acid bg-card px-2.5 ring-3 ring-acid/10 text-sm text-ink aria-invalid:border-danger', focusRing, 'focus-visible:outline-offset-0')}
      />
      {error ? <p className="px-1 text-xs text-danger">{error}</p> : <p className="px-1 text-xs text-muted">Enter 确认 · Esc 取消</p>}
    </div>
  )
}

export function FolderColumn({ current, onNavigate }: { current: string | null; onNavigate?: () => void }) {
  const folders = useFolders()
  const m = useFolderMutations()
  const list = folders.data ?? []
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Folder | null>(null)
  const dragFrom = useRef<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const reorder = (from: number, to: number) => {
    const f = list[from]
    if (!f || from === to || to < 0 || to >= list.length) return
    m.move.mutate({ id: f.id, position: positionAt(list, from, to) })
  }

  return (
    <nav aria-label="素材文件夹" className="grid gap-1">
      <Link to="/studio/assets" onClick={onNavigate} aria-current={!current ? 'page' : undefined} className={rowClass(!current)}>
        <Images className="size-4 shrink-0" aria-hidden />全部素材
      </Link>
      <div className="mt-3 flex items-center justify-between px-2.5 text-xs font-semibold text-muted">
        <span>文件夹</span>
        <Tooltip content="新建文件夹">
        <button
          type="button"
          aria-label="新建文件夹"
          onClick={() => setCreating(true)}
          className={cn('grid size-7 place-items-center rounded-[8px] text-muted transition-[background-color,color,transform] duration-(--duration-fast) hover:bg-subtle hover:text-ink active:scale-[.98] motion-reduce:active:scale-100', focusRing)}
        >
          <FolderPlus className="size-4" aria-hidden />
        </button>
        </Tooltip>
      </div>

      {folders.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}
      {folders.isError && (
        <div role="alert" className="grid gap-2 px-2.5 py-2 text-xs text-danger">
          文件夹加载失败
          <Button size="sm" onClick={() => void folders.refetch()}>重试</Button>
        </div>
      )}

      <ul className="grid gap-0.5">
        {list.map((f, i) => {
          const temp = f.id.startsWith('temp-')
          return (
            <li
              key={f.id}
              draggable={!temp && renaming !== f.id}
              onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.name) }}
              onDragOver={(e) => { if (dragFrom.current == null) return; e.preventDefault(); setDropAt(i) }}
              onDragLeave={() => setDropAt((d) => (d === i ? null : d))}
              onDrop={(e) => { if (dragFrom.current == null) return; e.preventDefault(); reorder(dragFrom.current, i); dragFrom.current = null; setDropAt(null) }}
              onDragEnd={() => { dragFrom.current = null; setDropAt(null) }}
              className={cn('group/folder relative rounded-control', dropAt === i && dragFrom.current !== i && 'shadow-[inset_0_2px_0_var(--color-acid-deep)]')}
            >
              {renaming === f.id ? (
                <NameInput initial={f.name} folders={list} selfId={f.id} onDone={(name) => { setRenaming(null); if (name) m.rename.mutate({ id: f.id, name }) }} />
              ) : (
                <DropTarget id={`folder:${f.id}`} accept={() => (temp ? '文件夹还在创建中' : true)} onDrop={(items) => m.add.mutate({ folder: f, ids: items.map((a) => a.id) })} className="rounded-control">
                  <div className="flex items-center">
                    <Link
                      to={`/studio/assets/${f.id}`}
                      onClick={onNavigate}
                      aria-current={current === f.id ? 'page' : undefined}
                      aria-disabled={temp || undefined}
                      className={cn(rowClass(current === f.id), 'pr-9', temp && 'pointer-events-none opacity-60')}
                    >
                      <GripVertical className="-ml-1 size-3.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover/folder:opacity-50 [@media(hover:none)]:hidden" aria-hidden />
                      <FolderIcon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className={cn('tabular-nums text-xs font-normal group-hover/folder:invisible', current === f.id ? 'text-label' : 'text-muted')} aria-label={`${f.count} 项`}>{f.count}</span>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${f.name} 更多操作`}
                          disabled={temp}
                          className={cn(
                            'absolute right-1 grid size-7 place-items-center rounded-[8px] opacity-0 transition-[opacity,background-color] duration-(--duration-fast) group-hover/folder:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
                            current === f.id ? 'text-label hover:bg-card' : 'text-muted hover:bg-line',
                            focusRing,
                          )}
                        >
                          <Ellipsis className="size-4" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => setRenaming(f.id)}><Pencil aria-hidden />重命名</DropdownMenuItem>
                        <DropdownMenuItem disabled={i === 0} onSelect={() => reorder(i, i - 1)}><ArrowUp aria-hidden />上移</DropdownMenuItem>
                        <DropdownMenuItem disabled={i === list.length - 1} onSelect={() => reorder(i, i + 1)}><ArrowDown aria-hidden />下移</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger onSelect={() => setConfirm(f)}><Trash2 aria-hidden />删除文件夹</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </DropTarget>
              )}
            </li>
          )
        })}
      </ul>

      {creating ? (
        <NameInput initial="" folders={list} onDone={(name) => { setCreating(false); if (name) m.create.mutate(name) }} />
      ) : (
        !folders.isPending && (
          <button type="button" onClick={() => setCreating(true)} className={cn(rowClass(false), 'flex-none font-normal text-muted')}>
            <FolderPlus className="size-4 shrink-0" aria-hidden />新建文件夹
          </button>
        )
      )}
      {!folders.isPending && list.length > 0 && <p className="px-2.5 pt-1 text-xs text-muted">把素材拖到文件夹即可加入</p>}

      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        {confirm && (
          <DialogContent
            title={`删除文件夹「${confirm.name}」？`}
            description={`文件夹里的 ${confirm.count} 项素材不会被删除，仍然可以在「全部素材」里找到。删除后文件夹无法恢复。`}
          >
            <DialogFooter>
              <DialogClose asChild><Button>取消</Button></DialogClose>
              <Button
                variant="danger"
                onClick={() => {
                  m.remove.mutate(confirm.id)
                  if (current === confirm.id) onNavigate?.()
                  setConfirm(null)
                }}
              >
                删除文件夹
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </nav>
  )
}
