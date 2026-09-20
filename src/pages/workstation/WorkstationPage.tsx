import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, BellRing, BookOpen, Building, ChartColumn, Check, ChevronDown, ChevronRight, Clapperboard,
  CodeXml, Download, ExternalLink, Feather, FileText, Headset, LayoutTemplate, MessageCircle, Newspaper, Palette, PenLine, Presentation,
  Sprout, TrendingUp, Volume2, Wrench, type LucideIcon,
} from 'lucide-react'
import { Badge, buttonVariants, cn, focusRing, Tooltip } from '@/ui'
import { FILTERS, TOOLS, downloadButtons, fetchDesktopRelease, type Platform } from './lib'

const ICONS: Record<string, LucideIcon> = { FileText, BookOpen, Sprout, Wrench, Palette, Presentation, PenLine, Newspaper, LayoutTemplate, CodeXml, Feather, Clapperboard, BellRing, Volume2, MessageCircle, Building, ChartColumn, Headset, TrendingUp }

const shell = 'mx-auto w-full max-w-[1200px] px-8 max-md:px-4'
const eyebrow = 'text-[11px] font-semibold tracking-[.2em] text-muted'
const lift = 'transition-[transform,box-shadow,border-color,background-color] duration-(--duration-fast) ease-(--ease-standard) hover:border-muted hover:shadow-md motion-safe:hover:-translate-y-px active:scale-[.99]'

function SectionTitle({ kicker, title, aside }: { kicker: string; title: string; aside: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div><p className={eyebrow}>{kicker}</p><h2 className="mt-3 text-[32px] font-black tracking-[-.8px] max-md:text-[26px]">{title}</h2></div>
      <p className="text-right text-[13px] leading-6 text-muted max-md:text-left">{aside}</p>
    </div>
  )
}

export function WorkstationPage() {
  return (
    <>
      <main>
        <Hero />
        <Steps />
        <Downloads />
        <Tools />
        <Guide />
      </main>
      <footer className={cn(shell, 'flex flex-wrap items-center justify-between gap-4 border-t border-line py-8 text-[13px] text-muted')}>
        <strong className="font-black text-ink">IPZSK</strong>
        <p>基于 Claudian 与开源工具构建。各组件的来源和许可证随安装包提供。</p>
        <a href="/" className={cn('inline-flex items-center gap-1 rounded-[6px] hover:text-ink', focusRing)}>回到首页<ArrowUpRight aria-hidden className="size-3.5" /></a>
      </footer>
    </>
  )
}

function Hero() {
  return (
    <section className={cn(shell, 'grid grid-cols-[1fr_1.05fr] items-center gap-12 py-20 max-lg:grid-cols-1 max-md:py-12')}>
      <div>
        <p className={cn(eyebrow, 'flex items-center gap-2')}><span aria-hidden className="size-1.5 rounded-full bg-acid-deep" />YOUR KNOWLEDGE. READY TO WORK.</p>
        <h1 className="mt-6 text-[64px] font-black leading-[1.08] tracking-[-2px] max-md:text-[42px]">让 AI 住进<br />你的<span className="text-label">知识库。</span></h1>
        <p className="mt-6 text-base leading-7 text-muted">资料整理、做 PPT、写内容、画封面。<br />在 Obsidian 里说一句，让 ChatGPT 模型和 Codex 帮你完成。</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#download" className={cn(buttonVariants({ variant: 'primary', size: 'lg' }))}>下载完整工作台<ArrowDown aria-hidden className="size-[18px]" /></a>
          <a href="#tools" className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}>看看能做什么<ArrowUpRight aria-hidden className="size-[18px]" /></a>
        </div>
        <p className="mt-6 text-xs text-muted">Mac · Windows　/　本地文件　/　一个 IPZSK 平台凭证</p>
      </div>
      <Preview />
    </section>
  )
}

function Preview() {
  return (
    <div aria-label="工作台功能示意" role="img" className="overflow-hidden rounded-panel border border-line bg-card shadow-[0_30px_60px_-30px_rgba(29,31,32,.35)] motion-safe:lg:rotate-[1deg]">
      <div className="flex items-center gap-1.5 border-b border-line bg-subtle/60 px-4 py-2.5">
        {[0, 1, 2].map(i => <i key={i} className="size-2.5 rounded-full bg-line" />)}
        <span className="flex-1 text-center text-[11px] text-muted">我的 IPZSK 知识库</span>
      </div>
      <div className="grid grid-cols-[150px_1fr] text-[11px] max-sm:grid-cols-1">
        <aside className="grid content-start gap-2 border-r border-line bg-paper/60 p-4 text-muted max-sm:hidden">
          <b className="text-ink">知识库</b>
          {['项目资料', '内容创作'].map(t => <p key={t} className="flex items-center gap-1"><ChevronRight aria-hidden className="size-3" />{t}</p>)}
          <p className="flex items-center gap-1"><ChevronDown aria-hidden className="size-3" />本周发布</p>
          <p className="flex items-center gap-1 rounded-[6px] bg-acid/50 px-1.5 py-1 text-ink"><FileText aria-hidden className="size-3" />产品方案.md</p>
          <p className="flex items-center gap-1 pl-1.5"><FileText aria-hidden className="size-3" />调研记录.md</p>
          <p className="flex items-center gap-1"><ChevronRight aria-hidden className="size-3" />生成的文件</p>
          <p className="mt-10 leading-5">所有资料<br /><strong className="text-ink">连成工作流</strong></p>
        </aside>
        <div className="grid content-start gap-3 p-5">
          <div className="flex items-center justify-between font-semibold">AI 助手 <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">Codex</span></div>
          <div className="rounded-control bg-acid-soft px-3 py-2.5">根据产品方案，做一份 8 页的介绍 PPT。</div>
          <p className="text-muted">我会先整理目标用户和核心卖点，再生成可编辑的演示文稿。</p>
          {['读取产品方案', '整理内容与页面结构', '生成演示文稿'].map(t => <div key={t} className="flex items-center gap-2"><Check aria-hidden className="size-3 text-acid-deep" />{t}</div>)}
          <div className="flex items-center gap-3 rounded-control border border-line p-3">
            <Presentation aria-hidden className="size-5 text-warning" />
            <div><strong className="block">产品介绍.pptx</strong><small className="text-muted">可编辑演示文稿 · 功能示意</small></div>
          </div>
          <div className="mt-2 flex items-center justify-between rounded-control border border-line px-3 py-2 text-muted">继续描述你想完成的事… <ArrowUp aria-hidden className="size-4 rounded bg-ink p-0.5 text-white" /></div>
        </div>
      </div>
    </div>
  )
}

function Steps() {
  const steps: [string, string, string, string, LucideIcon][] = [
    ['/account', '获取平台凭证', '登录账户，生成 API 凭证', '01', ArrowUpRight],
    ['#download', '安装工作台', '下载、解压，双击开始安装', '02', ArrowDown],
    ['#tools', '选工具，开始做事', '文档与创作工具，按需使用', '03', ArrowRight],
  ]
  return (
    <section aria-label="安装步骤" className={cn(shell, 'grid grid-cols-3 gap-3 max-md:grid-cols-1')}>
      {steps.map(([href, title, sub, n, Icon]) => (
        <a key={n} href={href} className={cn('flex items-center gap-4 rounded-card border border-line bg-card p-5', lift, focusRing)}>
          <em className="text-[28px] font-light not-italic text-muted tabular-nums">{n}</em>
          <div className="min-w-0 flex-1"><strong className="block text-sm">{title}</strong><p className="mt-1 text-xs text-muted">{sub}</p></div>
          <Icon aria-hidden className="text-muted" />
        </a>
      ))}
    </section>
  )
}

const CARDS: { platform: Platform; tag: string; title: string; body: [string, string]; primary?: boolean }[] = [
  { platform: 'mac', tag: 'MACOS · APPLE SILICON', title: 'Mac · M 系列芯片', body: ['适用于 Apple Silicon Mac。', '打开 DMG，将应用拖入「应用程序」。'], primary: true },
  { platform: 'mac-intel', tag: 'MACOS · INTEL', title: 'Mac · Intel 芯片', body: ['适用于 Intel Mac。', '安装包是否可用以最新正式版为准。'] },
  { platform: 'windows', tag: 'WINDOWS', title: 'Windows PC', body: ['适用于 Windows 64 位。', '下载后运行安装程序。'] },
]

function Downloads() {
  const release = useQuery({ queryKey: ['desktop-release'], queryFn: fetchDesktopRelease, retry: 1, staleTime: 5 * 60_000, refetchOnWindowFocus: false })
  const { buttons, status } = downloadButtons(release.isPending ? { status: 'loading' } : release.isError ? { status: 'error' } : { status: 'ok', data: release.data })
  return (
    <section id="download" className={cn(shell, 'scroll-mt-20 py-20 max-md:py-14')}>
      <SectionTitle kicker="IPZSK DESKTOP" title="下载 IPZSK 桌面客户端。" aside={<>自动提供 GitHub 最新正式版。<br />登录账号后使用模型，插件独立安装和更新。</>} />
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        {CARDS.map(c => {
          const b = buttons[c.platform]
          const cls = cn(buttonVariants({ variant: c.primary ? 'primary' : 'secondary', size: 'md' }), 'mt-6 w-fit')
          const reason = release.isPending ? '正在读取最新正式版' : '最新正式版尚无此平台安装包'
          return (
            <article key={c.platform} className="flex flex-col rounded-panel border border-line bg-card p-7 max-md:p-5">
              <span className={eyebrow}>{c.tag}</span>
              <h3 className="mt-3 text-xl font-bold">{c.title}</h3>
              <p className="mt-2 text-[13px] leading-6 text-muted">{c.body[0]}<br />{c.body[1]}</p>
              <div className="mt-auto">
                {b.href ? (
                  <a href={b.href} className={cls} {...(b.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                    {b.external ? <ExternalLink aria-hidden /> : <Download aria-hidden />}{b.label}
                  </a>
                ) : (
                  <Tooltip content={reason}>
                    <a role="link" aria-disabled="true" tabIndex={0} className={cls} aria-busy={release.isPending || undefined}>
                      {release.isPending && <Download aria-hidden className="motion-safe:animate-pulse" />}{b.label}
                    </a>
                  </Tooltip>
                )}
                <small className="mt-3 block min-h-4 text-xs text-muted tabular-nums">{b.meta}</small>
              </div>
            </article>
          )
        })}
      </div>
      <p role="status" className={cn('mt-4 min-h-5 text-[13px]', release.isError ? 'text-warning' : 'text-muted')}>{status}</p>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-line py-4 text-[13px]">
        <span className="text-xs text-muted">插件独立更新</span>
        {['登录 IPZSK 账号', '打开插件市场', '安装生图插件 · 使用 punk 风格库'].map(t => <strong key={t}>{t}</strong>)}
      </div>
    </section>
  )
}

function Tools() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('all')
  return (
    <section id="tools" className={cn(shell, 'scroll-mt-20 py-20 max-md:py-14')}>
      <SectionTitle kicker="YOUR TOOLBOX" title="把想法，变成看得见的成果。" aside={<>基础文档能力直接使用。<br />其他工具包含源码与安装说明。</>} />
      <div role="group" aria-label="筛选工具" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'rounded-full')}>{f.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        {TOOLS.filter(t => filter === 'all' || t[2] === filter).map(([icon, name, , status, description]) => {
          const Icon = ICONS[icon]!
          return (
            <article key={name} className="flex flex-col rounded-card border border-line bg-card p-5 motion-safe:animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-control bg-subtle"><Icon aria-hidden className="size-[18px]" /></span>
                <Badge tone="outline">{status}</Badge>
              </div>
              <h3 className="mt-4 font-bold">{name}</h3>
              <p className="mt-2 flex-1 text-[13px] leading-6 text-muted">{description}</p>
              <div className="mt-4 border-t border-line pt-3 text-[11px] text-muted">在工作台中描述任务，或查看随包安装说明</div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

const FAQ: [string, string][] = [
  ['安装后在哪里使用？', '打开安装器创建的「IPZSK知识库」，在 Obsidian 设置中启用 IPZSK 工作台并填写平台凭证。侧栏打开 Claudian 聊天，使用 Codex 选择 GPT 模型后描述任务。'],
  ['凭证和文件保存在哪里？', '知识库文件保存在本机。平台凭证单独保存在此设备的 IPZSK 运行目录；对话中使用的资料会作为上下文发送至 api.ipzsk.com，由平台转发给模型服务。'],
  ['需要自己安装运行环境吗？', '完整安装包包含 Obsidian 安装程序、Agent 和文档处理运行环境。微信、视频号及其他外部平台集成需要你自己的账号和授权，部分进阶工具按说明安装额外依赖。'],
  ['怎么更新或更换凭证？', '退出 Obsidian，解压新版安装包后运行「更新工作台」。默认知识库里的笔记会保留。更换凭证可直接在 IPZSK 插件设置里保存新值；遇到问题运行「检查问题」查看诊断。'],
  ['工具与模型服务如何收费？', '工作台和工具包免费下载。模型可用性、账户额度与服务状态以 IPZSK 账户页面为准。微信等第三方服务使用其各自的账户与规则。'],
]

function Guide() {
  return (
    <section id="guide" className={cn(shell, 'grid grid-cols-[1fr_1.4fr] gap-12 py-20 max-lg:grid-cols-1 max-md:py-14')}>
      <div>
        <p className={eyebrow}>GET STARTED</p>
        <h2 className="mt-3 text-[32px] font-black tracking-[-.8px] max-md:text-[26px]">从一句话开始。</h2>
        <p className="mt-5 text-sm leading-7 text-muted">「把这份调研整理成报告」<br />「给新产品做一份 PPT」<br />「根据我的素材写三篇推文」</p>
        <a href="/account" className={cn(buttonVariants({ variant: 'primary' }), 'mt-6')}>打开账号与额度<ArrowUpRight aria-hidden /></a>
      </div>
      <div className="divide-y divide-line border-y border-line">
        {FAQ.map(([q, a], i) => (
          <details key={q} open={i === 0} className="group">
            <summary className={cn('flex cursor-pointer list-none items-center gap-2 rounded-[6px] py-4 text-sm font-semibold hover:text-label [&::-webkit-details-marker]:hidden', focusRing)}>
              <ChevronRight aria-hidden className="transition-transform duration-(--duration-fast) group-open:rotate-90" />{q}
            </summary>
            <p className="pb-4 pl-6 text-[13px] leading-6 text-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
