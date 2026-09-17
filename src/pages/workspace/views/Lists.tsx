import { useRef, useState } from 'react'
import { Check, Download, FileUp, RotateCcw, Search, Trash2 } from 'lucide-react'
import { Button, EmptyState, cn, toast } from '@/ui'
import { activeSpace, backupOf, download, localDate, spaceProjects, trashed, type Space, type WorkspaceState } from '../model'
import { restoreProject, saveSpace, selectProject, show } from '../actions'
import { replaceData, useWorkspace } from '../store'
import { importInto } from '../model'
import { Card, Field, NewProjectButton, PageHeading, ProjectGrid, fieldClass } from '../parts'

export function Topics({ data }: { data: WorkspaceState }) {
  return (
    <>
      <PageHeading eyebrow="COLLECT & CONNECT" title="选题与灵感" lead="保存值得展开的想法，为下一篇内容留下线索。"><NewProjectButton /></PageHeading>
      <ProjectGrid items={spaceProjects(data)} />
    </>
  )
}

export function Archive({ data }: { data: WorkspaceState }) {
  const [q, setQ] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const query = q.trim().toLowerCase()
  const onFile = async (input: HTMLInputElement) => {
    const f = input.files?.[0]
    if (!f) return
    try {
      const next = importInto(useWorkspace.getState().data, f.name, f.size, await f.text())
      replaceData(next)
      show('editor')
      toast({ title: '已作为新稿件导入，原有内容未覆盖。', tone: 'success' })
    } catch (err) {
      toast({ title: (err as Error).message || '导入失败', tone: 'error' })
    } finally { input.value = '' }
  }
  return (
    <>
      <PageHeading eyebrow="A RECORD OF YOUR WORK" title="内容档案" lead="查看当前空间的草稿和已完成内容。">
        <div className="flex flex-wrap gap-2.5">
          <Button icon={<FileUp aria-hidden className="size-4" />} onClick={() => file.current?.click()}>导入文稿 / 备份</Button>
          <Button icon={<Download aria-hidden className="size-4" />} onClick={() => download(backupOf(useWorkspace.getState().data), 'application/json', 'ipzsk-workspace-backup.json')}>导出完整备份</Button>
          <input ref={file} type="file" accept=".md,.txt,.json" hidden onChange={e => void onFile(e.currentTarget)} />
        </div>
      </PageHeading>
      <div className="relative mb-6 max-w-[450px]">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题或正文" aria-label="搜索内容" className={cn(fieldClass, 'pl-9')} />
      </div>
      <ProjectGrid items={spaceProjects(data).filter(p => (p.title + ' ' + p.body).toLowerCase().includes(query))} />
    </>
  )
}

export function TrashView({ data }: { data: WorkspaceState }) {
  const items = trashed(data)
  return (
    <>
      <PageHeading eyebrow="ROOM TO CHANGE YOUR MIND" title="回收站" lead="误删的稿件可以恢复。此处不会自动清空。" />
      {items.length ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(p => (
            <Card key={p.id}>
              <h3 className="mb-2 text-base font-bold [overflow-wrap:anywhere]">{p.title}</h3>
              <p className="mb-4 text-xs text-muted">删除于 {new Date(p.deleted!).toLocaleDateString('zh-CN')}</p>
              <Button icon={<RotateCcw aria-hidden className="size-4" />} onClick={() => { restoreProject(p.id); toast({ title: '已恢复稿件', tone: 'success' }) }}>恢复稿件</Button>
            </Card>
          ))}
        </div>
      ) : <EmptyState icon={Trash2} text="回收站是空的。" />}
    </>
  )
}

export function Calendar({ data }: { data: WorkspaceState }) {
  const [month, setMonth] = useState(() => localDate(new Date()).slice(0, 7))
  const ps = spaceProjects(data)
  const valid = /^\d{4}-\d{2}$/.test(month)
  const [year, m] = month.split('-').map(Number) as [number, number]
  const first = valid ? (new Date(year, m - 1, 1).getDay() + 6) % 7 : 0
  const days = valid ? new Date(year, m, 0).getDate() : 0
  const today = localDate(new Date())
  return (
    <>
      <PageHeading eyebrow="PLAN YOUR NEXT STORY" title="创作日历" lead="按计划日期安排创作；发布仍由你确认完成。">
        <input type="month" aria-label="选择月份" value={month} onChange={e => setMonth(e.target.value)} className={cn(fieldClass, 'w-44')} />
      </PageHeading>
      {valid && (
        <div className="mb-9 mt-6 grid grid-cols-7 gap-[3px] sm:gap-2">
          {['一', '二', '三', '四', '五', '六', '日'].map(d => <div key={d} className="text-center text-xs text-muted">{d}</div>)}
          {Array.from({ length: first }, (_, i) => <div key={'e' + i} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = month + '-' + String(i + 1).padStart(2, '0')
            return (
              <div key={date} className={cn('min-h-[85px] min-w-0 rounded-control border bg-card p-1 sm:min-h-[110px] sm:p-2.5', date === today ? 'border-label' : 'border-line')}>
                <small className="text-muted">{i + 1}</small>
                {ps.filter(p => p.due === date).map(p => (
                  <button
                    key={p.id} type="button"
                    onClick={() => { selectProject(p.id, false); show('editor') }}
                    className={cn('mt-1 block w-full cursor-pointer rounded-[5px] bg-acid-soft p-0.5 text-left text-[10px] text-label [overflow-wrap:anywhere] hover:bg-acid hover:text-white sm:p-1.5 sm:text-[11px]', 'focus-visible:outline-2 focus-visible:outline-acid-deep')}
                  >{p.title}</button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <h2 className="mb-4 text-[23px] font-bold">尚未排期</h2>
      <ProjectGrid items={ps.filter(p => !p.due)} />
    </>
  )
}

export function Settings({ data }: { data: WorkspaceState }) {
  const space = activeSpace(data)!
  // Re-seed the form whenever the saved space changes (legacy render() did the same).
  return <SettingsForm key={space.id + JSON.stringify(space)} space={space} />
}

function SettingsForm({ space }: { space: Space }) {
  const [v, setV] = useState(space)
  const bind = (f: keyof Space) => ({ name: f, value: v[f], onChange: (e: { target: { value: string } }) => setV({ ...v, [f]: e.target.value }), className: fieldClass })
  return (
    <>
      <PageHeading eyebrow="MAKE THIS SPACE YOURS" title="关注与偏好" lead="每个内容空间，都可以有自己的方向。">
        <span className="rounded-full bg-subtle px-3 py-1 text-xs font-semibold">当前空间独立设置</span>
      </PageHeading>
      <form className="max-w-[920px]" onSubmit={e => { e.preventDefault(); saveSpace(v) }}>
        <Card>
          <div className="mb-5 grid gap-5 sm:grid-cols-2">
            <Field label="空间名称"><input {...bind('name')} required maxLength={40} placeholder="例如：我的内容创作" /></Field>
            <Field label="关注领域与关键词"><input {...bind('focus')} maxLength={500} placeholder="例如：AI 工具、教育、设计" /></Field>
            <Field label="目标读者"><input {...bind('reader')} maxLength={300} placeholder="例如：刚开始学习的新手" /></Field>
            <Field label="表达风格"><input {...bind('voice')} maxLength={300} placeholder="例如：简洁、具体、有案例" /></Field>
          </div>
          <Field label="关注来源与参考线索"><textarea {...bind('sources')} rows={6} maxLength={6000} placeholder="每行记录一个网站、账号名称或参考链接。此处保存关注清单，不会自动抓取。" /></Field>
          <div className="mt-6 flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <p className="text-xs leading-6 text-muted">偏好会进入可复制的创作提示词。<br />登录后自动同步到账号；离线改动先保存在本机。请留意顶部保存状态。</p>
            <Button type="submit" variant="primary" icon={<Check aria-hidden className="size-[18px]" />}>保存空间设置</Button>
          </div>
        </Card>
      </form>
    </>
  )
}
