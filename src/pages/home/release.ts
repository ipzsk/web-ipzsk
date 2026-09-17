// Release selection for the download menu (ported from designer's home-downloads.js @479bf1e + legacy size meta).
export const RELEASE_PAGE = 'https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/latest'

export type Platform = 'mac' | 'mac-intel' | 'windows'
export const PLATFORMS: { id: Platform; label: string; hint: string }[] = [
  { id: 'mac-intel', label: 'Mac x64', hint: 'Intel Mac' },
  { id: 'mac', label: 'Mac ARM64', hint: 'Apple Silicon' },
  { id: 'windows', label: 'Windows x64', hint: '兼容 ARM64' },
]

export interface ReleasePayload { version: string; assets?: Partial<Record<Platform, { url: string; bytes?: number; name?: string }>>; releasePage?: string }
export interface Option { id: Platform; href: string; action: string; meta: string; direct: boolean }

export function detectPlatform(ua: string, platform = ''): Platform | '' {
  const s = `${ua} ${platform}`.toLowerCase()
  if (s.includes('win')) return 'windows'
  if (s.includes('mac')) return s.includes('arm') || s.includes('apple') ? 'mac' : 'mac-intel'
  return ''
}

/** Missing asset or failed request ⇒ link to the GitHub release page instead of a dead button. */
export function releaseOptions(payload: ReleasePayload | null, fallbackPage = RELEASE_PAGE): Option[] {
  return PLATFORMS.map(({ id }) => {
    const asset = payload?.assets?.[id]
    if (!payload || !asset) return { id, href: payload?.releasePage || fallbackPage, action: '前往发布页', meta: payload ? '最新正式版尚无此平台安装包' : '', direct: false }
    return { id, href: asset.url, action: `下载 v${payload.version}`, meta: `v${payload.version}${asset.bytes ? ` · ${(asset.bytes / 1024 / 1024).toFixed(0)} MB` : ''}`, direct: true }
  })
}

export async function fetchRelease(signal?: AbortSignal): Promise<ReleasePayload> {
  // Same-origin Vercel function (not the API gateway), exactly like the legacy page.
  // contracts-ignore: Vercel function api/desktop-release.js, not a gateway route
  const r = await fetch('/api/desktop-release', { headers: { Accept: 'application/json' }, signal })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data?.version) throw Object.assign(new Error('release unavailable'), { releasePage: data?.releasePage as string | undefined })
  return data
}
