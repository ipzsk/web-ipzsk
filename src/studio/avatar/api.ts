// 数字人 adapter：形象 / 音色列表、录音上传、存为主体。mock 走 ./mock.ts。
import { useQuery } from '@tanstack/react-query'
import { ApiError, isMock, request } from '@/shared/api'
import type { AvatarList, VoiceList } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { putFile } from '@/media/useUpload'
import { uploadApi } from '../composer/uploadApi'
import { AVATAR_LIST_ERRORS, type AvatarItem, type VoiceItem } from './contract'
import { MOCK_AVATARS, MOCK_VOICES, setMockAudioMs } from './mock'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const mockFail = (key: string) => { try { return localStorage.getItem(`ipzsk.mock.avatar.${key}Fail`) === '1' } catch { return false } }

export async function listAvatars(): Promise<AvatarItem[]> {
  if (isMock) {
    await delay(450)
    if (mockFail('list')) throw new ApiError(AVATAR_LIST_ERRORS.avatar_catalog_unavailable!, { status: 503, code: 'avatar_catalog_unavailable' })
    return MOCK_AVATARS
  }
  return (await request<AvatarList>('/api/me/avatars')).items
}

/** language 用 HeyGen 的英文名（Chinese / English / Japanese…），空 = 全部。 */
export async function listVoices(language: string): Promise<VoiceItem[]> {
  if (isMock) { await delay(300); return MOCK_VOICES.filter(v => !language || v.language === language) }
  const q = new URLSearchParams(language ? { language } : {}).toString()
  return (await request<VoiceList>(`/api/me/voices${q ? `?${q}` : ''}`)).items
}

export const listErrorMessage = (e: unknown) =>
  e instanceof ApiError ? AVATAR_LIST_ERRORS[e.code] ?? e.message : '加载失败，请检查网络后重试'

export const useAvatars = (enabled = true) => useQuery({ queryKey: ['avatar', 'avatars'], queryFn: listAvatars, staleTime: 10 * 60_000, enabled })
export const useVoices = (language: string, enabled = true) => useQuery({ queryKey: ['avatar', 'voices', language], queryFn: () => listVoices(language), staleTime: 10 * 60_000, enabled })

/** 读本地文件时长（毫秒）；读不出来返回 null。只用于 mock 与上传前提示，真实时长以服务端 duration_ms 为准。 */
export function probeAudioMs(file: Blob): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const a = new Audio()
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v) }
    a.preload = 'metadata'
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : null)
    a.onerror = () => done(null)
    a.src = url
  })
}

/**
 * 录音上传：POST /api/me/uploads {kind:'audio'} → PUT → complete（服务端实测 duration_ms）。
 * useUpload 只认图片 / 视频，这里直接复用它的 putFile。
 */
export async function uploadAudio(file: File, onProgress: (p: number) => void, signal: AbortSignal): Promise<MediaAsset> {
  if (isMock) {
    const ms = await probeAudioMs(file) ?? 45_000
    for (let p = 0.2; p <= 1; p += 0.2) { await delay(120); signal.throwIfAborted(); onProgress(p) }
    const id = crypto.randomUUID()
    setMockAudioMs(id, ms)
    return { id, kind: 'audio', status: 'ready', width: null, height: null, duration_ms: ms, urls: { orig: URL.createObjectURL(file) } }
  }
  // useUpload's CreateUploadReq only types image | video; the gateway UploadRequest accepts audio.
  const req = { kind: 'audio', content_type: file.type, bytes: file.size } as unknown as Parameters<typeof uploadApi.createUpload>[0]
  const ticket = await uploadApi.createUpload(req, signal)
  await putFile(ticket.put_url, file, ticket.headers ?? {}, onProgress, signal)
  return uploadApi.completeUpload(ticket.asset_id, signal)
}
