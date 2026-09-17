// `?mock=1` 数字人：型号、形象、音色、报价、成片。纯数据 + 纯函数（catalog.ts / records.ts 的 mock 分支调用）。
import type { GenerationParams, ModelSpec } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { AVATAR_ERRORS, type AvatarItem, type VoiceItem } from './contract'
import { estimateBillSeconds, speechSeconds } from './logic'

const avatarParams = [
  { field: 'aspect_ratio', type: 'enum', values: ['16:9', '9:16', '1:1'], default: '16:9' },
  { field: 'resolution', type: 'enum', values: ['720p', '1080p'], default: '720p' },
] satisfies ModelSpec['params']
const cap = (source: ('library' | 'photo')[], engine: string, voice_required: boolean) =>
  ({ source, voice: ['script', 'audio'], script: { max: 5000, voice_required }, captions: true, background: ['color', 'image'], engine }) satisfies ModelSpec['avatar']

/** 与网关 lanehub-catalog 的输出同形（heygen-image 可通过 localStorage['ipzsk.mock.avatar.noPhoto']='1' 隐藏）。 */
export const MOCK_AVATAR_MODELS: ModelSpec[] = [
  { id: 'heygen-avatar', kind: 'video', name: 'Avatar IV', billing: { unit: 'per_minute_output' }, params: avatarParams, references: { maxImages: 0 }, unsupported: {}, mode: 'avatar', avatar: cap(['library'], 'iv', false) },
  { id: 'heygen-avatar-iii', kind: 'video', name: 'Avatar III', billing: { unit: 'per_minute_output' }, params: avatarParams, references: { maxImages: 0 }, unsupported: {}, mode: 'avatar', avatar: cap(['library'], 'iii', false) },
  { id: 'heygen-image', kind: 'video', name: '照片数字人', billing: { unit: 'per_minute_output' }, params: avatarParams, references: { maxImages: 0 }, unsupported: {}, mode: 'talking_photo', avatar: cap(['photo'], 'iv', true) },
]
export const mockAvatarModels = () => {
  try { return localStorage.getItem('ipzsk.mock.avatar.noPhoto') === '1' ? MOCK_AVATAR_MODELS.filter(m => m.mode !== 'talking_photo') : MOCK_AVATAR_MODELS } catch { return MOCK_AVATAR_MODELS }
}

const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'
const pic = (seed: string) => `https://picsum.photos/seed/avatar-${seed}/480/600`
const both = ['avatar_iv', 'avatar_iii']
const mk = (id: string, name: string, gender: string, engines: string[], extra: Partial<AvatarItem> = {}): AvatarItem => ({
  id, name, type: 'avatar', avatar_type: 'studio_avatar', gender, preview_image_url: pic(id), preview_video_url: VIDEO, default_voice_id: 'v-zh-f1', engines, ...extra,
})
export const MOCK_AVATARS: AvatarItem[] = [
  mk('av-lin', '林岚 · 职业装', 'female', both),
  mk('av-chen', '陈默 · 衬衫', 'male', both, { default_voice_id: 'v-zh-m1' }),
  mk('av-sara', 'Sara · Studio', 'female', ['avatar_iv'], { default_voice_id: 'v-en-f1' }),
  mk('av-james', 'James · Casual', 'male', both, { default_voice_id: 'v-en-m1' }),
  mk('av-yuki', 'Yuki · 新闻台', 'female', ['avatar_iv']),
  mk('av-novoice', '周航 · 无默认音色', 'male', both, { default_voice_id: null }),
  mk('av-photo', '我的照片数字人', 'female', [], { type: 'talking_photo', avatar_type: 'photo_avatar', preview_video_url: null, default_voice_id: null }),
  mk('av-anna', 'Anna · 户外', 'female', both, { default_voice_id: 'v-en-f1' }),
]

const AUDIO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3'
const v = (id: string, name: string, language: string, gender: string, support_pause = true): VoiceItem =>
  ({ id, name, language, gender, preview_audio_url: AUDIO, support_pause, type: 'public' })
export const MOCK_VOICES: VoiceItem[] = [
  v('v-zh-f1', '晓晓 · 温柔', 'Chinese', 'female'),
  v('v-zh-f2', '晓伊 · 活泼', 'Chinese', 'female', false),
  v('v-zh-m1', '云希 · 沉稳', 'Chinese', 'male'),
  v('v-zh-m2', '云健 · 播音', 'Chinese', 'male'),
  v('v-en-f1', 'Sara', 'English', 'female'),
  v('v-en-m1', 'James', 'English', 'male', false),
  v('v-ja-f1', 'Nanami', 'Japanese', 'female'),
]

/** 点数/秒（按 $/min × 7.2 汇率随手折算，只为演示）。 */
const RATE: Record<string, number> = { 'heygen-avatar': 0.58, 'heygen-avatar-iii': 0.12, 'heygen-image': 0.28 }
const round1 = (n: number) => Math.round(n * 10) / 10

export function mockAvatarQuote(e: { model: string; params: GenerationParams }) {
  const p = e.params
  const audioMs = p.audio_asset_id ? mockAudioMs(String(p.audio_asset_id)) : null
  if (!p.script && !p.audio_asset_id) return { points: null, error: { code: 'avatar_voice_required', message: AVATAR_ERRORS.avatar_voice_required!.message } }
  const seconds = estimateBillSeconds({ script: String(p.script ?? ''), audioMs })
  return { points: round1(seconds * (RATE[e.model] ?? 0.58)), amount_kind: 'estimate', estimated_seconds: seconds, estimate_basis: audioMs != null ? 'audio_duration' as const : 'script' as const }
}

/** mock 录音时长：上传时写入（真实环境服务端 ffprobe）。 */
const audioMs = new Map<string, number>()
export const setMockAudioMs = (id: string, ms: number) => { audioMs.set(id, ms); try { sessionStorage.setItem(`ipzsk.mock.audio.${id}`, String(ms)) } catch { /* ignore */ } }
const mockAudioMs = (id: string) => audioMs.get(id) ?? (() => { try { return Number(sessionStorage.getItem(`ipzsk.mock.audio.${id}`) ?? 45000) } catch { return 45000 } })()

/** 成片真实秒数（mock）：录音按录音，脚本按字数 ±10%。 */
const realSeconds = (r: { id: string; prompt: string; params: GenerationParams }) => {
  const p = r.params
  if (p.audio_asset_id) return mockAudioMs(String(p.audio_asset_id)) / 1000
  const s = speechSeconds(typeof p.script === 'string' ? p.script : r.prompt)
  const jitter = 0.9 + (parseInt(r.id.replace(/\D/g, '').slice(0, 4) || '5', 10) % 20) / 100
  return Math.max(1, s * jitter)
}

export function mockAvatarResults(r: { id: string; prompt: string; params: GenerationParams; updated_at: string }): (MediaAsset & { source: 'generation'; thumb_state: 'done'; created_at: string })[] {
  const [w, h] = r.params.aspect_ratio === '9:16' ? [720, 1280] : r.params.aspect_ratio === '1:1' ? [960, 960] : [1280, 720]
  const duration_ms = Math.round(realSeconds(r) * 1000)
  const one = (i: number) => ({
    id: `${r.id}-r${i}`, kind: 'video' as const, source: 'generation' as const, status: 'ready' as const, width: w, height: h, duration_ms, thumb_state: 'done' as const, created_at: r.updated_at,
    urls: { orig: VIDEO, poster: `https://picsum.photos/seed/avatar-${r.id}/${Math.round(w / 2)}/${Math.round(h / 2)}`, w480: `https://picsum.photos/seed/avatar-${r.id}/480/${Math.round((480 * h) / w)}` },
  })
  return r.params.captions === true ? [one(0), one(1)] : [one(0)]
}

export const mockAvatarCharge = (r: { id: string; model: string; prompt: string; params: GenerationParams }) => round1(realSeconds(r) * (RATE[r.model] ?? 0.58))

/** QA：脚本里含 #授权 / #审核 / #人脸 时模拟对应的用户侧错误。 */
export function mockAvatarError(p: GenerationParams): { code: string; field?: string } | null {
  const s = String(p.script ?? '')
  if (s.includes('#授权')) return { code: 'avatar_consent_required', field: 'avatar_id' }
  if (s.includes('#审核')) return { code: 'content_policy_violation', field: 'script' }
  if (s.includes('#人脸')) return { code: 'avatar_photo_no_face', field: 'photo_asset_id' }
  if (s.includes('#约束')) return { code: 'constraint_violation', field: 'script|audio_url' }
  return null
}
