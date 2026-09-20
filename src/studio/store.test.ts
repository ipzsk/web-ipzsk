import { beforeEach, expect, it } from 'vitest'
import { __resetKindRead, readKindOnce, useComposer } from './store'

beforeEach(() => { __resetKindRead(); useComposer.setState({ kind: 'image' }) })

it('reads ?kind= only on first call; user switch wins afterwards', () => {
  readKindOnce('?kind=video')
  expect(useComposer.getState().kind).toBe('video')
  useComposer.getState().setKind('image')
  readKindOnce('?kind=video')
  expect(useComposer.getState().kind).toBe('image')
})

it('ignores invalid kinds', () => {
  readKindOnce('?kind=audio')
  expect(useComposer.getState().kind).toBe('image')
})
