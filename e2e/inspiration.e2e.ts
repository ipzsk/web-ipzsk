import { beforeEach, expect, it } from 'vitest'
import { composer, e2eDescribe, shot, gotoMock, resetStorage, useBrowser } from './support'

const search = (url: string) => Object.fromEntries(new URL(url).searchParams)

e2eDescribe('inspiration', () => {
  const t = useBrowser()
  const cards = () => t.page.getByRole('list', { name: '灵感案例' }).locator('[data-case-id]')
  beforeEach(async () => {
    await resetStorage(t.page)
    await gotoMock(t.page, '/studio')
    await cards().first().waitFor()
  })

  it('category + search sync to the URL and follow back/forward', async () => {
    const { page } = t
    await page.getByRole('group', { name: '分类' }).getByRole('button', { name: /^电商与产品/ }).click()
    await page.waitForURL(u => u.searchParams.get('cat') === 'ecommerce')
    await expect.poll(() => cards().count()).toBeGreaterThan(0)

    await page.getByRole('searchbox', { name: '搜索案例' }).fill('香水')
    await page.waitForURL(u => u.searchParams.get('q') === '香水')
    // Wait for the searched feed to render (the unfiltered ecommerce feed also contains this case, so check the size).
    // Going back before this render leaves the input stale — see report (race, not user-speed).
    await expect.poll(() => cards().count()).toBeLessThan(10)
    expect(await cards().filter({ hasText: '薄荷玫瑰香水电商图' }).count()).toBe(1)

    await page.goBack()
    await page.waitForURL(u => !u.searchParams.has('q') && u.searchParams.get('cat') === 'ecommerce')
    await expect.poll(() => page.getByRole('searchbox', { name: '搜索案例' }).inputValue()).toBe('')
    await page.goBack()
    await page.waitForURL(u => !u.searchParams.has('cat'))
    await expect.poll(() => page.getByRole('button', { name: /^全部/ }).getAttribute('aria-pressed')).toBe('true')
    await page.goForward()
    await page.waitForURL(u => u.searchParams.get('cat') === 'ecommerce')
    await expect.poll(() => page.getByRole('button', { name: /^电商与产品/ }).getAttribute('aria-pressed')).toBe('true')
    expect(search(page.url()).mock).toBe('1')
  })

  it('open detail → close restores scroll (±50px) and focus on the card', async () => {
    const { page } = t
    await page.evaluate(() => window.scrollTo(0, 1600))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
    // A card whose top-left is well inside the viewport (above the composer), so clicking it does not scroll.
    const pick = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-case-id]')].find(el => {
      const r = el.getBoundingClientRect(); return r.top > 150 && r.top < innerHeight - 350
    })?.dataset.caseId)
    await expect.poll(pick).toBeTruthy() // the masonry renders the scrolled window a frame or two later
    const id = (await pick())!
    const before = await page.evaluate(() => window.scrollY)
    await page.locator(`[data-case-id="${id}"] [role="group"][tabindex="0"]`).first().click({ position: { x: 20, y: 20 } })
    await page.getByRole('dialog').waitFor()
    await page.waitForURL(u => u.searchParams.get('case') === id)
    await page.getByRole('dialog').getByRole('button', { name: '做同款' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    await page.waitForURL(u => !u.searchParams.has('case'))
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThanOrEqual(50)
    await shot(page, 'inspiration-close-focus')
    const focused = () => page.evaluate(() => document.activeElement?.closest<HTMLElement>('[data-case-id]')?.dataset.caseId ?? document.activeElement?.tagName)
    await expect.poll(focused).toBe(id)
  })

  it('做同款 on a single case fills the composer prompt', async () => {
    const { page } = t
    await gotoMock(page, '/studio?q=' + encodeURIComponent('黑白极简概念'))
    const card = cards().filter({ hasText: '黑白极简概念' }).first()
    await card.hover()
    await card.getByRole('button', { name: '做同款' }).click()
    await page.getByText('已填入输入框').first().waitFor()
    await expect.poll(async () => (await composer(page)).text.length).toBeGreaterThan(10)
    const editor = page.getByRole('textbox', { name: '提示词' })
    const squash = (x: string) => x.replace(/\s/g, '').slice(0, 20)
    expect(squash((await editor.textContent())!)).toBe(squash((await composer(page)).text))
    expect((await composer(page)).queue).toEqual([])
  })

  it('电商 template case expands into the queue with anchor references', async () => {
    const { page } = t
    await gotoMock(page, '/studio?cat=ecommerce&q=' + encodeURIComponent('薄荷玫瑰香水电商图'))
    const card = cards().filter({ hasText: '薄荷玫瑰香水电商图' }).first()
    await card.hover()
    await card.getByRole('button', { name: '做同款' }).click()
    const queue = page.getByRole('region', { name: '待发送队列' })
    await queue.getByText(/待发送队列 · 4 项/).waitFor()
    const q = (await composer(page)).queue
    expect(q).toHaveLength(4)
    expect(q[0]!.anchor_of).toBeNull()
    expect(q.slice(1).every(i => i.anchor_of === q[0]!.item_id)).toBe(true)
    expect(await queue.getByText('引用①').count()).toBe(3)
  })
})
