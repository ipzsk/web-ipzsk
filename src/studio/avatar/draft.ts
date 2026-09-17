// 数字人草稿 store + 交互时互斥（选形象移除照片、上传录音清空脚本，均可撤销）+ 每项展示信息缓存。不 import ../store（避免循环）。
import { create } from 'zustand'
import type { GenerationParams } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { queryClient } from '@/shared/query'
import { toast } from '@/ui'
import type { AvatarItem, VoiceItem } from './contract'
import { emptyAvatarDraft, itemSeconds, type AvatarDraft, type AvatarExtras } from './logic'

export const useAvatarDraft = create<AvatarDraft>(() => emptyAvatarDraft())
const get = useAvatarDraft.getState
const set = (p: Partial<AvatarDraft>) => useAvatarDraft.setState(p)

const undoToast = (title: string, prev: Partial<AvatarDraft>) =>
  toast({ title, duration: 5000, action: { label: '撤销', onClick: () => set(prev) } })

export function pickAvatar(avatar: AvatarItem) {
  const d = get()
  // 换形象时，默认音色跟着换；用户手选的音色保留。III 不可用时退回 IV。
  const tier = d.tier === 'iii' && !avatar.engines.includes('avatar_iii') ? 'iv' : d.tier
  set({ avatar, photo: null, consent: false, tier })
  if (d.photo) undoToast('已移除你的照片，改用形象库数字人', { photo: d.photo, consent: d.consent, avatar: d.avatar, tier: d.tier })
  else if (tier !== d.tier) toast({ title: `「${avatar.name}」不支持 Avatar III，已切回 Avatar IV` })
}

export function pickPhoto(photo: MediaAsset) {
  const d = get()
  set({ photo, avatar: null, consent: false, voice: d.avatar ? null : d.voice })
  if (d.avatar) undoToast(`已移除形象「${d.avatar.name}」，改用你的照片`, { avatar: d.avatar, photo: d.photo, consent: d.consent, voice: d.voice })
}

export const clearAvatarSource = () => set({ avatar: null, photo: null, consent: false })

export function setAudio(audio: MediaAsset) {
  const d = get()
  set({ audio, script: '', voice: null, voiceTab: 'audio' })
  if (d.script.trim() || d.voice) undoToast('已清空脚本与音色，改用录音驱动', { script: d.script, voice: d.voice, audio: d.audio, voiceTab: d.voiceTab })
}

export function setScript(script: string) {
  const d = get()
  if (d.audio && script.trim()) {
    set({ script, audio: null })
    undoToast('已移除录音，改用脚本朗读', { audio: d.audio, script: d.script })
    return
  }
  set({ script })
}

export const setVoice = (voice: VoiceItem | null) => set({ voice })
export const patchAvatarDraft = set
export const resetAvatarDraft = () => useAvatarDraft.setState(emptyAvatarDraft(), true)

// ── per-item 展示缓存（队列条 / 气泡用；另一台设备回退到 avatar_id 查列表缓存） ──

const EXTRAS_KEY = 'ipzsk.avatar.extras'
const readExtras = (): Record<string, AvatarExtras> => { try { return JSON.parse(localStorage.getItem(EXTRAS_KEY) ?? '{}') } catch { return {} } }
export const avatarExtras = (itemId: string | null | undefined) => itemId ? readExtras()[itemId] : undefined

/** 加入队列 / 发送时调用：快照当前草稿的名称、时长，以及报价点数（「预估 N 点 → 实扣 M 点」）。 */
export function rememberAvatarItems(entries: { item_id: string; params: GenerationParams; prompt: string; fromDraft: boolean; points?: number | null }[]) {
  if (!entries.length) return
  const all = readExtras()
  const d = get()
  for (const e of entries) {
    const prev = all[e.item_id] ?? {}
    all[e.item_id] = {
      ...prev,
      ...(e.fromDraft && {
        avatar_name: d.avatar?.name ?? (d.photo ? '我的照片' : undefined), avatar_preview: d.avatar?.preview_image_url ?? d.photo?.urls.w480 ?? d.photo?.urls.orig ?? null,
        voice_name: d.audio ? null : d.voice?.name ?? '形象默认音色', seconds: itemSeconds(e.params, e.prompt, { seconds: d.audio?.duration_ms != null ? d.audio.duration_ms / 1000 : undefined }) ?? undefined,
      }),
      ...(e.points != null && { estimate_points: e.points }),
    }
  }
  const keys = Object.keys(all)
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k] // ponytail: FIFO cap, fine for a local display cache
  try { localStorage.setItem(EXTRAS_KEY, JSON.stringify(all)) } catch { /* quota */ }
}

/** 名称回退：列表缓存里按 avatar_id 查。 */
export const avatarNameOf = (id: string) => queryClient.getQueryData<AvatarItem[]>(['avatar', 'avatars'])?.find(a => a.id === id)?.name

/**
 * 队列项「编辑」/ 记录「编辑后重发」→ 还原草稿。能从列表缓存找到的形象 / 音色用真实项，找不到就用最小桩
 * （名称来自缓存或 id），照片 / 录音只有 id 时用无预览的桩素材。
 */
export function hydrateAvatarDraft(model: string, p: GenerationParams, prompt: string, itemId?: string | null, assets: MediaAsset[] = []) {
  const x = avatarExtras(itemId)
  const avatars = queryClient.getQueryData<AvatarItem[]>(['avatar', 'avatars'])
  const voices = queryClient.getQueriesData<VoiceItem[]>({ queryKey: ['avatar', 'voices'] }).flatMap(([, v]) => v ?? [])
  const stub = (id: string, kind: 'image' | 'audio', ms: number | null = null): MediaAsset =>
    assets.find(a => a.id === id) ?? { id, kind, status: 'ready', width: null, height: null, duration_ms: ms, urls: { orig: kind === 'image' ? x?.avatar_preview ?? '' : '' } }
  const avatarId = typeof p.avatar_id === 'string' ? p.avatar_id : null
  const voiceId = typeof p.voice_id === 'string' ? p.voice_id : null
  const audio = typeof p.audio_asset_id === 'string' ? stub(p.audio_asset_id, 'audio', typeof p.audio_duration_ms === 'number' ? p.audio_duration_ms : x?.seconds != null ? x.seconds * 1000 : null) : null
  const script = typeof p.script === 'string' ? p.script : audio ? '' : prompt
  useAvatarDraft.setState({
    ...emptyAvatarDraft(),
    avatar: avatarId ? avatars?.find(a => a.id === avatarId) ?? { id: avatarId, name: x?.avatar_name ?? avatarId, type: 'avatar', avatar_type: null, gender: null, preview_image_url: x?.avatar_preview ?? null, preview_video_url: null, default_voice_id: voiceId ? null : 'default', engines: ['avatar_iv', 'avatar_iii'] } : null,
    photo: typeof p.photo_asset_id === 'string' ? stub(p.photo_asset_id, 'image') : null,
    consent: typeof p.photo_asset_id === 'string', // 照片来自已发出的请求，授权当时已勾选
    voiceTab: audio ? 'audio' : 'script', script, audio,
    voice: voiceId ? voices.find(v => v.id === voiceId) ?? { id: voiceId, name: x?.voice_name ?? voiceId, language: null, gender: null, preview_audio_url: null, support_pause: null, type: null } : null,
    tier: /-iii$/.test(model) ? 'iii' : 'iv',
    captions: p.captions === true,
    background: p.background_color ? 'color' : p.background_asset_id ? 'image' : 'none',
    backgroundColor: typeof p.background_color === 'string' ? p.background_color : '#FFFFFF',
    backgroundImage: typeof p.background_asset_id === 'string' ? stub(p.background_asset_id, 'image') : null,
  }, true)
}
