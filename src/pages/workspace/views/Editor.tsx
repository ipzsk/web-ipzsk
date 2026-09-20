import { ArrowRight, ClipboardCopy, History, Sparkles, Trash2 } from 'lucide-react'
import { Button, Checkbox, cn, toast } from '@/ui'
import { activeProject, activeSpace, briefOf, wordCount, type WorkspaceState } from '../model'
import { copy, editField, openDialog, show, trashProject, updateProject } from '../actions'
import { useWorkspace } from '../store'
import { Card, Eyebrow, Field, NoProject, PageHeading, ProjectSelect, fieldClass } from '../parts'

const CHECKS = ['开头说清了问题', '包含具体例子，并核对事实', '结尾给出下一步行动']

export function Editor({ data }: { data: WorkspaceState }) {
  const p = activeProject(data)
  const s = activeSpace(data)!
  const owner = useWorkspace(x => x.owner)
  return (
    <>
      <PageHeading eyebrow="MAKE ROOM FOR YOUR WORDS" title="正文创作" lead="从提纲到初稿，把想法写清楚。">
        <ProjectSelect data={data} label="选择创作项目" />
      </PageHeading>
      {!p ? <NoProject title="先给这篇内容一个名字" text="新建选题后，就可以开始写作和排版。" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_255px]">
          <Card className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="primary" icon={<Sparkles aria-hidden className="size-[18px]" />}
                disabled={!owner} disabledReason="请先登录账号使用 AI 写作。"
                onClick={() => openDialog('ai')}
              >AI 写作助手</Button>
              <Button icon={<History aria-hidden className="size-4" />} onClick={() => openDialog('versions')}>版本历史</Button>
              <Button variant="danger-ghost" icon={<Trash2 aria-hidden className="size-4" />} onClick={trashProject}>移入回收站</Button>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="创作状态">
                <select className={cn(fieldClass, 'cursor-pointer')} value={p.status ?? 'draft'} onChange={e => editField('status', e.target.value)}>
                  <option value="draft">创作中</option><option value="review">待审核</option><option value="ready">待发布 / 已完成</option><option value="published">已发布</option>
                </select>
              </Field>
              <Field label="计划发布日期"><input type="date" className={fieldClass} value={p.due ?? ''} onChange={e => editField('due', e.target.value)} /></Field>
              <Field label="优先级">
                <select className={cn(fieldClass, 'cursor-pointer')} value={p.priority ?? 'normal'} onChange={e => editField('priority', e.target.value)}>
                  <option value="normal">普通</option><option value="high">优先创作</option><option value="low">稍后再写</option>
                </select>
              </Field>
            </div>
            <Field label="内容标题"><input className={fieldClass} maxLength={120} placeholder="写下这篇内容的标题" value={p.title} onChange={e => editField('title', e.target.value)} /></Field>
            <Field label="提纲与素材线索"><textarea className={cn(fieldClass, 'resize-y leading-[1.9]')} rows={4} maxLength={12000} placeholder="核心观点、内容结构、参考链接……" value={p.outline} onChange={e => editField('outline', e.target.value)} /></Field>
            <Field label="正文"><textarea className={cn(fieldClass, 'resize-y leading-[1.9]')} rows={17} maxLength={100000} placeholder="先写下第一句话。你可以粘贴已有稿件，在这里继续修改。" value={p.body} onChange={e => editField('body', e.target.value)} /></Field>
            <div className="flex items-center justify-between text-xs text-muted">
              <span aria-live="polite">{wordCount(p.body)} 字</span>
              <Button variant="ghost" size="sm" onClick={() => show('layout')}>前往排版<ArrowRight aria-hidden className="size-4" /></Button>
            </div>
          </Card>
          <aside className="grid content-start gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <Card>
              <Eyebrow>CREATIVE BRIEF</Eyebrow>
              <h3 className="mb-3 text-[17px] font-bold">这次，写给谁？</h3>
              <p className="whitespace-pre-line text-xs leading-6 text-muted">{`关注方向：${s.focus || '待设置'}\n目标读者：${s.reader || '待设置'}\n表达风格：${s.voice || '待设置'}`}</p>
              <Button variant="ghost" size="sm" className="-ml-3 mt-2" onClick={() => show('settings')}>编辑创作偏好<ArrowRight aria-hidden className="size-4" /></Button>
            </Card>
            <Card>
              <h3 className="mb-3 text-[17px] font-bold">写作检查清单</h3>
              <div className="grid gap-3">
                {CHECKS.map((label, i) => (
                  <Checkbox
                    key={i} label={label} checked={!!p.checks?.[i]}
                    onCheckedChange={c => updateProject(q => { const next = [...(q.checks ?? [])]; next[i] = c === true; q.checks = next })}
                  />
                ))}
              </div>
              <Button className="mt-4 w-full" icon={<ClipboardCopy aria-hidden className="size-4" />} onClick={() => copy(briefOf(s, p))}>复制创作提示词</Button>
              <small className="mt-2.5 block text-[11px] text-muted">复制到你常用的 AI 助手中使用。</small>
            </Card>
          </aside>
        </div>
      )}
    </>
  )
}

export const noProjectToast = () => toast({ title: '先新建或选择一篇稿件。', tone: 'error' })
