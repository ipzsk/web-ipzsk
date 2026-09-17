import { expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { e2eDescribe, gotoMock, shot, useBrowser } from './support'

/** Every control that writes, by accessible name (buttons, links acting as buttons, checkboxes, drag handles). */
const WRITE = /^(新建案例|发布|隐藏|隐藏（下架）|删除|删除草稿|保存|保存并发布|创建草稿|授予角色|撤销.*角色|重新同步|标记为已取消|拖动排序.*|选择 .*|全选|编辑)$/
// Whole body (drawers/dialogs are portalled outside <main>).
const writeControls = (page: Page) => page.evaluate(src => {
  const re = new RegExp(src)
  return [...document.body.querySelectorAll<HTMLElement>('button, a, [role="checkbox"], input[type="checkbox"]')]
    .map(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim())
    .filter(name => re.test(name))
}, WRITE.source)

async function openCases(page: Page, role: string) {
  await gotoMock(page, `/admin/cases?role=${role}`)
  await page.getByRole('heading', { name: '案例库' }).waitFor()
  await page.locator('tbody tr').first().waitFor()
}

e2eDescribe('admin (mock)', () => {
  const t = useBrowser()

  it('viewer has zero write controls (cases list, case detail, users, generation detail)', async () => {
    const { page } = t
    await openCases(page, 'viewer')
    expect(await writeControls(page)).toEqual([])
    await page.locator('tbody tr').first().getByRole('link', { name: '查看' }).click()
    await page.getByRole('heading', { name: '查看案例' }).waitFor()
    expect(await writeControls(page)).toEqual([])
    await page.getByRole('link', { name: '用户与角色' }).click()
    await page.getByRole('button', { name: 'user1@example.com' }).first().click()
    await page.getByText('用户 id').waitFor()
    expect(await writeControls(page)).toEqual([])
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: '生成记录' }).click()
    await page.getByRole('table', { name: '生成记录' }).waitFor()
    await page.getByRole('table', { name: '生成记录' }).getByRole('row').nth(1).click()
    await page.waitForURL(u => u.searchParams.has('id'))
    await page.getByText('upstream', { exact: false }).or(page.getByText('lanehub')).first().waitFor()
    expect(await writeControls(page)).toEqual([])
  })

  it('operator can write cases but cannot grant roles; admin can', async () => {
    const { page } = t
    await openCases(page, 'operator')
    expect(await writeControls(page)).toContain('新建案例')
    for (const [role, grant] of [['operator', false], ['admin', true]] as const) {
      await gotoMock(page, `/admin/users?role=${role}&q=user1%40example.com`)
      await page.getByRole('button', { name: 'user1@example.com' }).first().click()
      await page.getByText('用户 id').waitFor()
      await page.getByRole('heading', { name: '角色', exact: true }).waitFor()
      expect((await writeControls(page)).includes('授予角色')).toBe(grant)
    }
  })

  it('publish: validation errors first, then success after filling the fields', async () => {
    const { page } = t
    await openCases(page, 'admin')
    const draftRow = page.locator('tbody tr').filter({ hasText: '草稿' }).first()
    await draftRow.getByRole('link', { name: '编辑' }).click()
    await page.getByRole('heading', { name: '编辑案例' }).waitFor()
    await page.getByRole('button', { name: '保存并发布' }).click()
    const alert = page.locator('#issues')
    await alert.getByText(/还有 \d+ 项需要处理/).waitFor()
    expect(await alert.textContent()).toContain('授权说明')

    await page.getByRole('textbox', { name: '授权说明' }).fill('Punk-Skill (adrianpunk) · MIT · fetched 2026-09-07')
    await page.getByRole('textbox', { name: '来源仓库' }).fill('Punk-Skill')
    await page.getByRole('button', { name: '保存并发布' }).click()
    await page.getByRole('main').getByText('已发布').first().waitFor()
    await alert.waitFor({ state: 'detached' })
  })

  it('publish validation moves focus to the error summary on the first attempt', async () => {
    const { page } = t
    await openCases(page, 'admin')
    await page.locator('tbody tr').filter({ hasText: '草稿' }).first().getByRole('link', { name: '编辑' }).click()
    await page.getByRole('button', { name: '保存并发布' }).click()
    await page.locator('#issues').waitFor()
    await shot(page, 'admin-publish-issues-focus')
    await expect.poll(() => page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim()), { timeout: 2000 }).toBe('issues')
  })

  it('reorder rows with the keyboard (space, arrow, space)', async () => {
    const { page } = t
    await openCases(page, 'admin')
    const titles = () => page.locator('tbody tr td:nth-child(3) a').allTextContents()
    const [first, second] = await titles()
    const [, secondId] = (await page.locator('tbody tr td:nth-child(3) span').allTextContents()).map(x => x.match(/#(\S+)/)![1]!)
    // dnd-kit measures between key presses: wait on its live-region announcements instead of sleeping.
    const announced = (text: string) => page.waitForFunction(t => [...document.querySelectorAll('[aria-live]')].some(e => e.textContent?.includes(t)), text)
    await page.getByRole('button', { name: `拖动排序：${first}` }).focus()
    await page.keyboard.press('Space')
    await announced('droppable area')
    await page.keyboard.press('ArrowDown')
    await announced(`droppable area ${secondId}`)
    await page.keyboard.press('Space')
    await expect.poll(async () => (await titles()).slice(0, 2)).toEqual([second, first])
    // Persisted in the (in-memory) mock: survives the list refetch after settle.
    await page.getByRole('combobox', { name: '状态' }).selectOption('draft')
    await page.getByRole('combobox', { name: '状态' }).selectOption('')
    await expect.poll(async () => (await titles()).slice(0, 2)).toEqual([second, first])
  })
})
