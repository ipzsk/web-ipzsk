import { describe, expect, it } from 'vitest'

// Runs scripts/contracts-sync.mjs in-process (untyped .mjs, hence the dynamic import) against generated/endpoints.json.
interface Finding { file: string; line: number; raw?: string; code?: string; methods?: string[]; reason: string }
interface Checker {
  check(): { drift: Finding[]; warnings: Finding[] }
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
