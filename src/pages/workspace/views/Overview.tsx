import { ArrowRight, ArrowUpRight, Crosshair, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/ui'
import { activeSpace, spaceProjects, type WorkspaceState } from '../model'
import { openDialog, show } from '../actions'
import { Eyebrow, ProjectGrid } from '../parts'

export function Overview({ data }: { data: WorkspaceState }) {
  const ps = spaceProjects(data)
  const done = ps.filter(p => ['ready', 'published'].includes(p.status ?? '')).length
  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) + ' / YOUR CREATIVE SPACE'
  const stats: [string, number, string][] = [
    ['当前空间选题', ps.length, '每一个想法都有位置'],
    ['正在创作', ps.length - done, '留一点时间，继续写下去'],
    ['已完成内容', done, '记录每一次完整交付'],
  ]
  return (
    <>
      <div className="grid items-center gap-6 pb-8 pt-2 md:grid-cols-[1.15fr_1fr] md:gap-10 md:pb-11">
        <div>
          <Eyebrow>{today}</Eyebrow>
          <h1 className="text-[44px] font-bold leading-[1.24] tracking-[-2px] lg:text-[clamp(40px,4.6vw,67px)] lg:tracking-[-3px]">
            把想法，<br /><span className="bg-[linear-gradient(transparent_69%,var(--color-acid)_69%)]">推进到发布。</span>
          </h1>
          <p className="mt-4 text-[13px] leading-7 text-muted">收藏一个灵感，写下一段文字。<br />在自己的节奏里，把内容一步步做好。</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="primary" icon={<Plus aria-hidden className="size-[18px]" />} onClick={() => openDialog('project')}>开始新的创作</Button>
            <Button onClick={() => show('settings')}>设置我的关注<ArrowRight aria-hidden className="size-4" /></Button>
          </div>
        </div>
        <IdeaArt />
      </div>

      <div className="grid grid-cols-3 rounded-card border border-line bg-card py-5">
        {stats.map(([label, n, hint], i) => (
          <article key={label} className={'grid min-w-0 content-center gap-1 px-3 sm:px-6 ' + (i ? 'border-l border-line' : '')}>
            <span className="text-[11px] text-muted">{label}</span>
            <strong className="text-[27px] font-medium tabular-nums leading-tight sm:text-[32px]">{n}</strong>
            <small className="hidden text-[10px] text-muted lg:block">{hint}</small>
          </article>
        ))}
      </div>

      <div className="mb-4 mt-9 flex items-end justify-between gap-4">
        <div><Eyebrow className="mb-1.5">PICK UP WHERE YOU LEFT OFF</Eyebrow><h2 className="text-[22px] font-bold">继续你的创作</h2></div>
        <Button variant="ghost" size="sm" onClick={() => show('archive')}>全部内容<ArrowUpRight aria-hidden className="size-4" /></Button>
      </div>
      <ProjectGrid items={ps.slice(0, 3)} />

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line py-6">
        <Crosshair aria-hidden className="size-7 text-acid-deep" />
        <div className="min-w-0 flex-1">
          <strong className="text-[13px]">让内容更贴近你的方向</strong>
          <p className="mt-0.5 text-xs text-muted">{activeSpace(data)?.focus || '还没有设置关注领域。添加你的方向，让每次创作更有重点。'}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => show('settings')}>调整关注<ArrowRight aria-hidden className="size-4" /></Button>
      </div>
    </>
  )
}

function IdeaArt() {
  return (
    <div aria-hidden className="relative h-[230px] overflow-hidden rounded-panel bg-[#e9edda] bg-[radial-gradient(#71834340_.7px,transparent_.7px)] bg-size-[13px_13px] sm:h-[305px]">
      <div className="absolute left-5 top-4 text-[8px] tracking-[2px] text-label">FROM IDEA TO IMPACT</div>
      <div className="absolute left-[-20px] top-[62px] h-[190px] w-[350px] -rotate-[32deg] rounded-full border border-[#87936042]" />
      <div className="absolute left-[-20px] top-[62px] h-[190px] w-[350px] rotate-40 rounded-full border border-[#87936042]" />
      <div className="absolute left-[18%] top-[30px] h-[160px] w-[130px] -rotate-[16deg] rounded-control border border-[#52622b33] bg-card p-5 text-[29px] font-bold shadow-[0_16px_30px_#3f491914] sm:top-[66px] sm:h-[176px] sm:w-[148px]">
        灵感<span className="absolute bottom-4 left-4 text-[8px] font-medium tracking-[2px]">IDEA / 01</span>
      </div>
      <div className="absolute left-[44%] top-5 h-[185px] w-[160px] rotate-9 rounded-control border border-acid/20 bg-acid-soft p-5 shadow-[0_16px_30px_#3f491914] sm:left-[40%] sm:top-[51px] sm:h-[205px] sm:w-[184px]">
        <span className="text-[7px] tracking-[1.5px]">YOUR NEXT STORY</span>
        <b className="mt-4 block text-[24px] leading-[1.35] tracking-[-1px] sm:text-[28px]">让好想法<br />有迹可循。</b>
        <Sparkles className="absolute bottom-3 right-3 size-10" strokeWidth={1.5} />
      </div>
      <div className="absolute bottom-3.5 left-5 text-[8px] tracking-[2px] text-label">搜集 · 创作 · 整理 · 交付</div>
    </div>
  )
}
