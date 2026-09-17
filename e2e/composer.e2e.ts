import { beforeEach, expect, it } from 'vitest'
import { composer, e2eDescribe, gotoMock, mockSubmits, resetStorage, useBrowser } from './support'

e2eDescribe('composer (mock, signed in)', () => {
  const t = useBrowser()
  const editor = () => t.page.getByRole('textbox', { name: '提示词' })
  const queue = () => t.page.getByRole('region', { name: '待发送队列' })
  beforeEach(async () => {
    await resetStorage(t.page)
    await gotoMock(t.page, '/studio')
    await t.page.getByRole('button', { name: /^型号：/ }).waitFor() // catalog loaded
  })

  it('@ mention of a subject inserts a chip and its reference slots', async () => {
    const { page } = t
    await editor().click()
    await page.keyboard.type('一只@')
    const panel = page.getByRole('listbox', { name: '提及' })
    await panel.getByRole('option', { name: /橘猫阿福/ }).click()
    await editor().locator('[data-chip="subject"]').filter({ hasText: '@橘猫阿福' }).waitFor()
    await expect.poll(async () => (await composer(page)).slots.map(s => s.id)).toEqual(['mock-cat1', 'mock-cat2', 'mock-cat3'])
    expect(await page.getByRole('list', { name: '参考图' }).getByRole('listitem').count()).toBe(3)
  })

  it('multi-model 加入队列 highlights normalized params', async () => {
    const { page } = t
    await editor().click()
    await page.keyboard.type('极简产品图')
    await page.getByRole('button', { name: /^型号：/ }).click()
    await page.getByRole('checkbox', { name: '多选 GPT Image 2', exact: true }).click()
    await page.getByRole('checkbox', { name: '多选 Z-Image Turbo' }).click()
    await page.getByRole('button', { name: '加入队列 (2)' }).click()
    await queue().getByText('待发送队列 · 2 项').waitFor()
    // GPT Image 2 defaults to 2K; Z-Image Turbo only has 1K → normalized and highlighted.
    const changed = queue().locator('[title="该型号不支持原取值，已改为默认值"]')
    await changed.first().waitFor()
    expect(await changed.allTextContents()).toEqual(['2K→1K'])
    const q = (await composer(page)).queue
    expect(q.map(i => i.model)).toEqual(['gpt-image-2', 'z-image-turbo'])
  })

  it('全部发送 → create view shows placeholders, then results', async () => {
    const { page } = t
    await editor().click()
    await page.keyboard.type('雨夜霓虹街头')
    await page.getByRole('button', { name: /^型号：/ }).click()
    await page.getByRole('checkbox', { name: '多选 GPT Image 2', exact: true }).click()
    await page.getByRole('checkbox', { name: '多选 Z-Image Turbo' }).click()
    await page.getByRole('button', { name: '加入队列 (2)' }).click()
    await queue().getByRole('button', { name: '全部发送' }).click()
    await page.getByText('已提交 2 项').first().waitFor()
    await expect.poll(async () => (await mockSubmits(page)).length).toBe(2)
    const sent = await mockSubmits(page)
    expect(sent.every(s => s.body.batch_id && s.body.batch_id === sent[0]!.body.batch_id)).toBe(true)

    await page.getByRole('complementary', { name: '工作台' }).getByRole('link', { name: '创作' }).click()
    const result = page.getByRole('article', { name: '结果' }).last()
    await result.getByText(/2 项 · 完成 0/).waitFor()
    await result.getByRole('img', { name: /GPT Image 2 结果 1|gpt-image-2 结果 1/ }).waitFor({ timeout: 30_000 })
    await result.getByRole('img', { name: /z-image-turbo 结果 1/ }).waitFor({ timeout: 30_000 })
    await result.getByText(/2 项 · 完成 2/).waitFor()
  })

  it('Enter inserts a newline; Cmd/Ctrl+Enter submits', async () => {
    const { page } = t
    await editor().click()
    await page.keyboard.type('第一行')
    await page.keyboard.press('Enter')
    await page.keyboard.type('第二行')
    expect((await composer(page)).text).toBe('第一行\n第二行')
    expect(await mockSubmits(page)).toHaveLength(0)
    await page.keyboard.press('ControlOrMeta+Enter')
    await page.getByText('已提交 1 项').first().waitFor()
    await expect.poll(async () => (await mockSubmits(page)).length).toBe(1)
    expect((await mockSubmits(page))[0]!.body.prompt).toBe('第一行\n第二行')
    expect((await composer(page)).text).toBe('')
  })
})

e2eDescribe('composer (signed out)', () => {
  const t = useBrowser({ mock: false })

  it('发送 goes to /account?next=… and fires no generation request', async () => {
    const { page } = t
    await gotoMock(page, '/studio', { mock: false })
    await page.getByRole('link', { name: '登录 / 注册' }).waitFor()
    await page.getByRole('textbox', { name: '提示词' }).click()
    await page.keyboard.type('一只橘猫')
    await page.getByRole('button', { name: '登录后生成' }).click()
    await page.waitForURL(u => u.pathname === '/account' && u.searchParams.get('next') === '/studio')
    // (GET /api/me/generations?status=active is polled even when anonymous and gets 401 — reads only, tolerated.)
    expect(t.apiCalls.filter(c => c.method !== 'GET')).toEqual([])
  })
})
