import type { JSONContent } from '@tiptap/core'
import { ApiError, request } from '@/shared/api'
import type { GenerationParams, MediaKind } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay } from './catalog'
import type { Mention } from './queue'

export const GENERATION_SUBMIT_KEY = ['generation', 'submit'] as const

/**
 * Optimistic placeholder contract (§6). Every per-item submit runs as a TanStack mutation with
 * mutationKey ['generation','submit'] and `variables: PendingGeneration`. The create view (F5) renders
 * placeholders with:
 *
 *   useMutationState({ filters: { mutationKey: GENERATION_SUBMIT_KEY }, select: m => ({ status: m.state.status, item: m.state.variables as PendingGeneration, result: m.state.data as SubmitOutcome | undefined, error: m.state.error as SubmitError | null }) })
 *
 * status 'pending' → 「提交中」 card; 'success' → data.record_id (poll generations); 'error' → error.outcome.error.message + retry
 * via `retryItem(item_id)` from composer/send.ts. Anchor dependents only appear once phase 2 starts.
 */
export interface PendingGeneration {
  item_id: string
  kind: MediaKind
  model: string
  prompt: string
  params: GenerationParams
  reference_asset_ids: string[]
  /** For thumbnails in the placeholder card only; not sent. */
  references: MediaAsset[]
  batch_id: string
  batch_position: number
  thread_id: string | null
  anchor_record_id: string | null
  anchor_of: string | null
  mentions: Mention[]
  prompt_doc: JSONContent | null
}

export type SubmitOutcome =
  | { status: 'accepted'; record_id?: string }
  | { status: 'rejected' | 'retryable'; error: { code: string; message: string } }

export class SubmitError extends Error {
  readonly outcome: Exclude<SubmitOutcome, { status: 'accepted' }>
  constructor(outcome: Exclude<SubmitOutcome, { status: 'accepted' }>) { super(outcome.error.message); this.outcome = outcome }
}

const RETRYABLE_CODES = new Set(['rate_limited', 'too_many_active', 'billing_unavailable'])

/** HTTP → outcome. 2xx/409 accepted (409 = same Idempotency-Key already accepted); other 4xx rejected; 0/5xx/429 retryable. */
export function classify(error: unknown): SubmitOutcome {
  if (!(error instanceof ApiError)) return { status: 'retryable', error: { code: 'network_error', message: '网络异常，请重试' } }
  if (error.status === 409 && error.code !== 'too_many_active') return { status: 'accepted' }
  const e = { code: error.code, message: error.message }
  if (error.status === 0 || error.status >= 500 || error.status === 429 || RETRYABLE_CODES.has(error.code)) return { status: 'retryable', error: e }
  return { status: 'rejected', error: e }
}

export async function submitGeneration(item: PendingGeneration): Promise<SubmitOutcome> {
  const body = {
    model: item.model, prompt: item.prompt, ...item.params,
    reference_asset_ids: item.reference_asset_ids, batch_id: item.batch_id, batch_position: item.batch_position,
    thread_id: item.thread_id, anchor_record_id: item.anchor_record_id, mentions: item.mentions, prompt_doc: item.prompt_doc,
  }
  if (isMock) {
    await mockDelay(400 + Math.random() * 800)
    const r = Math.random()
    if (r < 0.1) return { status: 'rejected', error: { code: 'unsupported_param', message: `${item.model} 不支持当前参数组合` } }
    if (r < 0.15) return { status: 'retryable', error: { code: 'network_error', message: '暂时无法连接服务，请检查网络后重试。' } }
    return { status: 'accepted', record_id: crypto.randomUUID() }
  }
  const path = item.kind === 'video' ? '/api/videos/generations' : '/api/me/images/generations'
  try {
    const data = await request<{ record_id?: string; id?: string }>(path, { body, headers: { 'Idempotency-Key': `q:${item.item_id}` } })
    return { status: 'accepted', record_id: data?.record_id ?? data?.id }
  } catch (error) { return classify(error) }
}

/** Run `fn` over items with at most `limit` in flight (lanehub allows 3 active per user). */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it)
  }))
}
