import { useEffect, useRef, useState } from 'react'
import { cn } from '@/ui'
import { NODE_LABEL, type NodeKind } from './graph'
import { KIND_ICON } from './nodes'

const HINT: Record<NodeKind, string> = {
  text: '一段提示词', image: '上传或引用图片', video: '上传视频', 'gen-image': '文生图 / 图生图', 'gen-video': '文生视频', group: '带标题的区域',
}
export const ADDABLE: NodeKind[] = ['text', 'image', 'gen-image', 'gen-video', 'video']

/** Floating node picker at screen coords (relative to the editor). Arrow keys + Enter, Esc closes, typing filters. */
export function NodeMenu({ x, y, kinds, title, onPick, onClose }: {
  x: number; y: number; kinds: NodeKind[]; title: string; onPick: (k: NodeKind) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const list = kinds.filter(k => !q || NODE_LABEL[k].includes(q) || HINT[k].includes(q))
  const pos = useRef({ x, y })

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [onClose])

  // Keep inside the editor.
  const parent = ref.current?.parentElement?.getBoundingClientRect()
  const left = parent ? Math.min(pos.current.x, parent.width - 248) : x
  const top = parent ? Math.min(pos.current.y, parent.height - 64 - list.length * 48) : y

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="absolute z-30 w-60 rounded-card border border-line bg-card p-1.5 shadow-xl motion-safe:animate-fade-in"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % Math.max(1, list.length)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + list.length) % Math.max(1, list.length)) }
        else if (e.key === 'Enter' && list[active]) onPick(list[active])
      }}
    >
      <p className="px-2 pb-1 pt-0.5 text-xs text-muted">{title}</p>
      <input
        autoFocus
        aria-label="筛选节点"
        placeholder="搜索节点…"
        value={q}
        onChange={e => { setQ(e.target.value); setActive(0) }}
        className="mb-1 h-8 w-full rounded-[8px] border border-line bg-paper px-2 text-sm outline-none focus:border-ink"
      />
      <ul role="listbox" aria-label="节点类型">
        {list.map((k, i) => {
          const Icon = KIND_ICON[k]
          return (
            <li key={k} role="option" aria-selected={i === active}>
              <button
                type="button"
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(k)}
                className={cn('flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-left transition-colors duration-(--duration-fast)', i === active && 'bg-subtle')}
              >
                <span className="grid size-7 place-items-center rounded-[8px] border border-line bg-card"><Icon className="size-4" /></span>
                <span className="grid">
                  <span className="text-sm font-semibold leading-5">{NODE_LABEL[k]}</span>
                  <span className="text-[11px] leading-4 text-muted">{HINT[k]}</span>
                </span>
              </button>
            </li>
          )
        })}
        {!list.length && <li className="px-2 py-3 text-center text-xs text-muted">没有匹配的节点</li>}
      </ul>
    </div>
  )
}
