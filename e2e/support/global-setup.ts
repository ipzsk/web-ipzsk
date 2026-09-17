import type { TestProject } from 'vitest/node'
import { loadPlaywright } from './pw'

declare module 'vitest' {
  export interface ProvidedContext { wsEndpoint: string }
}

export default async function setup(project: TestProject) {
  const pw = loadPlaywright()
  if (!pw) {
    console.warn('SKIPPED e2e: playwright-core not found')
    project.provide('wsEndpoint', '')
    return
  }
  const server = await pw.chromium.launchServer({ headless: true })
  project.provide('wsEndpoint', server.wsEndpoint())
  return () => server.close()
}
