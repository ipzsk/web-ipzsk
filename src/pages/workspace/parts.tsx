import type { ComponentProps, ReactNode } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Badge, Button, cn, focusRing } from '@/ui'
import { STATUS_LABEL, spaceProjects, type Project, type WorkspaceState } from './model'
import { openDialog, selectProject, show } from './actions'

export const fieldClass = cn(
  'w-full min-w-0 rounded-control border border-line bg-card px-3 py-2.5 text-sm text-ink placeholder:text-muted',
  'transition-colors duration-(--duration-fast) hover:border-muted focus:border-ink disabled:cursor-not-allowed disabled:opacity-45',
  focusRing, 'focus-visible:outline-offset-0',
)
export const labelClass = 'grid gap-2 text-[13px] font-semibold'

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn(labelClass, className)}><span>{label}</span>{children}</label>
}

export const Card = ({ className, ...props }: ComponentProps<'div'>) =>
  <div className={cn('rounded-card border border-line bg-card p-5 sm:p-6', className)} {...props} />

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) =>
  <p className={cn('mb-3 text-[10px] font-bold tracking-[.18em] text-label', className)}>{children}</p>

export function PageHeading({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-6 md:items-center">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="text-[34px] font-bold leading-tight tracking-[-1.5px] md:text-[39px]">{title}</h1>
        <p className="mt-3 text-[13px] leading-7 text-muted">{lead}</p>
      </div>
      {children}
    </div>
  )
}

export const NewProjectButton = ({ label = '新建选题' }: { label?: string }) =>
  <Button variant="primary" icon={<Plus aria-hidden className="size-[18px]" />} onClick={() => openDialog('project')}>{label}</Button>

export function ProjectSelect({ data, label }: { data: WorkspaceState; label: string }) {
  const items = spaceProjects(data)
  return (
    <select aria-label={label} className={cn(fieldClass, 'w-full cursor-pointer sm:max-w-60')} value={data.activeProject ?? ''} onChange={e => selectProject(e.target.value)}>
      {!items.some(p => p.id === data.activeProject) && <option value="" hidden />}
      {items.map(p => <option key={p.id} value={p.id}>{p.title || '未命名内容'}</option>)}
    </select>
  )
}

export function ProjectGrid({ items, onOpen }: { items: Project[]; onOpen?: (p: Project) => void }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-start justify-between gap-4 rounded-card border border-dashed border-line bg-card/60 p-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <Plus aria-hidden className="size-8 shrink-0 text-acid-deep" />
          <p className="text-[13px] text-muted">这里等待你的第一个想法。新建选题，开始积累自己的内容。</p>
        </div>
        <NewProjectButton />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => { if (onOpen) onOpen(p); else { selectProject(p.id); show('editor') } }}
          className={cn(
            'group flex min-h-44 w-full cursor-pointer flex-col items-start rounded-card border border-line bg-card p-5 text-left',
            'transition-[transform,box-shadow,border-color] duration-(--duration-fast) ease-(--ease-standard) hover:border-muted hover:shadow-md motion-safe:hover:-translate-y-px',
            'motion-safe:active:scale-[.98]', focusRing,
          )}
        >
          <Badge tone={p.status === 'ready' ? 'success' : p.status === 'published' ? 'ink' : 'neutral'}>{STATUS_LABEL[p.status ?? ''] || '创作中'}</Badge>
          <h3 className="mt-3.5 mb-2 text-base font-bold leading-relaxed [overflow-wrap:anywhere]">{p.title || '未命名内容'}</h3>
          <p className="mb-4 line-clamp-2 text-xs text-muted">{p.body.slice(0, 80) || p.outline.slice(0, 80) || '一个新的想法，等待展开。'}</p>
          <span className="mt-auto flex w-full items-center justify-between gap-2 text-[11px] text-muted [overflow-wrap:anywhere]">
            <span>{(p.due ? '计划 ' + p.due + ' · ' : '') + (p.priority === 'high' ? '优先 · ' : '') + new Date(p.updated).toLocaleDateString('zh-CN')}</span>
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-label">继续创作<ArrowRight aria-hidden className="size-3.5 transition-transform duration-(--duration-fast) motion-safe:group-hover:translate-x-0.5" /></span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function NoProject({ title, text }: { title: string; text?: string }) {
  return (
    <div className="rounded-panel border border-dashed border-line px-5 py-16 text-center">
      <h2 className="text-[23px] font-bold">{title}</h2>
      {text && <p className="mt-2 text-sm text-muted">{text}</p>}
      <div className="mt-5"><NewProjectButton /></div>
    </div>
  )
}
