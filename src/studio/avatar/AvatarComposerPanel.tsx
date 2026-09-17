import { useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Captions, FileText, ImageUp, Info, LoaderCircle, Mic, Palette, RefreshCw, RotateCw, Upload, UserPlus, UserRound, X } from 'lucide-react'
import { Badge, Button, Checkbox, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedControl, Tooltip, cn, toast } from '@/ui'
import { MediaImage } from '@/media'
import { subjectErrorMessage } from '../api/subjects'
import { createSubjectOptimistic } from '../subjects/actions'
import { openSubjectEditor } from '../subjects/SubjectEditor'
import { uploadAudio } from './api'
import { AvatarPicker, AvatarThumb, usePhotoUpload } from './AvatarPicker'
import type { AvatarControl } from './contract'
import { clearAvatarSource, patchAvatarDraft, setAudio, setScript, setVoice, useAvatarDraft } from './draft'
import { estimateBillSeconds, formatSeconds, speechSeconds, validateAudioFile, type AvatarDecision, type Background } from './logic'
import { VoicePicker } from './VoicePicker'

export interface AvatarQuote { points: number | null; estimated_seconds?: number; amount_kind?: string; error?: { code: string; message: string } }

const FieldMsg = ({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'muted' }) =>
  <p role={tone === 'danger' ? 'alert' : undefined} className={cn('flex items-start gap-1 px-1 text-xs', tone === 'danger' ? 'text-danger' : 'text-muted')}>
    {tone === 'danger' ? <AlertCircle className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}<span>{children}</span>
  </p>

async function saveAvatarAsSubject(d: ReturnType<typeof useAvatarDraft.getState>) {
  if (d.photo) { openSubjectEditor({ initialAssets: [d.photo], kind: 'avatar', name: '我的数字人' }); return }
  const a = d.avatar
  if (!a) return
  try {
    await createSubjectOptimistic({
      name: a.name.slice(0, 30), kind: 'avatar', note: '', assets: [], cover_id: null,
      external_ref: { provider: 'heygen', avatar_id: a.id, name: a.name, preview_image_url: a.preview_image_url, preview_video_url: a.preview_video_url },
    })
    toast({ title: `已存为主体「${a.name.slice(0, 30)}」`, tone: 'success' })
  } catch (e) { toast({ title: '存为主体失败', description: subjectErrorMessage(e), tone: 'error' }) }
}

function AudioField({ invalid }: { invalid: boolean }) {
  const audio = useAvatarDraft(s => s.audio)
  const [job, setJob] = useState<{ name: string; progress: number; error?: string; file: File } | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const start = async (file: File) => {
    const reason = validateAudioFile(file)
    if (reason) { toast({ title: '无法使用这段录音', description: reason, tone: 'error' }); return }
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setJob({ name: file.name, progress: 0, file })
    try {
      const asset = await uploadAudio(file, p => setJob(j => j && { ...j, progress: p }), c.signal)
      setJob(null)
      setAudio(asset)
    } catch (e) {
      if (c.signal.aborted) return
      setJob(j => j && { ...j, error: e instanceof Error ? e.message : '上传失败' })
    }
  }
  const cancel = () => { ctrl.current?.abort(); setJob(null) }
  return (
    <div className={cn('grid gap-1.5 rounded-control border border-line p-2', invalid && 'border-danger')}>
      <input ref={input} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void start(f); e.target.value = '' }} />
      {job ? (
        <div role="status" className="flex items-center gap-2 text-sm">
          <Mic className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{job.name}</span>
          {job.error
            ? <><span className="text-xs text-danger">{job.error}</span><Button size="sm" icon={<RotateCw className="size-4" />} onClick={() => void start(job.file)}>重试</Button></>
            : <><LoaderCircle className="size-4 motion-safe:animate-spin-slow" /><span className="text-xs tabular-nums text-muted">{job.progress >= 1 ? '测量时长中' : `${Math.round(job.progress * 100)}%`}</span></>}
          <IconButton size="icon-sm" label="取消上传" onClick={cancel}><X className="size-4" /></IconButton>
        </div>
      ) : audio ? (
        <div className="flex flex-wrap items-center gap-2">
          {audio.urls.orig ? <audio controls preload="metadata" src={audio.urls.orig} className="h-9 min-w-0 flex-1" aria-label="试听录音" /> : <span className="flex-1 text-sm">录音（本设备没有试听地址）</span>}
          <span className="text-xs tabular-nums text-muted">{audio.duration_ms != null ? `时长 ${formatSeconds(audio.duration_ms / 1000)}` : '时长测量中'}</span>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => input.current?.click()}>更换</Button>
          <IconButton size="icon-sm" label="移除录音" onClick={() => patchAvatarDraft({ audio: null })}><X className="size-4" /></IconButton>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void start(f) }}
          className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-dashed border-acid/30 bg-acid-soft/50 text-sm text-label hover:border-acid hover:bg-acid-soft">
          <Upload className="size-4" />上传录音 · MP3 / WAV，≤32MB，1 秒–10 分钟
        </button>
      )}
      <p className="px-1 text-xs text-muted">录音驱动时数字人按录音口型说话；最少按 60 秒计费，按成片实际时长结算。</p>
    </div>
  )
}

function BackgroundControl({ decision }: { decision: AvatarDecision }) {
  const d = useAvatarDraft()
  const bg = usePhotoUpload(a => patchAvatarDraft({ backgroundImage: a, background: 'image' }), 'ipzsk:avatar-bg-upload')
  const r = decision.controls.backgroundReason
  const label = d.background === 'color' ? d.backgroundColor : d.background === 'image' ? '图片背景' : '无背景'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`背景：${label}`} className="gap-1 px-2">
          {d.background === 'color' ? <span className="size-4 rounded-[4px] border border-line" style={{ background: d.backgroundColor }} /> : d.background === 'image' ? <ImageUp className="size-4" /> : <Palette className="size-4" />}{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="grid w-64 gap-2 p-3">
        {bg.picker}
        <SegmentedControl<Background> label="背景" value={d.background} onValueChange={v => patchAvatarDraft({ background: v })} options={[
          { value: 'none', label: '无' }, { value: 'color', label: '纯色', disabledReason: r.color ?? undefined }, { value: 'image', label: '图片', disabledReason: r.image ?? undefined },
        ]} />
        {d.background === 'color' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(d.backgroundColor) ? d.backgroundColor : '#ffffff'} onChange={e => patchAvatarDraft({ backgroundColor: e.target.value.toUpperCase() })} className="size-9 cursor-pointer rounded-control border border-line" aria-label="选择颜色" />
            <input value={d.backgroundColor} onChange={e => patchAvatarDraft({ backgroundColor: e.target.value })} maxLength={7} aria-label="颜色值 #RRGGBB" className="h-9 w-24 rounded-control border border-line px-2 font-mono text-sm uppercase" />
          </label>
        )}
        {d.background === 'image' && (
          <div className="flex items-center gap-2">
            {d.backgroundImage ? <MediaImage asset={d.backgroundImage} alt="背景图" hideBadge className="size-12 rounded-control" /> : <span className="grid size-12 place-items-center rounded-control bg-subtle text-muted"><ImageUp className="size-5" /></span>}
            <Button size="sm" loading={!!bg.busy && bg.busy.status !== 'failed'} icon={<Upload className="size-4" />} onClick={bg.open}>{d.backgroundImage ? '更换' : '上传 PNG/JPEG'}</Button>
          </div>
        )}
        {bg.busy?.status === 'failed' && <FieldMsg>{bg.busy.error}</FieldMsg>}
        <p className="text-xs text-muted">纯色与图片背景二选一。</p>
      </PopoverContent>
    </Popover>
  )
}

/** 数字人模式下替换参考槽位 + 提示词编辑器（§2.2）。发送 / 加入队列 / 比例清晰度仍在输入框底栏。 */
export function AvatarComposerPanel({ decision, quote, quotePending, fieldError, onSubmit }: {
  decision: AvatarDecision
  quote?: AvatarQuote
  quotePending?: boolean
  /** 编辑中的红色队列项的错误（已按 guideAvatarError 定位控件）。 */
  fieldError?: { message: string; control: AvatarControl | null } | null
  onSubmit: () => void
}) {
  const d = useAvatarDraft()
  const [pickerOpen, setPickerOpen] = useState(false)
  const c = decision.controls
  const bad = (ctl: AvatarControl) => fieldError?.control === ctl
  const errFor = (ctl: AvatarControl) => bad(ctl) ? <FieldMsg>{fieldError!.message}</FieldMsg> : null
  const chars = [...d.script].length
  const speech = speechSeconds(d.script)
  const billSeconds = quote?.estimated_seconds ?? estimateBillSeconds({ script: d.script, audioMs: d.audio?.duration_ms ?? null })
  const hasVoiceInput = decision.voiceSource != null

  return (
    <div className="grid gap-2 pb-1">
      {/* 形象 */}
      <div className="flex flex-wrap items-center gap-2">
        {d.avatar || d.photo ? (
          <div className={cn('flex min-w-0 items-center gap-2 rounded-control border border-line bg-paper py-1 pl-1 pr-1.5', bad('avatar') && 'border-danger')}>
            {d.avatar ? <AvatarThumb avatar={d.avatar} className="size-10 shrink-0 overflow-hidden rounded-[8px]" /> : <MediaImage asset={d.photo!} alt="我的照片" hideBadge className="size-10 shrink-0 rounded-[8px]" />}
            <div className="grid min-w-0">
              <span className="truncate text-sm font-semibold">{d.avatar ? d.avatar.name : '我的照片'}</span>
              <span className="flex items-center gap-1 text-[11px] text-muted">
                {d.avatar ? <>形象库{d.avatar.engines.includes('avatar_iii') ? ' · IV / III' : ' · 仅 IV'}</> : '照片数字人'}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>更换</Button>
            <IconButton size="icon-sm" label="存为主体" onClick={() => void saveAvatarAsSubject(useAvatarDraft.getState())}><UserPlus className="size-4" /></IconButton>
            <IconButton size="icon-sm" label="移除形象" onClick={clearAvatarSource}><X className="size-4" /></IconButton>
          </div>
        ) : (
          <Button variant="secondary" icon={<UserRound className="size-[18px]" />} onClick={() => setPickerOpen(true)} className={cn(bad('avatar') && 'border-danger')}>选择形象</Button>
        )}
        {c.consentVisible && (
          <Checkbox label="我确认拥有该肖像的使用授权" checked={d.consent} onCheckedChange={v => patchAvatarDraft({ consent: v === true })} aria-invalid={!d.consent || undefined} />
        )}
      </div>
      {errFor('avatar')}

      {/* 声音 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SegmentedControl label="声音来源" value={d.voiceTab} onValueChange={v => patchAvatarDraft({ voiceTab: v })} className="h-8" options={[{ value: 'script', label: '脚本朗读', icon: FileText }, { value: 'audio', label: '上传录音', icon: Mic }]} />
        {d.voiceTab === 'script' && <VoicePicker voice={d.voice} defaultReason={c.defaultVoiceReason} onPick={setVoice} invalid={bad('voice') || decision.blocks.some(b => b.control === 'voice') && !!d.script.trim()} />}
        {d.voiceTab === 'script' && d.voice?.support_pause && <Tooltip content={'在脚本里写 <break time="1s"/> 插入 1 秒停顿'}><Badge tone="outline" className="h-6 cursor-help">可插入停顿</Badge></Tooltip>}
      </div>
      {errFor('voice')}
      {d.voiceTab === 'script' ? (
        <div className="grid gap-1">
          {d.audio && <FieldMsg tone="muted">已上传录音；在这里输入脚本会移除录音（可撤销）</FieldMsg>}
          <textarea
            value={d.script} onChange={e => setScript(e.target.value)} aria-label="数字人脚本" aria-invalid={bad('script') || chars > c.scriptMax || undefined}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit() } }}
            placeholder="输入数字人要念的内容…（Cmd/Ctrl+Enter 发送）"
            className={cn('min-h-20 max-h-[calc(8lh+1rem)] w-full resize-none rounded-control border border-line bg-card px-3 py-2 text-sm leading-6 [field-sizing:content] focus:border-acid focus:ring-3 focus:ring-acid/10 focus-visible:outline-none aria-invalid:border-danger')}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-xs text-muted">
            <span className={cn('tabular-nums', chars > c.scriptMax && 'font-semibold text-danger')}>{chars} / {c.scriptMax} 字</span>
            {d.script.trim() && <span className="tabular-nums">朗读约 {formatSeconds(speech)}</span>}
            {d.script.trim() && <CostLine quote={quote} pending={quotePending} billSeconds={billSeconds} />}
          </div>
          {errFor('script')}
        </div>
      ) : (
        <div className="grid gap-1">
          <AudioField invalid={bad('audio')} />
          {d.audio && <div className="px-1 text-xs text-muted"><CostLine quote={quote} pending={quotePending} billSeconds={billSeconds} /></div>}
          {errFor('audio')}
        </div>
      )}

      {/* 选项 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {c.tier.visible && (
          <SegmentedControl label="数字人档位" value={d.tier} onValueChange={v => patchAvatarDraft({ tier: v })} className={cn('h-8', bad('tier') && 'ring-1 ring-danger')} options={[
            { value: 'iv', label: 'Avatar IV 高质量' },
            { value: 'iii', label: 'Avatar III 经济', disabledReason: d.tier === 'iii' ? undefined : c.tier.iiiReason ?? undefined },
          ]} />
        )}
        <Button size="sm" variant="ghost" icon={<Captions className="size-4" />} aria-pressed={d.captions} disabled={!!c.captionsReason && !d.captions} disabledReason={c.captionsReason ?? undefined}
          onClick={() => patchAvatarDraft({ captions: !d.captions })} className={cn(bad('captions') && 'ring-1 ring-danger')}>字幕{d.captions ? '：开' : '：关'}</Button>
        <BackgroundControl decision={decision} />
      </div>
      {errFor('background')}{errFor('captions')}
      {hasVoiceInput && decision.reason && !fieldError && decision.blocks[0]?.control !== 'script' && <FieldMsg tone="muted">{decision.reason}</FieldMsg>}
      <AvatarPicker open={pickerOpen} onOpenChange={setPickerOpen} selectedId={d.avatar?.id ?? null} photoReason={c.photoReason} initialTab={d.photo ? 'photo' : 'library'} />
    </div>
  )
}

function CostLine({ quote, pending, billSeconds }: { quote?: AvatarQuote; pending?: boolean; billSeconds: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span className="tabular-nums">按 {formatSeconds(billSeconds)} 预扣{quote?.points != null ? <> · 约 <b className="text-ink">{quote.points}</b> 点</> : quote?.error && !pending ? ` · 暂无报价（${quote.error.message}）` : ' · 报价中…'}</span>
      <span>· 按实际时长结算，可能多退少补</span>
    </span>
  )
}
