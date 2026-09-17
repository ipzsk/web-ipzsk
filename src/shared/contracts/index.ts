/**
 * Gateway contracts: re-exports of `generated/ipzsk-api.d.ts` (synced by `npm run contracts:sync`, never edited by hand)
 * plus website-only helper types. No logic here.
 */
export type * from './generated/ipzsk-api'

/**
 * Website-only narrowing: the generated `GenerationParams` is `Record<string, unknown>`; the studio only holds
 * primitive values used verbatim ('1K', 5, true). Assignable to the generated type; shadows the star re-export.
 */
export type GenerationParams = Record<string, string | number | boolean>

/** A MediaAsset as it circulates inside the website: `source` / `thumb_state` / `created_at` are absent on locally built assets. */
export type LooseMediaAsset = Omit<import('./generated/ipzsk-api').MediaAsset, 'source' | 'thumb_state' | 'created_at'>
  & Partial<Pick<import('./generated/ipzsk-api').MediaAsset, 'source' | 'thumb_state' | 'created_at'>>
