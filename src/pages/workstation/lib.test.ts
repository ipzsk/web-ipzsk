import { describe, expect, it } from 'vitest'
import { RELEASES_PAGE, TOOLS, downloadButtons } from './lib'

describe('downloadButtons', () => {
  const data = { version: '1.4.2', assets: { mac: { name: 'a.dmg', url: 'https://github.com/x/a.dmg', bytes: 187_000_000 }, windows: { name: 'b.exe', url: 'https://github.com/x/b.exe', bytes: 152_000_000 } } }
  it('selects the asset per platform, missing platform disabled', () => {
    const { buttons, status } = downloadButtons({ status: 'ok', data })
    expect(buttons.mac).toEqual({ href: 'https://github.com/x/a.dmg', label: '下载最新正式版', meta: 'v1.4.2 · 178 MB' })
    expect(buttons.windows.meta).toBe('v1.4.2 · 145 MB')
    expect(buttons['mac-intel']).toEqual({ href: null, label: '此平台暂未发布', meta: '最新正式版尚无此平台安装包' })
    expect(status).toBe('当前正式版 v1.4.2 · 生图等插件请在客户端插件市场安装和更新。')
  })
  it('falls back to the GitHub releases page on error', () => {
    const { buttons, status } = downloadButtons({ status: 'error' })
    for (const b of Object.values(buttons)) expect(b).toMatchObject({ href: RELEASES_PAGE, external: true })
    expect(status).toBe('暂时无法读取版本，请前往 GitHub 发布页选择安装包。')
  })
  it('loading: nothing clickable', () => {
    const { buttons } = downloadButtons({ status: 'loading' })
    expect(Object.values(buttons).every(b => b.href === null && b.label === '正在读取发布信息…')).toBe(true)
  })
  it('keeps all 19 legacy tools', () => { expect(TOOLS).toHaveLength(19) })
})
