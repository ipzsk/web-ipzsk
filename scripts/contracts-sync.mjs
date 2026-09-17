#!/usr/bin/env node
// Shared API contracts with ipzsk-api-gateway (docs/studio-redesign.md §10.2 / §11).
//
//   npm run contracts:sync   copy ../ipzsk-api-gateway/contracts/{endpoints.json,ipzsk-api.d.ts}
//                            into src/shared/contracts/generated/ (override with --from <gateway dir>)
//   npm run contracts:check  scan src/**/*.{ts,tsx} for API paths; fail on any (method, path) missing
//                            from generated/endpoints.json; warn on error codes the gateway never emits.
//
// Silence a known false positive with `// contracts-ignore: reason` on the same or the previous line.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// String input only: under vitest's jsdom env the global URL is jsdom's, which node:url rejects.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GENERATED = join(ROOT, 'src/shared/contracts/generated')
const FILES = ['endpoints.json', 'ipzsk-api.d.ts']
// Codes produced by the website itself, not the gateway.
const CLIENT_CODES = new Set(['network_error'])

// ── sync ──
export function sync(from) {
  const src = join(from, 'contracts')
  const missing = FILES.filter((f) => !existsSync(join(src, f)))
  if (missing.length) throw new Error(`missing ${missing.map((f) => join(src, f)).join(', ')} — run \`npm run contracts\` in the gateway first`)
  const git = (...args) => execFileSync('git', ['-C', from, ...args], { encoding: 'utf8' }).trim()
  let commit = 'unknown'
  try { commit = git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '-dirty' : '') } catch { /* not a git checkout */ }
  mkdirSync(GENERATED, { recursive: true })
  const json = JSON.parse(readFileSync(join(src, 'endpoints.json'), 'utf8'))
  writeFileSync(join(GENERATED, 'endpoints.json'), JSON.stringify({ _source: { repo: 'ipzsk-api-gateway', commit }, ...json }, null, 2) + '\n')
  writeFileSync(join(GENERATED, 'ipzsk-api.d.ts'),
    `// Synced from ipzsk-api-gateway@${commit} by scripts/contracts-sync.mjs. Do not edit; re-run \`npm run contracts:sync\`.\n`
    + readFileSync(join(src, 'ipzsk-api.d.ts'), 'utf8'))
  return commit
}

// ── source scanning ──
// `/cases${qs(q)}` (param glued to a segment) is a query string and is dropped by normalise().
// Tokenises TS just enough to find string/template literals outside comments. Template `${…}` becomes `:param`.
export function literals(text) {
  const out = []
  let i = 0, line = 1
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '\n') { line++; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { if (text[i] === '\n') line++; i++ } i += 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      const start = i, startLine = line
      let value = ''
      i++
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { value += text[i + 1]; i += 2; continue }
        if (c === '`' && text[i] === '$' && text[i + 1] === '{') {
          let depth = 1
          i += 2
          while (i < n && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; if (text[i] === '\n') line++; i++ }
          value += ':param'
          continue
        }
        if (text[i] === '\n') { if (c !== '`') break; line++ }
        value += text[i]
        i++
      }
      i++
      out.push({ value, start, end: i, line: startLine })
      continue
    }
    i++
  }
  return out
}

const normalise = (path) => path.split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').map((s) => (s.startsWith(':') ? ':param' : s.replace(/:param$/, '').includes(':param') ? ':param' : s.replace(/:param$/, ''))).join('/')

function callWindow(text, from) {
  let depth = 1, i = from
  for (; i < text.length && i - from < 800 && depth > 0; i++) {
    if ('([{'.includes(text[i])) depth++
    else if (')]}'.includes(text[i])) depth--
  }
  return text.slice(from, i)
}

export function scanApiCalls(file, text) {
  const lines = text.split('\n')
  const calls = []
  for (const lit of literals(text)) {
    if (!/^\/(api|v1)\//.test(lit.value)) continue
    if ([lines[lit.line - 1], lines[lit.line - 2]].some((l) => l?.includes('contracts-ignore'))) continue
    let path = lit.value
    if (/^\s*\+/.test(text.slice(lit.end, lit.end + 20)) && path.endsWith('/')) path += ':param'
    const before = text.slice(Math.max(0, lit.start - 200), lit.start)
    const after = callWindow(text, lit.end)
    let methods = []
    const positional = /['"](GET|POST|PUT|PATCH|DELETE)['"]\s*,\s*$/.exec(before)
    const option = /\bmethod\s*:\s*([^,}]+)/.exec(after)
    if (positional) methods = [positional[1]]
    else if (option) methods = [...option[1].matchAll(/['"](GET|POST|PUT|PATCH|DELETE)['"]/g)].map((m) => m[1])
    else if (/\b(request|fetch)\s*(<[\s\S]*>)?\(\s*$/.test(before)) methods = /\bbody\s*:/.test(after) || /^\s*,\s*\{\s*body\b/.test(after) ? ['POST'] : ['GET']
    calls.push({ file, line: lit.line, path: normalise(path), raw: lit.value, methods })
  }
  return calls
}

export function scanErrorCodes(file, text) {
  const lines = text.split('\n')
  const found = []
  lines.forEach((l, idx) => {
    if (l.includes('contracts-ignore')) return
    // Chinese message maps: `some_code: '中文…'` (snake_case keys only, to skip label maps like `person: '人物'`).
    for (const m of l.matchAll(/(?:^|[{,\s])['"]?([a-z][a-z0-9]*_[a-z0-9_]+)['"]?\s*:\s*['"`][^'"`]*[一-鿿]/g)) found.push({ file, line: idx + 1, code: m[1] })
    for (const m of l.matchAll(/\bcode\s*===?\s*['"]([a-z][a-z0-9_]*)['"]|['"]([a-z][a-z0-9_]*)['"]\s*===?\s*\w*\.?code\b/g)) found.push({ file, line: idx + 1, code: m[1] ?? m[2] })
  })
  return found
}

export function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) { if (!['node_modules', 'generated'].includes(entry.name)) out.push(...walk(p)) }
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p)
  }
  return out.sort()
}

// ── check ──
export function check({ root = ROOT, contracts = JSON.parse(readFileSync(join(GENERATED, 'endpoints.json'), 'utf8')) } = {}) {
  const endpoints = contracts.endpoints.map((e) => ({ ...e, segments: normalise(e.path).split('/') }))
  const known = new Set(contracts.errors.map((e) => e.code))
  const drift = [], warnings = []
  for (const abs of walk(join(root, 'src'))) {
    const file = relative(root, abs), text = readFileSync(abs, 'utf8')
    for (const call of scanApiCalls(file, text)) {
      const segs = call.path.split('/')
      const matches = endpoints.filter((e) => e.segments.length === segs.length && e.segments.every((s, i) => s === segs[i] || (s === ':param' && segs[i] !== ':param' && segs[i] !== '')))
      const exact = matches.filter((e) => e.segments.every((s, i) => s === segs[i]))
      const candidates = exact.length ? exact : matches
      if (!candidates.length) { drift.push({ ...call, reason: 'path not in gateway endpoints' }); continue }
      const bad = call.methods.filter((m) => !candidates.some((e) => e.method === m))
      if (bad.length) drift.push({ ...call, reason: `method ${bad.join('/')} not allowed (gateway has ${[...new Set(candidates.map((e) => e.method))].join(', ')})` })
    }
    for (const ref of scanErrorCodes(file, text)) {
      if (!known.has(ref.code) && !CLIENT_CODES.has(ref.code) && !/^http_\d+$/.test(ref.code)) warnings.push({ ...ref, reason: 'error code never emitted by gateway' })
    }
  }
  return { drift, warnings, source: contracts._source }
}

function main(argv) {
  const at = argv.indexOf('--from')
  if (argv.includes('--check')) {
    if (!FILES.every((f) => existsSync(join(GENERATED, f)))) { console.error('generated contracts missing — run npm run contracts:sync'); return 1 }
    const { drift, warnings, source } = check()
    console.log(`contracts from ipzsk-api-gateway@${source?.commit ?? 'unknown'}`)
    for (const w of warnings) console.warn(`warning ${w.file}:${w.line} ${w.code}: ${w.reason}`)
    for (const d of drift) console.error(`drift   ${d.file}:${d.line} ${d.methods.join('/') || '?'} ${d.raw}: ${d.reason}`)
    console.log(`${drift.length} drift, ${warnings.length} warnings`)
    return drift.length ? 1 : 0
  }
  const from = resolve(at >= 0 ? argv[at + 1] : join(ROOT, '../ipzsk-api-gateway'))
  try { console.log(`synced contracts from ipzsk-api-gateway@${sync(from)}`); return 0 }
  catch (e) { console.error(e.message); return 1 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
