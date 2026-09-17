import { ArrowUp, Clapperboard, Image } from 'lucide-react'
import { Button, SegmentedControl } from '@/ui'
import { useComposer } from '../store'

// Owned by F3. Bottom floating composer shared by inspiration / create / assets views.
export function Composer({ hidden }: { hidden: boolean }) {
  const { kind, setKind } = useComposer()
  return (
    <div hidden={hidden} className="pointer-events-none fixed inset-x-0 bottom-4 z-30 px-4 max-md:bottom-[72px] md:left-52">
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-panel border border-line bg-card p-3 shadow-xl">
        <textarea
          aria-label="提示词"
          placeholder="描述你想要的画面…"
          rows={2}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted [field-sizing:content] max-h-[calc(8lh+.5rem)]"
        />
        <div className="mt-2 flex items-center gap-2">
          <SegmentedControl label="类型" value={kind} onValueChange={setKind} options={[{ value: 'image', label: '图片', icon: Image }, { value: 'video', label: '视频', icon: Clapperboard }]} />
          <div className="flex-1" />
          <Button variant="primary" icon={<ArrowUp className="size-[18px]" />} disabled disabledReason="输入框将在 F3 接入">发送</Button>
        </div>
      </div>
    </div>
  )
}

