import { beforeEach, expect, it } from 'vitest'
import { PNG, e2eDescribe, gotoMock, resetStorage, useBrowser } from './support'

e2eDescribe('assets view (mock)', () => {
  const t = useBrowser()
  const grid = () => t.page.getByRole('list', { name: '素材' })
  const cards = () => grid().locator('[data-asset-id]')
  const folders = () => t.page.getByRole('complementary').getByRole('navigation', { name: '素材文件夹' })
  const folderCount = (name: string) => folders().getByRole('link', { name: new RegExp(name) }).locator('[aria-label$=" 项"]').getAttribute('aria-label')

  beforeEach(async () => {
    await resetStorage(t.page)
    await gotoMock(t.page, '/studio/assets')
    await cards().first().waitFor()
  })

  it('upload via file input shows progress, then the ready asset', async () => {
    const { page } = t
    // Record every upload status the cell goes through (fast mock → states may flip within a frame).
    await page.evaluate(() => {
      const seen = ((window as unknown as { __seen: string[] }).__seen = [])
      new MutationObserver(() => document.querySelectorAll('[data-upload-status]').forEach(el => {
        const s = el.getAttribute('data-upload-status')!
        if (seen.at(-1) !== s) seen.push(s)
      })).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-upload-status'] })
    })
    const firstBefore = await cards().first().getAttribute('data-asset-id')
    const file = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]) // big enough for XHR progress events
    await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({ name: 'e2e-upload.png', mimeType: 'image/png', buffer: file })
    await grid().locator('[data-upload-status]').first().waitFor()
    await grid().locator('[data-upload-status]').first().waitFor({ state: 'detached', timeout: 20_000 })
    await expect.poll(() => cards().first().getAttribute('data-asset-id')).not.toBe(firstBefore)
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)
    expect(seen[0]).toBe('uploading')
    expect(seen).toContain('processing')
    expect(seen).not.toContain('failed')
    // Newest first: the uploaded asset leads the grid, labelled as an upload.
    expect(await cards().first().getByRole('group').first().getAttribute('aria-label')).toMatch(/^上传 · /)
  })

  it('create folder', async () => {
    const { page } = t
    await folders().getByRole('button', { name: '新建文件夹' }).first().click()
    await page.getByRole('textbox', { name: '文件夹名称' }).fill('E2E 文件夹')
    await page.keyboard.press('Enter')
    const link = folders().getByRole('link', { name: /E2E 文件夹/ })
    await link.waitFor()
    await expect.poll(() => link.getAttribute('aria-disabled')).toBeNull() // temp id replaced by the server id
    await link.click()
    await page.waitForURL(u => /\/studio\/assets\/[^/]+$/.test(u.pathname))
    await page.getByRole('heading', { name: 'E2E 文件夹' }).waitFor()
  })

  it('drag a card into a folder (pointer)', async () => {
    const { page } = t
    expect(await folderCount('人像参考')).toBe('3 项')
    const card = cards().first().getByRole('group').first()
    const target = folders().getByRole('link', { name: /人像参考/ })
    const from = (await card.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(from.x + from.width / 2 + ((to.x + 40 - from.x - from.width / 2) * i) / 12, from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * i) / 12)
    }
    await page.mouse.up()
    await expect.poll(() => folderCount('人像参考')).toBe('4 项')
  })

  it('delete with undo', async () => {
    const { page } = t
    const id = await cards().first().getAttribute('data-asset-id')
    await cards().first().hover()
    await cards().first().getByRole('button', { name: '删除', exact: true }).click()
    await page.locator(`[data-asset-id="${id}"]`).waitFor({ state: 'detached' })
    await page.getByRole('button', { name: '撤销' }).click()
    await page.locator(`[data-asset-id="${id}"]`).waitFor()
  })

  it('lightbox deep link survives reload and closes back to the grid', async () => {
    const { page } = t
    const id = (await cards().nth(1).getAttribute('data-asset-id'))!
    await cards().nth(1).getByRole('group').first().click() // centre: top-left is the select checkbox
    await page.waitForURL(u => u.searchParams.get('asset') === id)
    const lightbox = page.getByRole('dialog', { name: '媒体预览' })
    await lightbox.waitFor()
    await page.reload()
    await lightbox.waitFor()
    expect(new URL(page.url()).searchParams.get('asset')).toBe(id)
    await page.keyboard.press('Escape')
    await page.waitForURL(u => !u.searchParams.has('asset'))
    await lightbox.waitFor({ state: 'detached' })
  })
})
