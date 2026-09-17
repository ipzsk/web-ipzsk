// 数字人纯规则：形象来源 × 声音来源判定、时长估算、文件校验、提交体映射、队列摘要。无 React、无 store；logic.test.ts 覆盖。
import type { GenerationParams, ModelSpec } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { ApiError } from '@/shared/api'
import type { QueueEntry } from '../api/queue'
import {
  AUDIO_MAX_BYTES, AUDIO_TYPES, AVATAR_ERRORS, AVATAR_WIRE_FIELDS, CJK_CHARS_PER_SECOND, MAX_BILL_SECONDS, MIN_BILL_SECONDS, PHOTO_TYPES,
  SCRIPT_MAX, WORDS_PER_SECOND, controlOfField, engineKey, type AvatarControl, type AvatarItem, type AvatarTier, type VoiceItem,
} from './contract'

// ── 时长估算（与 lanehub estimate.go 同一公式） ─────────────────────────────

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

/** 朗读秒数：CJK 按字 3.5 字/秒，其余按空白切词 2 词/秒，两段相加。不夹取。 */
export function speechSeconds(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  const words = text.replace(CJK, ' ').split(/\s+/).filter(Boolean).length
  return cjk / CJK_CHARS_PER_SECOND + words / WORDS_PER_SECOND
}

const clamp = (s: number) => !(s > 0) ? MIN_BILL_SECONDS : Math.min(MAX_BILL_SECONDS, Math.max(MIN_BILL_SECONDS, s))
/** 预扣按的估算秒数：脚本按字数；录音按实测时长（至少 60 秒）；都夹在 [60, 1800]。 */
export const estimateBillSeconds = (v: { script?: string; audioMs?: number | null }) =>
  clamp(v.audioMs != null ? v.audioMs / 1000 : speechSeconds(v.script ?? ''))

export const formatSeconds = (s: number) => {
  const r = Math.round(s)
  return r < 60 ? `${r} 秒` : `${Math.floor(r / 60)} 分 ${String(r % 60).padStart(2, '0')} 秒`
}

// ── 文件校验 ───────────────────────────────────────────────────────────────

const MB = 1024 * 1024
export function validatePhotoFile(f: { type: string; size: number }): string | null {
  if (f.type === 'image/webp') return 'HeyGen 不支持 WebP，请转成 PNG 或 JPEG 后再上传'
  if (!(PHOTO_TYPES as readonly string[]).includes(f.type)) return '照片只支持 PNG 或 JPEG'
  if (f.size > 20 * MB) return '照片不能超过 20MB'
  return null
}
export function validateAudioFile(f: { type: string; size: number; name?: string }): string | null {
  if (f.type === 'audio/mp4' || f.type === 'audio/x-m4a' || /\.m4a$/i.test(f.name ?? '')) return '暂不支持 M4A，请转成 MP3 或 WAV 后再上传'
  if (!(AUDIO_TYPES as readonly string[]).includes(f.type)) return '录音只支持 MP3 或 WAV'
  if (f.size > AUDIO_MAX_BYTES) return '录音不能超过 32MB'
  return null
}

// ── 草稿与判定 ─────────────────────────────────────────────────────────────

export type Background = 'none' | 'color' | 'image'
export interface AvatarDraft {
  /** 形象库数字人（→ avatar_id）。与 photo 互斥。 */
  avatar: AvatarItem | null
  /** 你的照片（PNG/JPEG 素材 → photo_asset_id）。 */
  photo: MediaAsset | null
  /** 「我确认拥有该肖像的使用授权」，照片模式必勾。 */
  consent: boolean
  /** 声音面板当前显示哪一栏；两栏都没内容时决定提示语。 */
  voiceTab: 'script' | 'audio'
  script: string
  /** null = 形象默认音色。 */
  voice: VoiceItem | null
  /** 录音素材（kind audio，duration_ms 服务端实测）。 */
  audio: MediaAsset | null
  tier: AvatarTier
  captions: boolean
  background: Background
  backgroundColor: string
  backgroundImage: MediaAsset | null
}

export const emptyAvatarDraft = (): AvatarDraft => ({
  avatar: null, photo: null, consent: false, voiceTab: 'script', script: '', voice: null, audio: null,
  tier: 'iv', captions: false, background: 'none', backgroundColor: '#FFFFFF', backgroundImage: null,
})

export interface Block { control: AvatarControl; message: string }
export type AvatarFields = Partial<Record<typeof AVATAR_WIRE_FIELDS[number], string | boolean>>

export interface AvatarDecision {
  source: 'library' | 'photo' | null
  voiceSource: 'script' | 'audio' | null
  model: ModelSpec | undefined
  /** 要发的数字人字段（不含 aspect_ratio / resolution）。被拦时也尽量给出，用于报价。 */
  fields: AvatarFields
  blocks: Block[]
  /** 第一条拦截原因（发送按钮的 disabledReason）。 */
  reason: string | null
  controls: {
    tier: { visible: boolean; iiiReason: string | null }
    /** 「用我的照片」不可用原因。 */
    photoReason: string | null
    /** 「形象默认音色」不可用原因。 */
    defaultVoiceReason: string | null
    consentVisible: boolean
    captionsReason: string | null
    backgroundReason: { color: string | null; image: string | null }
    scriptMax: number
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/

/** 型号集合里的数字人线：形象库按引擎分档，照片单独一条。 */
export function avatarModels(models: ModelSpec[]) {
  const library = models.filter(m => m.avatar?.source.includes('library'))
  return {
    library,
    tier: (t: AvatarTier) => library.find(m => m.avatar!.engine === t),
    photo: models.find(m => m.avatar?.source.includes('photo')),
  }
}

/** III 档不可用原因（null = 可用）。 */
export function tierIIIReason(models: ModelSpec[], avatar: AvatarItem | null): string | null {
  if (!avatarModels(models).tier('iii')) return 'Avatar III 经济档暂未开放，请使用 Avatar IV'
  if (avatar && !avatar.engines.includes(engineKey('iii'))) return `「${avatar.name}」不支持 Avatar III，请用 Avatar IV 高质量，或换一个支持 III 的形象`
  return null
}

export function decideAvatar(d: AvatarDraft, models: ModelSpec[]): AvatarDecision {
  const am = avatarModels(models)
  const source = d.avatar && !d.photo ? 'library' : d.photo && !d.avatar ? 'photo' : null
  const model = source === 'photo' ? am.photo : am.tier(d.tier)
  const cap = model?.avatar
  const hasScript = !!d.script.trim()
  const voiceSource = hasScript && !d.audio ? 'script' : d.audio && !hasScript ? 'audio' : null
  const scriptMax = cap?.script.max ?? SCRIPT_MAX
  const voiceRequired = source === 'photo' || !!cap?.script.voice_required
  const iiiReason = tierIIIReason(models, d.avatar)
  const blocks: Block[] = []
  const block = (control: AvatarControl, message: string) => blocks.push({ control, message })

  // 形象
  if (!model) block('tier', source === 'photo' ? '照片数字人暂未开放，请改用形象库数字人' : d.tier === 'iii' ? 'Avatar III 经济档暂未开放，请使用 Avatar IV' : '数字人型号暂未开放，请稍后再试')
  if (d.avatar && d.photo) block('avatar', `形象只能选一个：保留形象库数字人「${d.avatar.name}」或你的照片，移除另一个`)
  else if (!d.avatar && !d.photo) block('avatar', '先选择形象：从形象库挑一个数字人，或上传你的照片（PNG/JPEG）')
  if (d.photo && !d.consent) block('consent', '请勾选「我确认拥有该肖像的使用授权」，或改用形象库数字人')
  if (source === 'library' && d.tier === 'iii' && iiiReason && model) block('tier', iiiReason)

  // 声音
  if (hasScript && d.audio) block('script', '声音只能选一个：清空脚本改用录音，或移除录音改用脚本')
  else if (!voiceSource) block(d.voiceTab === 'audio' ? 'audio' : 'script', d.voiceTab === 'audio' ? '先上传录音（MP3/WAV，≤32MB），或改为输入脚本' : '先输入要念的脚本，或改为上传录音（MP3/WAV）')
  if (voiceSource === 'script') {
    const n = [...d.script].length
    if (n > scriptMax) block('script', `脚本最多 ${scriptMax} 字，当前 ${n} 字：请删减，或改为上传录音`)
    if (!d.voice && voiceRequired) block('voice', `${source === 'photo' ? '照片数字人' : '该型号'}朗读脚本需要选择音色，或改为上传录音`)
    else if (!d.voice && d.avatar && !d.avatar.default_voice_id) block('voice', `「${d.avatar.name}」没有默认音色：请选择音色，或改为上传录音`)
  }

  // 选项
  const backgroundReason = {
    color: cap && !cap.background.includes('color') ? '当前型号不支持纯色背景' : null,
    image: cap && !cap.background.includes('image') ? '当前型号不支持图片背景' : null,
  }
  if (d.background === 'color' && backgroundReason.color) block('background', `${backgroundReason.color}，请改为无背景`)
  else if (d.background === 'color' && !HEX.test(d.backgroundColor)) block('background', '背景色需为 #RRGGBB，或改为无背景 / 图片背景')
  if (d.background === 'image' && backgroundReason.image) block('background', `${backgroundReason.image}，请改为无背景`)
  else if (d.background === 'image' && !d.backgroundImage) block('background', '先上传背景图（PNG/JPEG），或改为无背景 / 纯色')
  const captionsReason = cap && !cap.captions ? '当前型号不支持字幕' : null
  if (d.captions && captionsReason) block('captions', `${captionsReason}，请关闭字幕`)

  const fields: AvatarFields = {}
  if (d.avatar) fields.avatar_id = d.avatar.id
  if (d.photo) fields.photo_asset_id = d.photo.id
  if (hasScript) {
    fields.script = d.script
    if (d.voice) fields.voice_id = d.voice.id
  }
  if (d.audio) fields.audio_asset_id = d.audio.id
  if (cap?.captions) fields.captions = d.captions
  if (d.background === 'color') fields.background_color = d.backgroundColor
  if (d.background === 'image' && d.backgroundImage) fields.background_asset_id = d.backgroundImage.id

  return {
    source, voiceSource, model, fields, blocks, reason: blocks[0]?.message ?? null,
    controls: {
      tier: { visible: source !== 'photo', iiiReason },
      photoReason: am.photo ? null : '照片数字人暂未开放',
      defaultVoiceReason: source === 'photo' ? '照片数字人没有默认音色，请选择音色'
        : voiceRequired ? '该型号需要选择音色'
        : d.avatar && !d.avatar.default_voice_id ? `「${d.avatar.name}」没有默认音色` : null,
      consentVisible: !!d.photo,
      captionsReason,
      backgroundReason,
      scriptMax,
    },
  }
}

// ── 队列项 / 提交体 ────────────────────────────────────────────────────────

export const isAvatarParams = (p: GenerationParams | null | undefined) =>
  !!p && ('avatar_id' in p || 'photo_asset_id' in p || 'avatar_source' in p)

/** 型号参数里数字人输入框只调比例与清晰度（其余由面板控件负责）。 */
export const avatarParamModel = (m: ModelSpec): ModelSpec => ({ ...m, params: m.params.filter(p => p.field === 'aspect_ratio' || p.field === 'resolution') })

/** 草稿 → 队列项。prompt 只是展示用摘要（脚本或「录音驱动」），发送时不带。 */
export function avatarQueueItem(d: AvatarDraft, decision: AvatarDecision, params: GenerationParams, item_id: string = crypto.randomUUID()): QueueEntry {
  const prompt = d.script.trim() ? d.script : d.audio ? `录音驱动 · ${formatSeconds((d.audio.duration_ms ?? 0) / 1000)}` : ''
  return {
    item_id, kind: 'video', model: decision.model?.id ?? '', prompt, params: { ...params, ...decision.fields } as GenerationParams,
    reference_asset_ids: [], anchor_of: null, mentions: [], prompt_doc: null, slots: [],
  }
}

type Err = { code: string; message: string; field?: string }

/** 发送前按线上字段再查一次互斥（队列项可能被编辑过或来自另一台设备）。 */
export function checkAvatarParams(p: GenerationParams, prompt = ''): Err | null {
  const has = (k: string) => p[k] !== undefined && p[k] !== ''
  const script = has('script') || (!has('audio_asset_id') && !!prompt.trim() && 'avatar_source' in p)
  const err = (code: string, field: string): Err => ({ code, field, message: AVATAR_ERRORS[code]!.message })
  if (has('avatar_id') && has('photo_asset_id')) return err('avatar_source_conflict', 'avatar_id|photo_asset_id')
  if (!has('avatar_id') && !has('photo_asset_id')) return err('avatar_source_required', 'avatar_id|photo_asset_id')
  if (script && has('audio_asset_id')) return err('avatar_voice_conflict', 'script|audio_asset_id')
  if (!script && !has('audio_asset_id')) return err('avatar_voice_required', 'script|audio_asset_id')
  if (has('voice_id') && has('audio_asset_id')) return err('avatar_voice_conflict', 'voice_id')
  if (has('background_color') && has('background_asset_id')) return err('background_conflict', 'background_color|background_asset_id')
  if (has('background_color') && !HEX.test(String(p.background_color))) return err('invalid_background_color', 'background_color')
  return null
}

const SENT = new Set<string>([...AVATAR_WIRE_FIELDS, 'aspect_ratio', 'resolution'])

/**
 * PendingGeneration → POST /api/me/videos/generations body。不带 prompt / reference_asset_ids；
 * 记录回来的 params（再生成）里没有 script（记录把脚本存在 prompt），按 voice_source 补回。
 */
export function avatarSubmitBody(v: {
  model: string; prompt: string; params: GenerationParams; batch_id: string | null; batch_position: number | null; parent_record_id: string | null
  thread_id: string | null; anchor_record_id: string | null; mentions: unknown[]; prompt_doc: unknown
}) {
  const fields = Object.fromEntries(Object.entries(v.params).filter(([k, x]) => SENT.has(k) && x !== ''))
  if (fields.script === undefined && fields.audio_asset_id === undefined && v.params.voice_source === 'script' && v.prompt) fields.script = v.prompt
  return {
    model: v.model, ...fields, batch_id: v.batch_id, batch_position: v.batch_position, parent_record_id: v.parent_record_id,
    thread_id: v.thread_id, anchor_record_id: v.anchor_record_id, mentions: v.mentions, prompt_doc: v.prompt_doc,
  }
}

/** 错误 → 原因 + 下一步（中文）与控件。constraint_violation 用网关原文（已是中文）并按 field 定位。 */
export function guideAvatarError(e: Err, raw?: unknown): Err & { control: AvatarControl | null } {
  const known = AVATAR_ERRORS[e.code]
  const serverMessage = raw instanceof ApiError ? (raw.body as { error?: { message?: unknown } } | null)?.error?.message : undefined
  const message = e.code === 'constraint_violation' && typeof serverMessage === 'string' ? serverMessage
    : known?.message ?? (typeof serverMessage === 'string' ? serverMessage : e.message)
  return { ...e, message, control: controlOfField(e.field) ?? known?.control ?? null }
}

// ── 展示 ───────────────────────────────────────────────────────────────────

export interface AvatarExtras { avatar_name?: string; avatar_preview?: string | null; voice_name?: string | null; seconds?: number; estimate_points?: number | null }

/** 朗读秒数：录音用实测，脚本用字数估（不夹取，展示用）。 */
export function itemSeconds(p: GenerationParams, prompt: string, extras?: AvatarExtras): number | null {
  if (extras?.seconds != null) return extras.seconds
  if (typeof p.audio_duration_ms === 'number') return p.audio_duration_ms / 1000
  const script = typeof p.script === 'string' ? p.script : p.audio_asset_id ? '' : prompt
  return script ? speechSeconds(script) : null
}

/** 队列条 / 气泡摘要：「数字人 · 形象名 · 45s」。 */
export function avatarSummary(p: GenerationParams, prompt: string, extras?: AvatarExtras, nameOf?: (id: string) => string | undefined): string {
  const name = extras?.avatar_name ?? (typeof p.avatar_id === 'string' ? nameOf?.(p.avatar_id) : undefined) ?? (p.photo_asset_id ? '我的照片' : '数字人')
  const s = itemSeconds(p, prompt, extras)
  return ['数字人', name, ...(s != null ? [`${Math.max(1, Math.round(s))}s`] : [])].join(' · ')
}

/** 气泡参数行：只列用户关心的（比例、清晰度、声音来源、字幕、背景）。 */
export function avatarDisplayParams(p: GenerationParams): GenerationParams {
  const out: GenerationParams = {}
  if (p.aspect_ratio) out.aspect_ratio = p.aspect_ratio
  if (p.resolution) out.resolution = p.resolution
  out.voice = p.audio_asset_id || p.voice_source === 'audio' ? '录音' : '脚本'
  if (p.captions === true) out.captions = '字幕'
  if (p.background_color) out.background = `背景 ${p.background_color}`
  else if (p.background_asset_id) out.background = '图片背景'
  return out
}

/** 生成结果：主片在前，captioned 版（result_index 1）在后。 */
export const captionedIndex = (p: GenerationParams, results: unknown[]) => p.captions === true && results.length > 1 ? 1 : -1

// ── 队列线上格式（PUT /api/me/queue）：数字人字段在项的顶层，prompt 必须为 ''，不带参考图 ────────

type WireLike = { prompt: string; params?: GenerationParams }

/** 本地队列项（字段在 params 里、prompt 为展示摘要）→ 线上项。非数字人项原样返回。 */
export function avatarItemToWire<T extends WireLike>(i: T): T {
  if (!isAvatarParams(i.params)) return i
  const params: GenerationParams = {}, top: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(i.params ?? {})) (AVATAR_WIRE_FIELDS as readonly string[]).includes(k) ? top[k] = v : params[k] = v
  return { ...i, ...top, prompt: '', params, reference_asset_ids: [] } as T
}

/** 线上项 → 本地项：顶层数字人字段收回 params，prompt 还原为摘要（脚本或「录音驱动」）。 */
export function avatarItemFromWire<T extends WireLike>(i: T): T {
  const r = i as unknown as Record<string, unknown>
  const top = Object.fromEntries(AVATAR_WIRE_FIELDS.filter(k => r[k] != null && r[k] !== '').map(k => [k, r[k] as string | boolean]))
  if (!('avatar_id' in top || 'photo_asset_id' in top || 'script' in top || 'audio_asset_id' in top)) return i
  const out: Record<string, unknown> = { ...r }
  for (const k of AVATAR_WIRE_FIELDS) delete out[k]
  const params = { ...i.params, ...top }
  return { ...out, params, prompt: typeof top.script === 'string' ? top.script : top.audio_asset_id ? '录音驱动' : '' } as unknown as T
}
