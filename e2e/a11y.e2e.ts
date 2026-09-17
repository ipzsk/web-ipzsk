import { beforeEach, expect, it } from 'vitest'
import { axe, e2eDescribe, gotoMock, resetStorage, useBrowser } from './support'

// axe-core serious/critical must be zero. Pages are measured after their data has rendered (no skeletons).
const PAGES: { path: string; ready: string; exclude?: string[] }[] = [
  { path: '/studio', ready: '[data-case-id]' },
  { path: '/studio/create', ready: 'main button' },
  { path: '/studio/assets', ready: '[data-asset-id]' },
  { path: '/studio/subjects', ready: 'main h1, main h2' },
  { path: '/admin', ready: 'tbody tr' },
  // Known exception: the states demo draws a static *disabled* menu item (src/ui/states-page.tsx, div[data-disabled], no native
  // disabled attribute), which axe still contrast-checks. Disabled controls are exempt from WCAG 1.4.3.
  { path: '/studio/_states', ready: 'main h1', exclude: ['main div[data-disabled]'] },
]

e2eDescribe('a11y (axe serious/critical)', () => {
  const t = useBrowser()
  beforeEach(() => resetStorage(t.page))

  for (const { path, ready, exclude } of PAGES) {
    it(path, async () => {
      await gotoMock(t.page, path)
      await t.page.locator(ready).first().waitFor()
      await t.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 10_000 }).catch(() => {})
      expect(await axe(t.page, { exclude })).toEqual([])
    })
  }
})
