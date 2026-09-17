import { useEffect, useMemo, useState } from 'react'
import { AudioLines, Check, ChevronDown, Pause, Play, Search } from 'lucide-react'
import { Badge, Button, EmptyState, ErrorState, IconButton, Input, Popover, PopoverContent, PopoverTrigger, Skeleton, Tooltip, cn, focusRing } from '@/ui'
import { listErrorMessage, useVoices } from './api'
import type { VoiceItem } from './contract'

const LANGS = [['Chinese', '中文'], ['English', 'English'], ['Japanese', '日本語'], ['', '全部']] as const
const chip = (on: boolean) => cn('inline-flex h-7 shrink-0 cursor-pointer items-center rounded-full border px-2.5 text-xs font-semibold', on ? 'border-acid bg-acid text-white' : 'border-line bg-card hover:bg-subtle', focusRing)
const genderText = (g: string | null) => g === 'female' ? '女' : g === 'male' ? '男' : g ?? ''

// Page-wide: one preview plays at a time.
let player: HTMLAudioElement | null = null
function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => { player?.pause() }, [])
  const toggle = (v: VoiceItem) => {
    if (!v.preview_audio_url) return
    if (playing === v.id) { player?.pause(); setPlaying(null); return }
    player?.pause()
    player = new Audio(v.preview_audio_url)
    player.onended = player.onerror = () => setPlaying(p => p === v.id ? null : p)
    void player.play().catch(() => setPlaying(null))
    setPlaying(v.id)
  }
  return { playing, toggle }
}

export function VoicePicker({ voice, defaultReason, onPick, invalid }: {
  voice: VoiceItem | null; defaultReason: string | null; onPick: (v: VoiceItem | null) => void; invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState<string>('Chinese')
  const [gender, setGender] = useState<'all' | 'female' | 'male'>('all')
  const [search, setSearch] = useState('')
  const q = useVoices(lang, open)
  const preview = usePreview()
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase()
    return (q.data ?? []).filter(v => (gender === 'all' || v.gender === gender) && (!t || v.name.toLowerCase().includes(t)))
  }, [q.data, gender, search])
  const pick = (v: VoiceItem | null) => { onPick(v); setOpen(false) }
  const label = voice ? voice.name : defaultReason ? '选择音色' : '形象默认音色'

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) player?.pause() }}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`音色：${label}`} className={cn('max-w-56 gap-1 px-2', invalid && 'text-danger ring-1 ring-danger')}>
          <AudioLines className="size-4" /><span className="truncate">{label}</span><ChevronDown className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(360px,calc(100vw-32px))] p-2">
        <div className="grid gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="搜索音色" placeholder="搜索音色" value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-9" />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="语言">
            {LANGS.map(([v, l]) => <button key={l} type="button" aria-pressed={lang === v} className={chip(lang === v)} onClick={() => setLang(v)}>{l}</button>)}
            <span className="mx-0.5 w-px self-stretch bg-line" />
            {([['all', '不限'], ['female', '女声'], ['male', '男声']] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={gender === v} className={chip(gender === v)} onClick={() => setGender(v)}>{l}</button>)}
          </div>
          <ul className="grid max-h-72 gap-0.5 overflow-y-auto" aria-label="音色">
            <li>
              {(() => {
                const btn = (
                  <button type="button" disabled={!!defaultReason} onClick={() => pick(null)}
                    className={cn('flex h-11 w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 text-left text-sm hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent', !voice && !defaultReason && 'bg-subtle', focusRing)}>
                    <AudioLines className="size-4 shrink-0" /><span className="flex-1 font-semibold">形象默认音色</span>{!voice && !defaultReason && <Check className="size-4" />}
                  </button>
                )
                return defaultReason ? <Tooltip content={defaultReason}><span className="block" tabIndex={0}>{btn}</span></Tooltip> : btn
              })()}
            </li>
            {q.isPending ? Array.from({ length: 4 }, (_, i) => <li key={i}><Skeleton className="m-1 h-9" /></li>)
              : q.isError ? <li><ErrorState reason={listErrorMessage(q.error)} action={{ label: '重试', onClick: () => void q.refetch() }} /></li>
              : !shown.length ? <li><EmptyState icon={AudioLines} text="没有符合筛选的音色" action={{ label: '清除筛选', onClick: () => { setSearch(''); setGender('all'); setLang('') } }} /></li>
              : shown.map(v => (
                <li key={v.id} className={cn('flex items-center gap-1 rounded-[10px] pr-1 hover:bg-subtle', voice?.id === v.id && 'bg-subtle')}>
                  <IconButton size="icon-sm" label={preview.playing === v.id ? `暂停试听 ${v.name}` : `试听 ${v.name}`} disabled={!v.preview_audio_url} disabledReason="该音色没有试听" onClick={() => preview.toggle(v)}>
                    {preview.playing === v.id ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </IconButton>
                  <button type="button" onClick={() => pick(v)} className={cn('flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[6px] text-left text-sm', focusRing)}>
                    <span className="min-w-0 flex-1 truncate font-semibold">{v.name}</span>
                    <span className="shrink-0 text-xs text-muted">{[v.language, genderText(v.gender)].filter(Boolean).join(' · ')}</span>
                    {v.support_pause && <Badge tone="outline" className="h-5 px-1.5 text-[10px]">可停顿</Badge>}
                    {voice?.id === v.id && <Check className="size-4 shrink-0" />}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}
