import { ApiError, request } from '@/shared/api'
import type { CloudImage, WorkspaceState } from './model'

// Same endpoints and payloads as legacy workspace.js.
export interface CloudDoc { revision: number; payload: WorkspaceState | null }

export const getCloud = () => request<CloudDoc>('/api/me/workspace')
export const putCloud = (revision: number, payload: WorkspaceState) => request<{ revision: number }>('/api/me/workspace', { body: { revision, payload } })
export const getImages = (offset: number) => request<{ rows?: CloudImage[]; next_offset?: number | null }>(`/api/me/images?offset=${offset}`)

/** Owner id = verified account only (legacy: unverified email ⇒ guest drafts). null ⇒ guest; undefined ⇒ unknown (network). */
export async function resolveOwner(): Promise<string | null | undefined> {
  try {
    const d = await request<{ user?: { id: string | number; email_verified?: boolean } }>('/api/me/profile')
    return d.user?.email_verified ? String(d.user.id) : null
  } catch (e) {
    return e instanceof ApiError && e.status !== 0 ? null : undefined
  }
}

export interface ChatMessage { role: 'system' | 'user'; content: string }
export interface ChatBody { model: string; messages: ChatMessage[]; request_id: string; budget_cny?: unknown; policy_version?: unknown }
export interface Quote { reserved_cny: unknown; policy_version: unknown; billing_enabled: boolean; reserved_points: number | string; output_limit: number; can_afford: boolean }
export interface ChatResult {
  choices?: { message?: { content?: unknown } }[]
  billing?: { charged_points?: number | string | null; input_tokens?: number; output_tokens?: number }
}

export const getModels = () => request<{ models: string[] }>('/api/me/workspace/models')
export const getQuote = (body: ChatBody) => request<Quote>('/api/me/workspace/quote', { body })
export const runChat = (body: ChatBody) => request<ChatResult>('/api/me/workspace/chat', { body })
