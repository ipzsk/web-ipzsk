import { beforeEach, expect, it } from 'vitest'
import { DESKTOP, MOBILE, e2eDescribe, gotoMock, overflowX, resetStorage, shot, useBrowser, type Ctx } from './support'

// Mock mode for studio/admin; /next/* pages run signed out (every /api/** → 401 from the route guard).
const STUDIO = ['/studio', '/studio/create', '/studio/assets', '/studio/subjects', '/studio/canvas', '/admin']
const NEXT = ['/next/home', '/next/account', '/next/developer', '/next/workstation', '/next/workspace']

async function loads(t: Ctx, path: string) {
  t.errors.length = 0
  await gotoMock(t.page, path, { mock: path.startsWith('/studio') || path.startsWith('/admin') })
  await t.page.getByRole('banner').first().waitFor()
  await t.page.waitForLoadState('load')
  // Settle past loading skeletons (the admin gate skeleton is measured separately below).
  await t.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 15_000 }).catch(() => {})
  expect(t.errors, `${path} errors`).toEqual([])
}

/** Report the widest offenders so a failure names the element, not just a pixel count. */
const offenders = (t: Ctx) => t.page.evaluate(() => {
  const w = document.documentElement.clientWidth
  return [...document.querySelectorAll<HTMLElement>('body *')]
    .filter(el => el.getBoundingClientRect().right > w + 1 && !el.parentElement?.closest('[class*="overflow-x-auto"],[class*="overflow-hidden"],[class*="overflow-x-hidden"]'))
    .slice(0, 5).map(el => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} right=${Math.round(el.getBoundingClientRect().right)}`)
})

for (const viewport of [DESKTOP, MOBILE]) {
  e2eDescribe(`layout ${viewport.width}px`, () => {
    const t = useBrowser({ viewport })
    beforeEach(() => resetStorage(t.page))

    for (const path of [...STUDIO, ...NEXT]) {
      it(`${path} loads without uncaught errors${viewport === MOBILE ? ' and no horizontal overflow' : ''}`, async () => {
        await loads(t, path)
        if (viewport !== MOBILE) return
        const over = await overflowX(t.page)
        if (over > 0) await shot(t.page, `overflow${path.replaceAll('/', '_')}`)
        expect({ over, offenders: over > 0 ? await offenders(t) : [] }).toEqual({ over: 0, offenders: [] })
      })
    }

    it('assets sticky header keeps one height across every tab (all/upload/generation/cases/subjects/…)', async () => {
      const { page } = t
      await gotoMock(page, '/studio/assets')
      const bar = page.locator('section[aria-labelledby="assets-title"] div.sticky').first()
      const tabs = bar.getByRole('group', { name: '分组' }).getByRole('button')
      await tabs.first().waitFor()
      const names = (await tabs.allTextContents()).map(s => s.trim())
      expect(names.slice(0, 5)).toEqual(['全部', '我的上传', '生成结果', '收藏的案例', '主体'])
      const heights: Record<string, number> = {}
      for (const name of names) {
        await tabs.filter({ hasText: name }).first().click()
        await expect.poll(() => tabs.filter({ hasText: name }).first().getAttribute('aria-pressed')).toBe('true')
        await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 5000 }).catch(() => {})
        heights[name] = Math.round((await bar.boundingBox())!.height)
      }
      if (new Set(Object.values(heights)).size > 1) await shot(page, `assets-sticky-${viewport.width}`)
      expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1)
    })
  })
}
