// Release selection for the download menu (ported from designer's home-downloads.js @479bf1e + legacy size meta).
// 安装包放在私有 R2，版本与限时签名下载地址由网关 GET /api/public/desktop-release 下发。
import { request } from '@/shared/api'
import type { DesktopRelease } from '@/shared/contracts'

/** 最后兜底：只在接口整个读不出来时才露出来，对终端用户来说这个私有仓库的发布页是打不开的。 */
export const RELEASE_PAGE = 'https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/latest'

export type Platform = 'mac' | 'mac-intel' | 'windows'
export const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  { id: 'mac-intel', label: 'Mac x64', hint: 'Intel Mac' },
  { id: 'mac', label: 'Mac ARM64', hint: 'Apple Silicon' },
  { id: 'windows', label: 'Windows x64', hint: '兼容 ARM64' },
]

export interface ReleasePayload { version: string; assets: Partial<Record<Platform, { url: string; bytes?: number; name?: string }>> }
/** href 为 null ⇒ 该平台这一版没有安装包，按钮不可点（不是死链接）。 */
export interface Option { id: Platform; href: string | null; action: string; meta: string; direct: boolean }

export function detectPlatform(ua: string, platform = ''): Platform | '' {
  const s = `${ua} ${platform}`.toLowerCase()
  if (s.includes('win')) return 'windows'
  if (s.includes('mac')) return s.includes('arm') || s.includes('apple') ? 'mac' : 'mac-intel'
  return ''
}

/** 网关返回的 files[] 按平台索引；未知平台忽略。 */
export function toPayload(data: DesktopRelease): ReleasePayload {
  const assets: ReleasePayload['assets'] = {}
  for (const f of data.files ?? []) {
    if (PLATFORMS.some(p => p.id === f.platform)) assets[f.platform as Platform] = { url: f.url, bytes: f.bytes, name: f.name }
  }
  return { version: data.version, assets }
}

/**
 * 读得到版本：有安装包就直连签名地址，没有就是「暂未发布」的禁用态。
 * 整个请求失败（payload 为 null）才退到 GitHub 发布页。
 */
export function releaseOptions(payload: ReleasePayload | null, fallbackPage = RELEASE_PAGE): Option[] {
  return PLATFORMS.map(({ id }) => {
    if (!payload) return { id, href: fallbackPage, action: '前往发布页', meta: '', direct: false }
    const asset = payload.assets[id]
    if (!asset) return { id, href: null, action: '暂未发布', meta: '这一版没有此平台安装包', direct: false }
    return { id, href: asset.url, action: `下载 v${payload.version}`, meta: `v${payload.version}${asset.bytes ? ` · ${(asset.bytes / 1024 / 1024).toFixed(0)} MB` : ''}`, direct: true }
  })
}

export async function fetchRelease(signal?: AbortSignal): Promise<ReleasePayload> {
  const data = await request<DesktopRelease>('/api/public/desktop-release', { signal })
  if (typeof data?.version !== 'string' || !Array.isArray(data.files)) throw new Error('release unavailable')
  return toPayload(data)
}
