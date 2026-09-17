import { ArrowUpRight, ClipboardCopy, ImageIcon, RefreshCw } from 'lucide-react'
import { Badge, Button, EmptyState, Skeleton, buttonVariants, cn, toast } from '@/ui'
import { MediaImage } from '@/media'
import { activeProject, activeSpace, imageBriefOf, type WorkspaceState } from '../model'
import { copy, show, updateProject } from '../actions'
import { loadImages, useWorkspace } from '../store'
import { Card, PageHeading, ProjectSelect } from '../parts'
import { noProjectToast } from './Editor'

// Legacy iframed the old /image tool; the new creation surface is /studio, opened in its own tab.
export const STUDIO_IMAGE_URL = '/studio?kind=image'

export function Images({ data }: { data: WorkspaceState }) {
  const { owner, images, nextOffset, imagesLoading, galleryStatus } = useWorkspace()
  const p = activeProject(data)
  const openStudio = cn(buttonVariants({ variant: 'primary' }))
  return (
    <>
      <PageHeading eyebrow="YOUR VISUAL LIBRARY" title="图片与素材" lead="查看当前账号的云端图片，为内容选择一张封面。">
        <a className={openStudio} href={STUDIO_IMAGE_URL} target="_blank" rel="noopener">打开创作工作台<ArrowUpRight aria-hidden className="size-[18px]" /></a>
      </PageHeading>
      <Card className="mb-6">
        <h2 className="mb-2 text-[23px] font-bold">给这篇内容配图</h2>
        <p className="mb-5 text-sm text-muted">复制封面提示词，在创作工作台生成，完成后回到这里刷新云端图片并选择封面。</p>
        <div className="flex flex-wrap gap-2.5">
          <Button icon={<ClipboardCopy aria-hidden className="size-4" />} onClick={() => { if (!p) noProjectToast(); else void copy(imageBriefOf(activeSpace(data)!, p)) }}>复制封面提示词</Button>
          <a className={buttonVariants()} href={STUDIO_IMAGE_URL} target="_blank" rel="noopener">在新标签页生图<ArrowUpRight aria-hidden className="size-4" /></a>
        </div>
      </Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Badge>云端图片 · 按账号读取</Badge>
        <div className="w-full sm:ml-auto sm:w-auto"><ProjectSelect data={data} label="选择封面所属项目" /></div>
        <Button variant="ghost" size="sm" loading={imagesLoading} loadingText="刷新中" disabled={!owner} disabledReason="登录并验证邮箱后，可查看你的云端图片。" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void loadImages()}>刷新图片</Button>
      </div>
      <p role="status" className={cn('mb-5 min-h-5 text-xs', /失效|暂时无法/.test(galleryStatus) ? 'text-danger' : 'text-muted')}>{galleryStatus}</p>
      {imagesLoading && !images.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[220px] rounded-card" />)}</div>
      ) : images.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
          {images.map(i => {
            const selected = p?.cover?.task_id === i.task_id && p?.cover?.image_index === i.image_index
            return (
              <article key={i.task_id + ':' + i.image_index} className={cn('overflow-hidden rounded-card border bg-card', selected ? 'border-2 border-ink' : 'border-line')}>
                <MediaImage urls={{ orig: i.url }} sizes="orig" fit="contain" hideBadge alt="当前账号生成的图片" className="h-40 w-full sm:h-[220px]" />
                <div className="grid gap-3 p-3 sm:p-4">
                  <small className="text-[11px] text-muted">{new Date(i.created_at).toLocaleDateString('zh-CN')}</small>
                  <Button
                    size="sm" variant={selected ? 'primary' : 'secondary'} className="whitespace-normal"
                    onClick={() => {
                      if (!p) { toast({ title: '请先新建一个选题，再选择封面。', tone: 'error' }); return }
                      updateProject(q => { q.cover = { task_id: i.task_id, image_index: i.image_index } })
                      show('layout')
                    }}
                  >{selected ? '当前封面' : '设为当前内容封面'}</Button>
                </div>
              </article>
            )
          })}
        </div>
      ) : galleryStatus.startsWith('还没有云端图片') ? <EmptyState icon={ImageIcon} text="还没有云端图片，前往创作工作台开始创作。" action={{ label: '去生图', onClick: () => window.open(STUDIO_IMAGE_URL, '_blank', 'noopener') }} /> : null}
      {nextOffset !== null && <Button className="mt-6" loading={imagesLoading} loadingText="加载中" onClick={() => void loadImages(true)}>加载更多</Button>}
    </>
  )
}
