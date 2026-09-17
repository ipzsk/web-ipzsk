import { beforeAll, expect, it } from 'vitest'
import type { Locator, Page } from 'playwright-core'
import { e2eDescribe, gotoMock, useBrowser } from './support'

// Steps build on one project (fresh context for the file).
async function drag(page: Page, from: Locator, to: Locator | { x: number; y: number }, steps = 10) {
  const a = (await from.boundingBox())!
  const b = 'x' in to ? { x: to.x, y: to.y, width: 0, height: 0 } : (await to.boundingBox())!
  const [x0, y0, x1, y1] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2]
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
  await page.mouse.up()
}

e2eDescribe('canvas (mock)', () => {
  const t = useBrowser()
  const nodes = (type?: string) => t.page.locator(type ? `.react-flow__node-${type}` : '.react-flow__node')
  const edges = () => t.page.locator('.react-flow__edge')
  const toast = (text: string) => t.page.locator('[role="status"], li, [data-sonner-toast]').filter({ hasText: text }).first()
  const addNode = async (label: string) => {
    await t.page.getByRole('button', { name: '添加节点' }).first().click()
    await t.page.getByRole('listbox', { name: '节点类型' }).getByRole('button', { name: new RegExp(`^${label}`) }).click()
  }
  let projectUrl = ''

  beforeAll(async () => { await gotoMock(t.page, '/studio/canvas') })

  it('create a project and add nodes', async () => {
    const { page } = t
    await page.getByRole('button', { name: '新建画布' }).first().click()
    await page.waitForURL(u => /^\/studio\/canvas\/[^/]+$/.test(u.pathname))
    projectUrl = page.url()
    await addNode('文本')
    await nodes('text').waitFor()
    // Move the text node aside so the next node (also added at the centre) doesn't cover it.
    await drag(page, nodes('text'), { x: (await nodes('text').boundingBox())!.x - 260, y: (await nodes('text').boundingBox())!.y + 70 })
    await page.getByRole('textbox', { name: '文本内容' }).fill('一只橘猫戴着宇航员头盔')
    await addNode('生成·图片')
    await nodes('gen-image').waitFor()
    expect(await nodes().count()).toBe(2)
  })

  it('invalid connection is refused with a reason; a valid one creates an edge', async () => {
    const { page } = t
    const out = nodes('text').getByLabel('文本输出')
    await drag(page, out, nodes('gen-image').getByLabel('图片输入'))
    await toast('文本输出不能接到图片输入').waitFor()
    expect(await edges().count()).toBe(0)
    await drag(page, out, nodes('gen-image').getByLabel('文本输入'))
    await expect.poll(() => edges().count()).toBe(1)
  })

  it('run (mock) fills the generation node with results', async () => {
    const { page } = t
    const run = nodes('gen-image').getByRole('button', { name: '运行' })
    await expect.poll(() => run.isEnabled()).toBe(true)
    await run.click()
    await nodes('gen-image').getByText(/· \d+ 张$/).waitFor({ timeout: 30_000 })
    await nodes('gen-image').getByRole('img', { name: '主结果' }).waitFor()
    void page
  })

  it('group, undo, redo', async () => {
    const { page } = t
    await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } })
    await page.keyboard.press('ControlOrMeta+A')
    await page.getByRole('button', { name: /^编组/ }).click()
    await nodes('group').waitFor()
    await page.getByRole('button', { name: /^撤销/ }).click()
    await nodes('group').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: /^重做/ }).click()
    await nodes('group').waitFor()
  })

  it('reload keeps nodes, edge, group and results', async () => {
    const { page } = t
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor({ timeout: 15_000 })
    await page.reload()
    await nodes('gen-image').waitFor({ timeout: 15_000 })
    expect(await nodes('text').count()).toBe(1)
    expect(await nodes('group').count()).toBe(1)
    await expect.poll(() => edges().count()).toBe(1)
    await nodes('gen-image').getByRole('img', { name: '主结果' }).waitFor()
    expect(await page.getByRole('textbox', { name: '文本内容' }).inputValue()).toBe('一只橘猫戴着宇航员头盔')
  })

  it('放到画布 from the inspiration detail adds nodes to a chosen project', async () => {
    const { page } = t
    await gotoMock(page, '/studio?q=' + encodeURIComponent('黑白极简概念'))
    await page.locator('[data-case-id] [role="group"][tabindex="0"]').first().click({ position: { x: 20, y: 20 } })
    await page.getByRole('dialog').getByRole('button', { name: '放到画布' }).click()
    const pick = page.getByRole('dialog', { name: '放到哪个画布' })
    await pick.getByRole('button', { name: /个节点/ }).first().click() // the existing project, not 「新建画布」
    await page.getByText(/^已放到「/).first().waitFor()
    await page.goto(projectUrl)
    await nodes('gen-image').waitFor({ timeout: 15_000 })
    // Count in the store: onlyRenderVisibleElements may keep off-screen nodes out of the DOM.
    const kinds = () => page.evaluate(() => (window as unknown as { __ipzskCanvas: { useCanvas: { getState: () => { nodes: { type: string }[] } } } })
      .__ipzskCanvas.useCanvas.getState().nodes.map(n => n.type).sort())
    await expect.poll(kinds).toEqual(['gen-image', 'group', 'image', 'text', 'text'])
  })
})
