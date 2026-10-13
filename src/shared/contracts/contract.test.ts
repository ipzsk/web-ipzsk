import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Runs scripts/contracts-sync.mjs in-process (untyped .mjs, hence the dynamic import) against generated/endpoints.json.
interface Finding { file: string; line: number; raw?: string; code?: string; methods?: string[]; reason: string }
interface Source { commit: string | null; dirty: boolean | null; sha256: string }
interface Snapshot { source?: { commit?: string; dirty?: boolean; sha256?: string }; sha256: string }
interface Checker {
  check(): { drift: Finding[]; warnings: Finding[] }
  sync(from: string, options?: { allowDirty?: boolean; to?: string }): Source
  describeSource(from: string): Source
  readGenerated(dir?: string): Snapshot
  verifySource(snapshot: Snapshot, options?: { actual?: Source | null; allowDirty?: boolean }): string[]
  scanApiCalls(file: string, text: string): { path: string; methods: string[] }[]
}
const script = '../../../scripts/contracts-sync.mjs'
const load = () => import(/* @vite-ignore */ script) as Promise<Checker>

describe('gateway contracts', () => {
  it('scanner normalises params, query strings and methods', async () => {
    const { scanApiCalls } = await load()
    const calls = scanApiCalls('x.ts', [
      "request(`/api/me/assets?${qs({ a })}`)",
      "request(`/api/me/favorites/asset/${id}`, { method: on ? 'PUT' : 'DELETE' })",
      "request('/api/me/folders', { body: { name } })",
      "send('PATCH', `/api/me/canvas/${id}`)",
      "// request('/api/me/commented-out')",
      "request('/api/me/ignored') // contracts-ignore: test",
    ].join('\n'))
    expect(calls.map(c => [c.methods.join('/'), c.path])).toEqual([
      ['GET', '/api/me/assets'],
      ['PUT/DELETE', '/api/me/favorites/asset/:param'],
      ['POST', '/api/me/folders'],
      ['PATCH', '/api/me/canvas/:param'],
    ])
  })

  it('every API call in src exists in the gateway contract', async () => {
    const { drift, warnings } = (await load()).check()
    for (const w of warnings) console.warn(`${w.file}:${w.line} ${w.code}: ${w.reason}`)
    expect(drift.map(d => `${d.file}:${d.line} ${d.methods?.join('/') || '?'} ${d.raw} — ${d.reason}`)).toEqual([])
  })
})

// A throwaway gateway checkout: contracts/ committed in a real git repo.
function gatewayFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ipzsk-gateway-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  mkdirSync(join(dir, 'contracts'))
  writeFileSync(join(dir, 'contracts/endpoints.json'), JSON.stringify({ endpoints: [], errors: [] }, null, 2) + '\n')
  writeFileSync(join(dir, 'contracts/ipzsk-api.d.ts'), '// Generated.\nexport type A = string\n')
  git('init', '-q'); git('add', '.')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'fixture')
  return dir
}

describe('contract provenance', () => {
  it('a legacy dirty snapshot without commit or hash fails the source check', async () => {
    const { verifySource } = await load()
    const problems = verifySource({ source: { commit: 'fe03279-dirty' }, sha256: 'x' })
    expect(problems).toHaveLength(3)
  })

  it('sync records the full commit and hash; a clean snapshot verifies against its worktree', async () => {
    const { sync, describeSource, readGenerated, verifySource } = await load()
    const gateway = gatewayFixture(), out = mkdtempSync(join(tmpdir(), 'ipzsk-generated-'))
    try {
      const source = sync(gateway, { to: out })
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(source.dirty).toBe(false)
      expect(readFileSync(join(out, 'ipzsk-api.d.ts'), 'utf8')).toContain(source.commit)
      expect(verifySource(readGenerated(out), { actual: describeSource(gateway) })).toEqual([])
      // The gateway moves on: the snapshot is no longer "the gateway", even with zero path drift.
      writeFileSync(join(gateway, 'contracts/ipzsk-api.d.ts'), '// Generated.\nexport type A = number\n')
      const problems = verifySource(readGenerated(out), { actual: describeSource(gateway) })
      expect(problems.some(p => p.includes('differ from the snapshot'))).toBe(true)
      expect(problems.some(p => p.includes('uncommitted'))).toBe(true)
      // A hand edit of the generated copy is caught without the gateway.
      writeFileSync(join(out, 'ipzsk-api.d.ts'), readFileSync(join(out, 'ipzsk-api.d.ts'), 'utf8') + 'export type B = 1\n')
      expect(verifySource(readGenerated(out)).some(p => p.includes('content hash'))).toBe(true)
    } finally { rmSync(gateway, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
  })

  it('a dirty worktree is refused unless explicitly allowed, and the dirty snapshot then fails check', async () => {
    const { sync, describeSource, readGenerated, verifySource } = await load()
    const gateway = gatewayFixture(), out = mkdtempSync(join(tmpdir(), 'ipzsk-generated-'))
    try {
      writeFileSync(join(gateway, 'contracts/endpoints.json'), JSON.stringify({ endpoints: [{ method: 'GET', path: '/api/me/x' }], errors: [] }))
      expect(() => sync(gateway, { to: out })).toThrow(/uncommitted/)
      sync(gateway, { to: out, allowDirty: true })
      const snapshot = readGenerated(out)
      expect(verifySource(snapshot).some(p => p.includes('dirty'))).toBe(true)
      expect(verifySource(snapshot, { actual: describeSource(gateway), allowDirty: true })).toEqual([])
    } finally { rmSync(gateway, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }) }
  })
})
