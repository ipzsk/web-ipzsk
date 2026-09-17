import type { JSONContent } from '@tiptap/core'
import { ApiError, request } from '@/shared/api'
import type { GenerationParams, MediaKind } from '@/shared/contracts'
import type { MediaAsset } from '@/media'
import { isMock, mockDelay, mockFailRate } from './catalog'
import type { Mention } from './queue'
import { avatarSubmitBody, checkAvatarParams, guideAvatarError, isAvatarParams } from '../avatar/logic'
import { mockAvatarError } from '../avatar/mock'

export const GENERATION_SUBMIT_KEY = ['generation', 'submit'] as const

/**
 * Optimistic placeholder contract (§6). Every per-item submit runs as a TanStack mutation with
 * mutationKey ['generation','submit'] and `variables: PendingGeneration`. The create view (F5) renders
 * placeholders with:
 *
 *   useMutationState({ filters: { mutationKey: GENERATION_SUBMIT_KEY }, select: m => ({ status: m.state.status, item: m.state.variables as PendingGeneration, result: m.state.data as SubmitOutcome | undefined, error: m.state.error as SubmitError | null }) })
 *
 * status 'pending' → 「提交中」 card; 'success' → accepted (the gateway passes the upstream body through, no record id: records are
 * matched by idempotency key `q:{item_id}`, see api/records.ts findByItem); 'error' → error.outcome.error.message + retry
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
  /** null for a standalone request (e.g. 再生成 of one record, which carries parent_record_id instead). */
  batch_id: string | null
  batch_position: number | null
  parent_record_id: string | null
  thread_id: string | null
  anchor_record_id: string | null
  anchor_of: string | null
  mentions: Mention[]
  prompt_doc: JSONContent | null
}

export type SubmitOutcome =
  | { status: 'accepted' }
  | { status: 'rejected' | 'retryable'; error: { code: string; message: string; field?: string } }

export class SubmitError extends Error {
  readonly outcome: Exclude<SubmitOutcome, { status: 'accepted' }>
  constructor(outcome: Exclude<SubmitOutcome, { status: 'accepted' }>) { super(outcome.error.message); this.outcome = outcome }
}

const RETRYABLE_CODES = new Set(['rate_limited', 'too_many_active', 'billing_unavailable'])

/** HTTP → outcome. 2xx/409 accepted (409 = same Idempotency-Key already accepted); other 4xx rejected; 0/5xx/429 retryable. */
export function classify(error: unknown): SubmitOutcome {
  if (!(error instanceof ApiError)) return { status: 'retryable', error: { code: 'network_error', message: '网络异常，请重试' } }
  if (error.status === 409 && error.code !== 'too_many_active') return { status: 'accepted' }
  const field = (error.body as { error?: { field?: unknown } } | null)?.error?.field
  const e = { code: error.code, message: error.message, ...(typeof field === 'string' && { field }) }
  if (error.status === 0 || error.status >= 500 || error.status === 429 || RETRYABLE_CODES.has(error.code)) return { status: 'retryable', error: e }
  return { status: 'rejected', error: e }
}

const avatarOutcome = (error: unknown): SubmitOutcome => {
  const out = classify(error)
  return out.status === 'accepted' ? out : { ...out, error: guideAvatarError(out.error, error) }
}

export async function submitGeneration(item: PendingGeneration): Promise<SubmitOutcome> {
  // 数字人：不带 prompt / reference_asset_ids，发送前再查一次互斥（avatar/logic.ts）。
  const avatar = isAvatarParams(item.params)
  const invalid = avatar ? checkAvatarParams(item.params, item.prompt) : null
  if (invalid) return { status: 'rejected', error: guideAvatarError(invalid) }
  const body = avatar ? avatarSubmitBody(item) : {
    model: item.model, prompt: item.prompt, ...item.params,
    reference_asset_ids: item.reference_asset_ids, batch_id: item.batch_id, batch_position: item.batch_position,
    parent_record_id: item.parent_record_id,
    thread_id: item.thread_id, anchor_record_id: item.anchor_record_id, mentions: item.mentions, prompt_doc: item.prompt_doc,
  }
  if (isMock) {
    // QA hook: every mock request body, e.g. to assert 再生成 carries parent_record_id and no batch_id.
    ;((globalThis as { __ipzskMockSubmits?: unknown[] }).__ipzskMockSubmits ??= []).push({ path: item.kind === 'video' ? '/api/me/videos/generations' : '/api/me/images/generations', body })
    await mockDelay(400 + Math.random() * 800)
    const mockAvatar = avatar ? mockAvatarError(item.params) : null
    if (mockAvatar) return avatarOutcome(new ApiError('x', { status: 400, code: mockAvatar.code, body: { error: mockAvatar } }))
    const r = Math.random(), f = mockFailRate() // default 5% → 10% rejected (with a field, like the gateway), 5% retryable
    if (r < f * 2) return classify(new ApiError('参数取值不被当前型号支持，请修改后重试。', { status: 400, code: 'invalid_param_value', body: { error: { code: 'invalid_param_value', field: Object.keys(item.params)[0] } } }))
    if (r < f * 3) return { status: 'retryable', error: { code: 'network_error', message: '暂时无法连接服务，请检查网络后重试。' } }
    return { status: 'accepted' }
  }
  const path = item.kind === 'video' ? '/api/me/videos/generations' : '/api/me/images/generations'
  try {
    // Response is the upstream body passed through (UpstreamPassthrough) — no record id; don't read it.
    await request<unknown>(path, { body, headers: { 'Idempotency-Key': `q:${item.item_id}` } })
    return { status: 'accepted' }
  } catch (error) { return avatar ? avatarOutcome(error) : classify(error) }
}

/** Run `fn` over items with at most `limit` in flight (lanehub allows 3 active per user). */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let it = queue.shift(); it !== undefined; it = queue.shift()) await fn(it)
  }))
}
