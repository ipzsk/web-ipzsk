// Build src/studio/inspiration/data/cases.manifest.json from the old studio's curated catalog.
// No deps. Usage: node scripts/build-cases-manifest.mjs
//
// Source of truth for WHICH cases ship: image-studio/assets/catalog.json (what the old studio shows:
// 521 awesome-gpt-image-2 cases localized to Chinese + 40 Punk-Skill styles, with local 420px webp thumbs).
// Raw repos (cases.json ⊂ canghe-cases.json, punk-cases.json) are read for counts and Punk source links.
// Dimensions: original image headers (local file, or HTTP Range on the remote original), cached in scripts/.cache/.
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const rel = (p) => path.join(root, p)
const readJson = async (p) => JSON.parse(await fs.readFile(rel(p), 'utf8'))
const CACHE = rel('scripts/.cache/case-dims.json')
const OUT = rel('src/studio/inspiration/data/cases.manifest.json')

/** Parse width/height from PNG / JPEG / WebP / GIF bytes. Returns null when the header isn't in `b`. */
export function imageSize(b) {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  if (b.length >= 10 && b.toString('latin1', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') { const n = b.readUInt32LE(21); return { width: 1 + (n & 0x3fff), height: 1 + ((n >> 14) & 0x3fff) } }
    return null
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const m = b[i + 1]
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i++; continue }
      const len = b.readUInt16BE(i + 2)
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) }
      i += 2 + len
    }
  }
  return null
}

async function remoteSize(url) {
  for (const bytes of [65536, 1048576, 0]) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: bytes ? { Range: `bytes=0-${bytes - 1}` } : {}, signal: AbortSignal.timeout(30000) })
        if (!res.ok) throw Error(`HTTP ${res.status}`)
        const size = imageSize(Buffer.from(await res.arrayBuffer()))
        if (size) return size
        break // header not within this range → widen
      } catch (e) { if (attempt === 2) { console.warn('  fetch failed', url, e.message); return null } }
    }
  }
  return null
}

// catalog zh category → stable slug (matches the raw repo's English categories).
const CATEGORY_SLUG = {
  封面与海报: 'posters', 头像与人物: 'people', 信息图表: 'infographics', 电商与产品: 'ecommerce', 文档与出版: 'documents',
  插画与艺术: 'illustration', 场景与故事: 'scenes', 摄影与写实: 'photography', 品牌与标志: 'brand', 建筑与空间: 'architecture',
  界面设计: 'ui', 历史与古典: 'history', 其他创意: 'other',
}

// §2.8: ecommerce cases carry a multi-item template (the old studio's default product-set slots, ImageGenPanel PRODUCT_SET_SLOTS).
// ponytail: prompt per item = case prompt + 「label：description」, composed at 做同款 time to keep the manifest small.
const ECOMMERCE_TEMPLATE = {
  items: [
    { key: 'main', label: '主图', description: '干净背景，突出商品主体', count: 1, references: [{ slot: '商品图' }] },
    { key: 'selling-point', label: '卖点图', description: '用画面展示商品核心卖点', count: 2, references: [{ slot: '商品图' }] },
    { key: 'scene', label: '场景图', description: '真实生活或使用场景', count: 2, references: [{ slot: '商品图' }] },
    { key: 'detail', label: '细节图', description: '材质、结构或工艺特写', count: 1, references: [{ slot: '商品细节图' }] },
  ],
}

const RATIOS = [[1, 1], [2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4], [9, 16], [16, 9], [21, 9]]
const nearestRatio = (w, h) => RATIOS.reduce((best, r) => (Math.abs(Math.log((w / h) / (r[0] / r[1]))) < Math.abs(Math.log((w / h) / (best[0] / best[1]))) ? r : best)).join(':')

async function main() {
  const catalog = await readJson('image-studio/assets/catalog.json')
  const agi = await readJson('image-studio/vendor/src/templates/cases.json')
  const canghe = await readJson('image-studio/vendor/src/templates/canghe-cases.json')
  const punk = await readJson('image-studio/vendor/src/templates/punk-cases.json')

  const cangheIds = new Set(canghe.cases.map((c) => c.id))
  const rawUnion = new Set([...agi.cases.map((c) => c.id), ...cangheIds])
  const punkByTitle = new Map(punk.cases.map((c) => [c.title, c]))

  let cache = {}
  try { cache = JSON.parse(await fs.readFile(CACHE, 'utf8')) } catch {}

  const missing = []
  let next = 0
  const results = new Array(catalog.length)
  await Promise.all(Array.from({ length: 4 }, async () => { // concurrency ≤ 4
    while (next < catalog.length) {
      const i = next++
      const c = catalog[i]
      let size = cache[c.image]
      if (!size) {
        size = c.image.startsWith('/image-studio/')
          ? imageSize(await fs.readFile(rel(c.image.slice(1))))
          : await remoteSize(c.image)
        if (size) cache[c.image] = size
      }
      if (!size) { missing.push(c.id); continue }
      results[i] = { c, size }
    }
  }))
  await fs.mkdir(path.dirname(CACHE), { recursive: true })
  await fs.writeFile(CACHE, JSON.stringify(cache))

  const items = []
  for (const r of results) {
    if (!r) continue
    const { c, size } = r
    const isPunk = c.librarySource === 'punk'
    const raw = isPunk ? punkByTitle.get(c.title) ?? punk.cases.find((p) => p.title.startsWith(c.title)) : null
    const handle = !isPunk && /^@[\w.]+$/.test(c.sourceLabel) ? c.sourceLabel.slice(1) : null
    const category = CATEGORY_SLUG[c.categoryZh]
    if (!category) throw Error(`unknown category ${c.categoryZh} (case ${c.id})`)
    items.push({
      id: String(c.id),
      title: c.title,
      prompt: c.prompt,
      category,
      categoryZh: c.categoryZh,
      tags: [...new Set([...(c.styles ?? []), ...(c.scenes ?? [])])],
      model: 'gpt-image-2',
      params: { aspect_ratio: nearestRatio(size.width, size.height) },
      image: { url: c.thumbnail, orig: c.image, width: size.width, height: size.height },
      author: isPunk ? 'adrianpunk' : c.sourceLabel || null,
      author_url: isPunk ? 'https://github.com/adrianpunk' : handle && /x\.com|twitter\.com/.test(c.sourceUrl) ? `https://x.com/${handle}` : null,
      source_url: isPunk ? (raw?.sourceUrl ?? 'https://github.com/adrianpunk/Punk-Skill') : c.sourceUrl || c.githubUrl,
      source_repo: isPunk ? 'Punk-Skill' : 'awesome-gpt-image-2',
      license_note: isPunk
        ? `Punk-Skill (adrianpunk) · MIT · fetched ${punk.fetchedAt}`
        : `awesome-gpt-image-2 (freestylefly) · ${c.githubUrl} · fetched ${canghe.fetchedAt} · 第三方内容，版权归原作者`,
      ...(category === 'ecommerce' ? { template: ECOMMERCE_TEMPLATE } : {}),
    })
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await fs.writeFile(OUT, JSON.stringify(items))
  const stat = await fs.stat(OUT)
  const bySource = {}
  for (const x of items) bySource[x.source_repo] = (bySource[x.source_repo] ?? 0) + 1
  console.log(JSON.stringify({
    raw: { 'cases.json': agi.cases.length, 'canghe-cases.json': canghe.cases.length, awesomeUnionById: rawUnion.size, 'punk-cases.json': punk.cases.length },
    catalog: catalog.length,
    manifest: items.length, bySource,
    ecommerceTemplates: items.filter((x) => x.template).length,
    missingDims: missing,
    rawAwesomeNotInCatalog: [...rawUnion].filter((id) => !catalog.some((c) => c.librarySource === 'canghe' && c.originalId === id)).length,
    bytes: stat.size,
  }, null, 1))
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main()
