import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, CloudUpload, Copy, Ellipsis, Heart, ImageOff, Images, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import {
  Badge, Button, Checkbox, Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger, DropdownMenu, DropdownMenuCheckboxItem,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, ErrorState, IconButton, Input,
  OfflineBanner, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Skeleton, Textarea, Tooltip, cn, menuItemClass, toast,
} from '.'

// Visual contract for §4.1. data-demo pins hover/focus/active (see ui.css custom variants).
const STATES = ['默认', '悬停', '聚焦', '按下', '选中', '禁用', '加载', '错误'] as const
const demo = ['', 'hover', 'focus', 'active'] as const

function Row({ name, cells }: { name: string; cells: (ReactNode | null)[] }) {
  return (
    <tr className="border-t border-line align-middle">
      <th scope="row" className="sticky left-0 z-10 bg-card py-4 pr-4 text-left text-[13px] font-semibold whitespace-nowrap">{name}</th>
      {cells.map((c, i) => <td key={i} className="px-2 py-4">{c ?? <span className="text-xs text-muted">—</span>}</td>)}
    </tr>
  )
}

function LoadingButtonDemo() {
  const [loading, setLoading] = useState(false)
  const run = (ms: number) => { setLoading(true); setTimeout(() => setLoading(false), ms) }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" loading={loading} loadingText="生成中" onClick={() => run(1500)}>生成 1.5s</Button>
      <Button loading={loading} loadingText="保存中" onClick={() => run(200)}>请求 200ms（不闪）</Button>
    </div>
  )
}

export function StatesPage() {
  const [seg, setSeg] = useState('image')
  const [checked, setChecked] = useState(true)
  return (
    <div className="grid gap-10">
      <header>
        <h1 className="text-2xl font-bold">状态矩阵</h1>
        <p className="mt-2 text-sm text-muted">docs/studio-redesign.md §4.1 · 每个组件的每个状态并排展示；悬停/聚焦/按下用 data-demo 固定。</p>
      </header>

      <div className="overflow-x-auto rounded-card border border-line bg-card px-4">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card py-3 text-left text-xs text-muted">组件</th>
              {STATES.map(s => <th key={s} className="px-2 py-3 text-left text-xs font-semibold text-muted whitespace-nowrap">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map(v => (
              <Row key={v} name={`Button · ${v}`} cells={[
                ...demo.map(d => <Button key={d} variant={v} data-demo={d || undefined}>发送</Button>),
                v === 'secondary' || v === 'ghost' ? <Button variant={v} aria-pressed>已选</Button> : null,
                <Button variant={v} disabled disabledReason="当前型号不支持参考图">发送</Button>,
                <ForcedLoading variant={v} />,
                null,
              ]} />
            ))}
            <Row name="IconButton" cells={[
              ...demo.map(d => <IconButton key={d} label="复制提示词" data-demo={d || undefined}><Copy className="size-[18px]" /></IconButton>),
              <IconButton label="收藏" aria-pressed variant="ghost"><Heart className="size-[18px]" /></IconButton>,
              <IconButton label="删除" disabled disabledReason="离线时不能删除"><Trash2 className="size-[18px]" /></IconButton>,
              null, null,
            ]} />
            <Row name="SegmentedControl" cells={[
              <SegmentedControl label="类型" value={seg} onValueChange={setSeg} options={[{ value: 'image', label: '图片' }, { value: 'video', label: '视频' }]} />,
              null, null, null, <span className="text-xs text-muted">见默认列（ink 底 acid 字）</span>,
              <SegmentedControl label="类型（禁用项）" value="image" onValueChange={() => {}} options={[{ value: 'image', label: '图片' }, { value: 'video', label: '视频', disabledReason: '当前账号未开通视频' }]} />,
              null, null,
            ]} />
            <Row name="Input" cells={[
              ...demo.map(d => <Input key={d} className="w-28" placeholder="文件夹名称" data-demo={d || undefined} aria-label="文件夹名称" />),
              null,
              <Input className="w-28" disabled placeholder="文件夹名称" disabledReason="离线时不能重命名" aria-label="禁用输入" />,
              null,
              <Input className="w-28" defaultValue="a/b" error="名称不能包含 /" aria-label="错误输入" />,
            ]} />
            <Row name="Textarea" cells={[
              <Textarea className="w-32" placeholder="描述你想要的画面…" aria-label="提示词" />,
              <Textarea className="w-32" data-demo="hover" placeholder="悬停" aria-label="悬停" />,
              <Textarea className="w-32" data-demo="focus" placeholder="聚焦" aria-label="聚焦" />,
              null, null,
              <Textarea className="w-32" disabled placeholder="禁用" disabledReason="生成中不能修改" aria-label="禁用" />,
              null,
              <Textarea className="w-32" error="提示词不能为空" aria-label="错误" />,
            ]} />
            <Row name="Checkbox" cells={[
              <Checkbox label="默认" />,
              <Checkbox label="悬停" data-demo="hover" />,
              <Checkbox label="聚焦" data-demo="focus" />,
              null,
              <Checkbox label="已选" checked={checked} onCheckedChange={v => setChecked(v === true)} />,
              <Checkbox label="禁用" disabled disabledReason="已达上限 12 项" />,
              null,
              <Checkbox label="必选" aria-invalid />,
            ]} />
            <Row name="菜单项" cells={[
              <div className={cn(menuItemClass, 'w-32')}><Copy className="size-4" />复制</div>,
              <div className={cn(menuItemClass, 'w-32')} data-highlighted=""><Copy className="size-4" />复制</div>,
              <div className={cn(menuItemClass, 'w-32')} data-highlighted=""><Copy className="size-4" />键盘高亮</div>,
              null,
              <div role="menu" aria-label="示例菜单"><div role="menuitemcheckbox" className={cn(menuItemClass, 'w-32 pr-8')} aria-checked="true">已勾选<Check className="absolute right-2.5 size-4" /></div></div>,
              <div className={cn(menuItemClass, 'w-32')} data-disabled=""><Copy className="size-4" />不可用</div>,
              null, null,
            ]} />
            <Row name="Badge" cells={[
              <Badge>默认</Badge>, null, null, null, <Badge tone="ink">选中</Badge>, <Badge tone="outline">已取消</Badge>,
              <Badge tone="warning"><LoaderCircle className="size-3 motion-safe:animate-spin-slow" />结算中</Badge>, <Badge tone="danger">失败</Badge>,
            ]} />
          </tbody>
        </table>
      </div>

      <Section title="浮层（可交互）">
        <Tooltip content="悬停提示"><Button>Tooltip</Button></Tooltip>
        <Popover>
          <PopoverTrigger asChild><Button icon={<ChevronDown className="size-4" />}>Popover</Button></PopoverTrigger>
          <PopoverContent><p className="font-semibold">GPT Image 2</p><p className="mt-1 text-muted">参考图最多 15 张 · 按张计费</p></PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton label="更多" variant="secondary"><Ellipsis className="size-[18px]" /></IconButton></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem><Copy className="size-4" />复制提示词</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>显示参数</DropdownMenuCheckboxItem>
            <DropdownMenuItem disabled><Images className="size-4" />以此为参考</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger><Trash2 className="size-4" />删除</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog>
          <DialogTrigger asChild><Button variant="danger-ghost" icon={<Trash2 className="size-[18px]" />}>删除确认</Button></DialogTrigger>
          <DialogContent title="删除这条记录？" description="删除后无法恢复，已生成的扣点不退回。">
            <DialogFooter>
              <DialogClose asChild><Button>取消</Button></DialogClose>
              <DialogClose asChild><Button variant="danger">删除</Button></DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button onClick={() => toast({ title: '已删除', description: '5 秒内可以撤销', action: { label: '撤销', onClick: () => toast({ title: '已恢复', tone: 'success' }) } })}>Toast · 撤销</Button>
        <Button onClick={() => toast({ title: '收藏失败，已回滚', description: '暂时无法连接服务，请检查网络后重试。', tone: 'error' })}>Toast · 错误</Button>
        <LoadingButtonDemo />
      </Section>

      <Section title="加载 · 骨架">
        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          {[4 / 3, 1, 3 / 4, 16 / 9].map((r, i) => <Skeleton key={i} className="rounded-card" style={{ aspectRatio: r }} />)}
        </div>
      </Section>

      <Section title="空 · 错误 · 离线 · 同步中">
        <div className="w-full rounded-card border border-line bg-card sm:w-72"><EmptyState icon={CloudUpload} text="还没有素材" action={{ label: '上传第一张图', onClick: () => {} }} /></div>
        <div className="grid w-full content-start gap-3 sm:w-96">
          <ErrorState reason="点数不足，请先充值。" action={{ label: '去充值', onClick: () => {} }} />
          <ErrorState reason="登录已失效，请重新登录。" action={{ label: '重新登录', onClick: () => {} }} />
          <div className="overflow-hidden rounded-card border border-line"><OfflineBanner /></div>
          <Button variant="primary" disabled disabledReason="网络已断开，恢复后可发送">发送</Button>
        </div>
        <div className="relative grid size-40 place-items-center rounded-card border border-line bg-subtle text-muted">
          <ImageOff className="size-8" />
          <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-card shadow" title="同步中">
            <LoaderCircle className="size-3.5 motion-safe:animate-spin-slow" />
          </span>
        </div>
        <Button variant="ghost" icon={<Plus className="size-[18px]" />} data-demo="hover active">悬停+按下</Button>
      </Section>
    </div>
  )
}

function ForcedLoading({ variant }: { variant: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  // loading=true forever; spinner appears after the 300ms delay.
  return <Button variant={variant} loading loadingText="生成中">发送</Button>
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-base font-bold">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}
