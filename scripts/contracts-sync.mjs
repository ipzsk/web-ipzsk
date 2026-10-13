#!/usr/bin/env node
// Shared API contracts with ipzsk-api-gateway (docs/studio-redesign.md §10.2 / §11).
//
//   npm run contracts:sync -- --from <gateway worktree>
//       copy <gateway>/contracts/{endpoints.json,ipzsk-api.d.ts} into src/shared/contracts/generated/.
//       --from is required: the snapshot must come from an explicit gateway worktree, never an implicit sibling
//       checkout. The full HEAD commit, the worktree's dirty flag and a content hash are recorded in _source.
//       A dirty worktree is refused unless --allow-dirty is passed.
//   npm run contracts:check [-- --from <gateway worktree>] [--allow-dirty]
//       fail when the snapshot has no full commit, was taken from a dirty worktree, or no longer matches its
//       recorded hash; with --from, also fail when that worktree's HEAD or contracts differ from the snapshot.
//       Then scan src/**/*.{ts,tsx} for API paths; fail on any (method, path) missing from generated/endpoints.json;
//       warn on error codes the gateway never emits. --allow-dirty is for local verification against an
//       uncommitted gateway worktree only; CI must run without it.
//
// Silence a known false positive with `// contracts-ignore: reason` on the same or the previous line.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// String input only: under vitest's jsdom env the global URL is jsdom's, which node:url rejects.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const GENERATED = join(ROOT, 'src/shared/contracts/generated')
const FILES = ['endpoints.json', 'ipzsk-api.d.ts']
// Codes produced by the website itself, not the gateway.
const CLIENT_CODES = new Set(['network_error'])

// ── provenance ──
// Hash of the parsed endpoint list plus the declaration file, so the generated copy (with _source and a header
// line added) can be compared with the gateway's files without re-reading them.
export const contentHash = (json, dts) => createHash('sha256').update(JSON.stringify(json) + '\n' + dts).digest('hex')

export function describeSource(from) {
  const src = join(from, 'contracts')
  const missing = FILES.filter((f) => !existsSync(join(src, f)))
  if (missing.length) throw new Error(`missing ${missing.map((f) => join(src, f)).join(', ')} — run \`npm run contracts\` in the gateway first`)
  const git = (...args) => execFileSync('git', ['-C', from, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let commit = null, dirty = null
  try { commit = git('rev-parse', 'HEAD'); dirty = Boolean(git('status', '--porcelain')) } catch { /* not a git checkout */ }
  const json = JSON.parse(readFileSync(join(src, 'endpoints.json'), 'utf8'))
  const dts = readFileSync(join(src, 'ipzsk-api.d.ts'), 'utf8')
  return { commit, dirty, sha256: contentHash(json, dts), json, dts }
}

// ── sync ──
export function sync(from, { allowDirty = false, to = GENERATED } = {}) {
  const source = describeSource(from)
  if (!source.commit) throw new Error(`${from} is not a git checkout — contracts must come from an identifiable gateway commit`)
  if (source.dirty && !allowDirty) throw new Error(`${from} has uncommitted changes — commit them, or pass --allow-dirty (contracts:check then fails until re-synced from a clean commit)`)
  mkdirSync(to, { recursive: true })
  const _source = { repo: 'ipzsk-api-gateway', commit: source.commit, dirty: source.dirty, sha256: source.sha256 }
  writeFileSync(join(to, 'endpoints.json'), JSON.stringify({ _source, ...source.json }, null, 2) + '\n')
  writeFileSync(join(to, 'ipzsk-api.d.ts'),
    `// Synced from ipzsk-api-gateway@${source.commit}${source.dirty ? ' (dirty worktree)' : ''} by scripts/contracts-sync.mjs. Do not edit; re-run \`npm run contracts:sync\`.\n`
    + source.dts)
  return source
}

export function readGenerated(dir = GENERATED) {
  const { _source: source, ...json } = JSON.parse(readFileSync(join(dir, 'endpoints.json'), 'utf8'))
  const dts = readFileSync(join(dir, 'ipzsk-api.d.ts'), 'utf8').replace(/^[^\n]*\n/, '')
  return { source, json, sha256: contentHash(json, dts) }
}

// Returns every reason the generated snapshot cannot be trusted as "the gateway at a known commit".
export function verifySource({ source, sha256 }, { actual = null, allowDirty = false } = {}) {
  const problems = []
  if (!/^[0-9a-f]{40}$/.test(source?.commit ?? '')) problems.push(`snapshot records no full gateway commit (${source?.commit ?? 'none'}); re-sync with --from <gateway worktree>`)
  if (source?.dirty !== false && !allowDirty) problems.push('snapshot was taken from a dirty or unknown gateway worktree; re-sync from a clean commit')
  if (source?.sha256 !== sha256) problems.push('generated files do not match the recorded content hash (edited by hand or partial sync)')
  if (actual) {
    if (actual.commit !== source?.commit) problems.push(`gateway HEAD ${actual.commit ?? 'unknown'} differs from snapshot ${source?.commit ?? 'unknown'}`)
    if (actual.sha256 !== source?.sha256) problems.push('gateway contracts differ from the snapshot; re-run contracts:sync')
    if (actual.dirty && !allowDirty) problems.push('gateway worktree has uncommitted changes')
  }
  return problems
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
  const at = argv.indexOf('--from'), allowDirty = argv.includes('--allow-dirty')
  const from = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]) : null
  if (argv.includes('--check')) {
    if (!FILES.every((f) => existsSync(join(GENERATED, f)))) { console.error('generated contracts missing — run npm run contracts:sync -- --from <gateway worktree>'); return 1 }
    let problems
    try { problems = verifySource(readGenerated(), { actual: from ? describeSource(from) : null, allowDirty }) }
    catch (e) { console.error(e.message); return 1 }
    const { drift, warnings, source } = check()
    console.log(`contracts from ipzsk-api-gateway@${source?.commit ?? 'unknown'}${source?.dirty ? ' (dirty worktree)' : ''}`)
    for (const p of problems) console.error(`source  ${p}`)
    for (const w of warnings) console.warn(`warning ${w.file}:${w.line} ${w.code}: ${w.reason}`)
    for (const d of drift) console.error(`drift   ${d.file}:${d.line} ${d.methods.join('/') || '?'} ${d.raw}: ${d.reason}`)
    console.log(`${problems.length} source problems, ${drift.length} drift, ${warnings.length} warnings`)
    return drift.length || problems.length ? 1 : 0
  }
  if (!from) { console.error('usage: npm run contracts:sync -- --from <gateway worktree> [--allow-dirty]'); return 1 }
  try {
    const source = sync(from, { allowDirty })
    console.log(`synced contracts from ipzsk-api-gateway@${source.commit}${source.dirty ? ' (dirty worktree — contracts:check will fail until re-synced from a clean commit)' : ''}`)
    return 0
  } catch (e) { console.error(e.message); return 1 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
