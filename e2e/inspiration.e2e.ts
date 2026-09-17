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

    await page.getByRole('combobox', { name: '搜索案例' }).fill('香水')
    await page.waitForURL(u => u.searchParams.get('q') === '香水')
    // Wait for the searched feed to render (the unfiltered ecommerce feed also contains this case, so check the size).
    // Going back before this render leaves the input stale — see report (race, not user-speed).
    await expect.poll(() => cards().count()).toBeLessThan(10)
    expect(await cards().filter({ hasText: '薄荷玫瑰香水电商图' }).count()).toBe(1)

    await page.goBack()
    await page.waitForURL(u => !u.searchParams.has('q') && u.searchParams.get('cat') === 'ecommerce')
    await expect.poll(() => page.getByRole('combobox', { name: '搜索案例' }).inputValue()).toBe('')
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
  it('header 图片/视频/数字人 switch the composer kind; video/数字人 show an empty library without fetching', async () => {
    const { page } = t
    const nav = page.getByRole('navigation', { name: '主导航' })
    expect(await nav.getByRole('link', { name: '图片', exact: true }).getAttribute('aria-current')).toBe('page')
    await nav.getByRole('link', { name: '视频', exact: true }).click()
    await page.getByText('暂无视频案例', { exact: false }).waitFor()
    await page.waitForURL(u => u.searchParams.get('kind') === 'video')
    expect(await nav.getByRole('link', { name: '视频', exact: true }).getAttribute('aria-current')).toBe('page')
    expect(await page.getByRole('radio', { name: '视频' }).getAttribute('aria-checked')).toBe('true')
    expect(await cards().count()).toBe(0)
    // The composer's own switch drives the header and the library too.
    await page.getByRole('radio', { name: '数字人' }).click()
    await page.getByText('暂无数字人案例', { exact: false }).waitFor()
    expect(await nav.getByRole('link', { name: '数字人', exact: true }).getAttribute('aria-current')).toBe('page')
    await page.getByRole('button', { name: '看看图片案例' }).click()
    await cards().first().waitFor()
    expect(await nav.getByRole('link', { name: '图片', exact: true }).getAttribute('aria-current')).toBe('page')

    await gotoMock(page, '/studio?kind=avatar')
    await page.getByText('暂无数字人案例', { exact: false }).waitFor()
    expect(await nav.getByRole('link', { name: '数字人', exact: true }).getAttribute('aria-current')).toBe('page')
  })

  it('search combobox: recent searches + multi-select categories synced with the chips (cat=a,b)', async () => {
    const { page } = t
    const box = page.getByRole('combobox', { name: '搜索案例' })
    const chip = (name: RegExp) => page.getByRole('group', { name: '分类' }).getByRole('button', { name })
    await box.fill('香水')
    await box.press('Enter')
    await page.waitForURL(u => u.searchParams.get('q') === '香水')
    await box.fill('')
    await page.waitForURL(u => !u.searchParams.has('q'))
    await box.press('ArrowDown')
    await page.getByRole('listbox', { name: '最近搜索' }).getByRole('option', { name: '香水' }).waitFor()
    expect(await box.getAttribute('aria-expanded')).toBe('true')
    expect(await page.getByRole('listbox', { name: /^分类/ }).getAttribute('aria-multiselectable')).toBe('true')
    // Row 0 = recent 「香水」, rows 1.. = categories; select two with the keyboard.
    await box.press('ArrowDown')
    await box.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('cat')?.split(',').length).toBe(1)
    await box.press('ArrowDown')
    await box.press('Enter')
    await expect.poll(() => new URL(page.url()).searchParams.get('cat')?.split(',').length).toBe(2)
    const cats = new URL(page.url()).searchParams.get('cat')!.split(',')
    const active = await page.evaluate(() => document.querySelector('[role=combobox]')!.getAttribute('aria-activedescendant'))
    await expect.poll(() => page.locator(`[id="${active}"]`).getAttribute('aria-selected')).toBe('true')
    await expect.poll(() => page.getByRole('group', { name: '分类' }).getByRole('button', { pressed: true }).count()).toBe(2)
    await expect.poll(() => cards().count()).toBeGreaterThan(0)
    await box.press('Escape')
    expect(await box.getAttribute('aria-expanded')).toBe('false')
    // Backspace on the empty input removes the last selected category.
    await box.press('Backspace')
    await page.waitForURL(u => u.searchParams.get('cat') === cats[0])
    // Chips add to the selection; 全部 clears.
    await chip(/^电商与产品/).click()
    await page.waitForURL(u => (u.searchParams.get('cat') ?? '').split(',').length === (cats[0] === 'ecommerce' ? 0 : 2))
    await chip(/^全部/).click()
    await page.waitForURL(u => !u.searchParams.has('cat'))
    await expect.poll(() => page.getByRole('button', { name: /^移除「/ }).count()).toBe(0)
  })

  it('category row shows chevrons only on the overflowing side and pages with them', async () => {
    const { page } = t
    const left = page.getByRole('button', { name: '向左滚动分类' })
    const right = page.getByRole('button', { name: '向右滚动分类' })
    await page.setViewportSize({ width: 1024, height: 800 })
    try {
      await right.waitFor()
      expect(await left.count()).toBe(0)
      await right.click()
      await left.waitFor()
      const row = page.getByRole('group', { name: '分类' })
      const x = await row.evaluate(el => el.scrollLeft)
      expect(x).toBeGreaterThan(0)
      // Vertical wheel over the row scrolls it sideways while it can.
      await row.hover()
      await page.mouse.wheel(0, -2000)
      await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBe(0)
      await expect.poll(() => left.count()).toBe(0)
      await shot(page, 'inspiration-chevrons')
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
    }
  })
})
