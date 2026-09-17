import { beforeAll, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { composer, e2eDescribe, gotoMock, mockSubmits, shot, useBrowser } from './support'

// Tests in this file build on each other (one fresh context, records created once) — mock generations take 3–8s each.
const MODELS = ['GPT Image 2', 'GPT Image 2.5 Flare', 'Z-Image Turbo']

async function send(page: Page, prompt: string, models: string[] = []) {
  await page.getByRole('textbox', { name: '提示词' }).click()
  await page.keyboard.type(prompt)
  if (models.length < 2) { await page.keyboard.press('ControlOrMeta+Enter'); return }
  await page.getByRole('button', { name: /^型号：/ }).click()
  for (const m of models) await page.getByRole('checkbox', { name: `多选 ${m}`, exact: true }).click()
  await page.getByRole('button', { name: `加入队列 (${models.length})` }).click()
  await page.getByRole('region', { name: '待发送队列' }).getByRole('button', { name: '全部发送' }).click()
}

const labels = (page: Page, section: number) => page.getByRole('region', { name: '生成记录' }).nth(section)
  .getByRole('article', { name: '结果' }).locator('span.font-semibold').allTextContents()

e2eDescribe('create view', () => {
  const t = useBrowser()
  const sections = () => t.page.getByRole('region', { name: '生成记录' })

  beforeAll(async () => {
    await gotoMock(t.page, '/studio/create')
    await t.page.getByRole('button', { name: /^型号：/ }).waitFor()
  })

  it('batch bubbles: chronological, items in batch position order while pending and when done', async () => {
    const { page } = t
    await send(page, '单张：青柠气泡水')
    await sections().first().waitFor()
    await send(page, '三型号对比：橘猫宇航员', MODELS)
    await expect.poll(() => sections().count()).toBe(2)
    expect(await sections().first().getByRole('article', { name: '请求' }).textContent()).toContain('单张：青柠气泡水')
    const expected = MODELS.map((m, i) => `${String.fromCharCode(0x2460 + i)} ${m}`)
    await expect.poll(() => labels(page, 1)).toEqual(expected)
    await sections().nth(1).getByText('3 项 · 完成 3').waitFor({ timeout: 30_000 })
    expect(await labels(page, 1)).toEqual(expected)
    const sent = await mockSubmits(page)
    expect(sent.slice(1).map(s => s.body.batch_position)).toEqual([0, 1, 2])
  })

  it('以此为参考 puts the result asset id (not a URL) into the slots', async () => {
    const { page } = t
    const tile = sections().first().getByRole('article', { name: '结果' }).locator('figure').first()
    await tile.waitFor({ timeout: 30_000 })
    await tile.hover()
    await tile.getByRole('button', { name: '以此为参考' }).click()
    await expect.poll(async () => (await composer(page)).slots.length).toBe(1)
    const [slot] = (await composer(page)).slots
    expect(slot!.url_only).toBe(false)
    expect(slot!.id).not.toMatch(/^(url:|https?:)/)
    expect(slot!.id).toMatch(/-r0$/) // mock result asset id: <record id>-r<index>
  })

  it('再生成 sends parent_record_id and a null batch_id', async () => {
    const { page } = t
    const before = (await mockSubmits(page)).length
    const tile = sections().first().getByRole('article', { name: '结果' }).locator('figure').first()
    await tile.hover()
    await tile.getByRole('button', { name: '再生成' }).click()
    await expect.poll(async () => (await mockSubmits(page)).length).toBe(before + 1)
    const body = (await mockSubmits(page)).at(-1)!.body
    expect(body.batch_id).toBeNull()
    expect(body.batch_position).toBeNull()
    expect(body.parent_record_id).toBeTruthy()
    expect(body.prompt).toBe('单张：青柠气泡水')
    await expect.poll(() => sections().count()).toBe(3)
  })

  it('delete of a result sent in this session hides it (no pending placeholder comes back)', async () => {
    const { page } = t
    const first = sections().first()
    await first.getByRole('article', { name: '结果' }).getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '撤销' }).waitFor()
    await shot(page, 'create-delete-same-session')
    const count = await sections().count()
    await page.getByRole('button', { name: '撤销' }).click() // leave the data as it was for the next tests
    expect(count).toBe(2)
  })

  it('refresh restores records and results', async () => {
    const { page } = t
    await sections().nth(2).getByRole('article', { name: '结果' }).locator('figure').first().waitFor({ timeout: 30_000 })
    const url = page.url()
    await page.reload()
    expect(page.url()).toBe(url)
    await expect.poll(() => sections().count(), { timeout: 15_000 }).toBe(3)
    await sections().nth(1).getByText('3 项 · 完成 3').waitFor()
    expect(await labels(page, 1)).toEqual(MODELS.map((m, i) => `${String.fromCharCode(0x2460 + i)} ${m}`))
    expect(await sections().locator('figure').count()).toBeGreaterThanOrEqual(5)
  })

  it('after reload: delete hides the bubble; 撤销 brings it back', async () => {
    const { page } = t
    const first = sections().first()
    await first.getByRole('article', { name: '结果' }).getByRole('button', { name: '删除', exact: true }).click()
    await expect.poll(() => sections().count()).toBe(2)
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => sections().count()).toBe(3)
    expect(await sections().first().textContent()).toContain('单张：青柠气泡水')
  })
})
