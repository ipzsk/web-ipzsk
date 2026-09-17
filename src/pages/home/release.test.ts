import { describe, expect, it, vi, afterEach } from 'vitest'
import { RELEASE_PAGE, detectPlatform, fetchRelease, releaseOptions } from './release'

const payload = {
  version: '1.4.2',
  releasePage: RELEASE_PAGE,
  assets: {
    mac: { url: 'https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/download/v1.4.2/IPZSK.Desktop-1.4.2-arm64.dmg', bytes: 120 * 1024 * 1024 },
    windows: { url: 'https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/download/v1.4.2/DSH-Desktop-1.4.2-x64-Setup.exe', bytes: 90 * 1024 * 1024 },
  },
}

describe('home release selection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps assets per platform, falls back to the release page when a platform is missing', () => {
    const [intel, arm, win] = releaseOptions(payload)
    expect(arm).toMatchObject({ id: 'mac', href: payload.assets.mac.url, action: '下载 v1.4.2', meta: 'v1.4.2 · 120 MB', direct: true })
    expect(win).toMatchObject({ id: 'windows', direct: true, meta: 'v1.4.2 · 90 MB' })
    expect(intel).toMatchObject({ id: 'mac-intel', href: RELEASE_PAGE, direct: false, meta: '最新正式版尚无此平台安装包' })
  })

  it('request failure ⇒ every option links to the (server-provided) release page', () => {
    const opts = releaseOptions(null, 'https://github.com/x/releases/latest')
    expect(opts.every(o => !o.direct && o.href === 'https://github.com/x/releases/latest')).toBe(true)
  })

  it('detects the visitor platform like the designer script', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe('mac-intel')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; arm64)', 'MacIntel')).toBe('mac')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('')
  })

  it('fetchRelease throws with releasePage on 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'release_unavailable', releasePage: 'https://r' }), { status: 503 })))
    await expect(fetchRelease()).rejects.toMatchObject({ releasePage: 'https://r' })
  })
})
