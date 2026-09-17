import { createRequire } from 'node:module'
import type * as PW from 'playwright-core'

const require = createRequire(import.meta.url)
const FALLBACK = '/Users/icycat/projects/opencontext/node_modules/playwright-core'

/** playwright-core from node_modules, else the known local install, else null (suite skips). */
export function loadPlaywright(): typeof PW | null {
  for (const id of ['playwright-core', FALLBACK]) {
    try { return require(require.resolve(id)) } catch { /* next */ }
  }
  return null
}
