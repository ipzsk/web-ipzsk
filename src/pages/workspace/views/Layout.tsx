import { Check, ClipboardCopy, Download, Heart, MoreHorizontal, Printer, Share2, Sparkles } from 'lucide-react'
import { Button, SegmentedControl, cn, toast } from '@/ui'
import { MediaImage } from '@/media'
import { activeProject, content, download, htmlOf, markdownOf, type Platform, type WorkspaceState } from '../model'
import { copy, editField, updateProject } from '../actions'
import { useWorkspace } from '../store'
import { Card, Field, NoProject, PageHeading, ProjectSelect, fieldClass } from '../parts'

export function Layout({ data }: { data: WorkspaceState }) {
  const p = activeProject(data)
  const images = useWorkspace(s => s.images)
  const cover = p && images.find(i => i.task_id === p.cover?.task_id && i.image_index === p.cover?.image_index)
  const article = p?.platform === 'article'
  return (
    <>
      <div className="print:hidden">
        <PageHeading eyebrow="FORMAT STUDIO" title="排版与导出" lead="左侧调整内容，右侧查看图文效果。">
          <ProjectSelect data={data} label="选择排版项目" />
        </PageHeading>
      </div>
      {!p ? <NoProject title="还没有待排版的内容" /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] print:block">
          <Card className="grid content-start gap-5 print:hidden">
            <h2 className="text-[19px] font-bold">排版设置</h2>
            <SegmentedControl<Platform>
              label="内容平台" value={article ? 'article' : 'note'}
              onValueChange={v => updateProject(q => { q.platform = v })}
              options={[{ value: 'note', label: '图文笔记' }, { value: 'article', label: '公众号文章' }]}
            />
            <Field label="标题"><input className={fieldClass} maxLength={120} placeholder="内容标题" value={p.title} onChange={e => editField('title', e.target.value)} /></Field>
            <Field label="话题标签"><input className={fieldClass} maxLength={300} placeholder="#话题一 #话题二" value={p.tags} onChange={e => editField('tags', e.target.value)} /></Field>
            <Field label="正文"><textarea className={cn(fieldClass, 'resize-y leading-[1.9]')} rows={12} maxLength={100000} placeholder="在这里编辑正文，右侧会实时更新。" value={p.body} onChange={e => editField('body', e.target.value)} /></Field>
            <div className="flex flex-wrap gap-2.5">
              <Button variant="primary" icon={<ClipboardCopy aria-hidden className="size-4" />} onClick={() => copy(content(p))}>复制图文正文</Button>
              <Button icon={<Download aria-hidden className="size-4" />} onClick={() => download(markdownOf(p), 'text/markdown;charset=utf-8', (p.title || '内容') + '.md')}>导出 Markdown</Button>
              <Button icon={<Download aria-hidden className="size-4" />} onClick={() => download(htmlOf(p), 'text/html;charset=utf-8', (p.title || '内容') + '.html')}>导出排版 HTML</Button>
              <Button icon={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>打印 / 存为 PDF</Button>
              <Button
                variant="ghost" icon={<Check aria-hidden className="size-4" />}
                disabled={!p.body.trim()} disabledReason="先写一些正文，再标记完成。"
                onClick={() => { if (updateProject(q => { q.status = 'ready'; q.updated = Date.now() })) toast({ title: '已标记为完成', tone: 'success' }) }}
              >标记为已完成</Button>
            </div>
            <p className="text-[11px] text-muted">用于预览和素材交付。复制或导出后，请到发布平台完成发布。</p>
          </Card>
          <div className="rounded-card border border-line bg-subtle px-4 py-5 sm:px-9 print:border-0 print:bg-transparent print:p-0">
            <div className="mb-5 flex items-center justify-between text-[11px] text-muted print:hidden">
              <span className="font-bold tracking-[.18em] text-label">LIVE PREVIEW</span><span>{article ? '公众号文章' : '图文笔记'}</span>
            </div>
            <article className="mx-auto max-w-[380px] overflow-hidden rounded-[30px] border-[7px] border-ink bg-white shadow-lg print:max-w-full print:rounded-none print:border-0 print:shadow-none">
              <div className="flex items-center justify-between border-b border-line px-4.5 py-3.5 text-[11px] print:hidden">内容预览<MoreHorizontal aria-hidden className="size-4" /></div>
              {cover ? (
                <MediaImage
                  urls={{ orig: cover.url }} sizes="orig" fit="contain" hideBadge alt="当前内容封面" className="max-h-[420px] w-full"
                  onExpired={() => toast({ title: '封面链接已过期，请到图片与素材刷新。', tone: 'error' })}
                />
              ) : (
                <div className="flex min-h-[280px] flex-col justify-between bg-acid-soft bg-[radial-gradient(#1a6bf040_.65px,transparent_.65px)] bg-size-[12px_12px] px-6 py-7">
                  <span className="text-[8px] tracking-[2px]">YOUR NEXT STORY</span>
                  <strong className="text-[43px] leading-[1.3] tracking-[-2px]">把想法<br />变成作品。</strong>
                  <span className="inline-flex items-center gap-2 text-[8px] tracking-[2px]">IPZSK CONTENT STUDIO<Sparkles aria-hidden className="size-3" /></span>
                </div>
              )}
              <div className="px-5 py-6 print:px-0">
                <h2 className="text-lg font-bold leading-[1.7] [overflow-wrap:anywhere]">{p.title || '你的内容标题'}</h2>
                <div className={cn('max-h-[540px] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] print:max-h-none', article ? 'text-[13px] leading-[2.2]' : 'text-xs leading-loose')}>{p.body || '写下正文，这里会同步呈现排版效果。'}</div>
                <p className="mt-4 text-[11px] text-label [overflow-wrap:anywhere]">{p.tags}</p>
              </div>
              <div className="flex justify-between border-t border-line px-4.5 py-3 text-[10px] text-muted print:hidden">内容与预览同步更新<span className="inline-flex gap-2"><Heart aria-hidden className="size-3.5" /><Share2 aria-hidden className="size-3.5" /></span></div>
            </article>
          </div>
        </div>
      )}
    </>
  )
}
