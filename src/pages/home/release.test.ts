import { describe, expect, it, vi, afterEach } from 'vitest'
import { RELEASE_PAGE, detectPlatform, fetchRelease, releaseOptions, toPayload } from './release'

// 网关 GET /api/public/desktop-release 的响应：安装包在私有 R2，url 是限时签名地址。
const response = {
  version: '1.4.2',
  released_at: '2026-09-01T00:00:00.000Z',
  files: [
    { platform: 'mac' as const, name: 'IPZSK.Desktop-1.4.2-arm64.dmg', bytes: 120 * 1024 * 1024, sha256: 'a'.repeat(64), url: 'https://acc.r2.cloudflarestorage.com/b/desktop/1.4.2/IPZSK.Desktop-1.4.2-arm64.dmg?X-Amz-Signature=1' },
    { platform: 'windows' as const, name: 'DSH-Desktop-1.4.2-x64-Setup.exe', bytes: 90 * 1024 * 1024, sha256: 'b'.repeat(64), url: 'https://acc.r2.cloudflarestorage.com/b/desktop/1.4.2/DSH-Desktop-1.4.2-x64-Setup.exe?X-Amz-Signature=2' },
  ],
}
const payload = toPayload(response)

describe('home release selection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('indexes the gateway files[] by platform and ignores unknown platforms', () => {
    expect(payload).toEqual({
      version: '1.4.2',
      assets: {
        mac: { url: response.files[0]!.url, bytes: 120 * 1024 * 1024, name: 'IPZSK.Desktop-1.4.2-arm64.dmg' },
        windows: { url: response.files[1]!.url, bytes: 90 * 1024 * 1024, name: 'DSH-Desktop-1.4.2-x64-Setup.exe' },
      },
    })
    expect(toPayload({ ...response, files: [{ ...response.files[0]!, platform: 'linux' as never }] }).assets).toEqual({})
  })

  it('maps assets per platform; a platform missing from the manifest is disabled, not a dead link', () => {
    const [intel, arm, win] = releaseOptions(payload)
    expect(arm).toMatchObject({ id: 'mac', href: response.files[0]!.url, action: '下载 v1.4.2', meta: 'v1.4.2 · 120 MB', direct: true })
    expect(win).toMatchObject({ id: 'windows', direct: true, meta: 'v1.4.2 · 90 MB' })
    expect(intel).toEqual({ id: 'mac-intel', href: null, action: '暂未发布', meta: '这一版没有此平台安装包', direct: false })
  })

  it('request failure ⇒ every option falls back to the GitHub release page', () => {
    const opts = releaseOptions(null)
    expect(opts.every(o => !o.direct && o.href === RELEASE_PAGE)).toBe(true)
  })

  it('detects the visitor platform like the designer script', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe('mac-intel')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; arm64)', 'MacIntel')).toBe('mac')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('')
  })

  it('fetchRelease hits the gateway endpoint and rejects on 503', async () => {
    const fetchMock = vi.fn(async (url: string) => { void url; return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRelease()).resolves.toEqual(payload)
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/api\/public\/desktop-release$/)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'desktop_release_unavailable' } }), { status: 503 })))
    await expect(fetchRelease()).rejects.toMatchObject({ code: 'desktop_release_unavailable' })
  })
})
