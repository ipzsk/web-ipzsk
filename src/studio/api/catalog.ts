import { isMock, request } from '@/shared/api'
import type { GenerationParams, MediaKind, ModelCatalog, ModelSpec, ParamSpec } from '@/shared/contracts'

export { isMock } from '@/shared/api'
import { isAvatarParams } from '../avatar/logic'
import { mockAvatarModels, mockAvatarQuote } from '../avatar/mock'

export const mockDelay = (ms = 250) => new Promise(r => setTimeout(r, ms))
/** localStorage['ipzsk.mock.failRate'] (e.g. '0' for deterministic QA runs); default 0.05. Shared by all studio mocks. */
export const mockFailRate = () => { try { const v = localStorage.getItem('ipzsk.mock.failRate'); return v != null ? Number(v) : 0.05 } catch { return 0.05 } }

const ratios16 = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3']
const ratios15 = ratios16.filter(r => r !== 'auto')
const ratios7 = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']
const videoRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']
/** The gateway advertises these two as an enum of the strings "true"/"false" — the composer still renders a switch. */
const boolEnum = (field: string) => ({ field, type: 'enum', values: ['true', 'false'], default: 'false' }) as const satisfies ParamSpec
const n = { field: 'n', type: 'integer', values: [1, 2, 3, 4], default: 1 } as const satisfies ParamSpec

/**
 * Exactly the generated `ModelSpec` shape (checked in contracts/mocks.test.ts), and mirroring what the
 * lanehub APIMart catalog advertises — including the shapes the composer has to handle generically:
 * a boolean dressed up as the enum ["true","false"] (`enhance_prompt`) and an integer with no values (`seed`).
 */
export const MOCK_MODELS = [
  {
    id: 'gpt-image-2', kind: 'image', name: 'GPT Image 2', billing: { unit: 'image' },
    params: [
      { field: 'aspect_ratio', type: 'enum', values: ratios16, default: '1:1' },
      { field: 'resolution', type: 'enum', values: ['1k', '2k', '4k'], default: '2k' },
      n,
    ],
    references: { maxImages: 15 }, unsupported: {},
  },
  {
    id: 'gpt-image-2.5-flare', kind: 'image', name: 'GPT Image 2.5 Flare', billing: { unit: 'image', tiers: ['1k', '2k', '4k'] },
    params: [
      { field: 'aspect_ratio', type: 'enum', values: ratios16, default: 'auto' },
      { field: 'resolution', type: 'enum', values: ['1k', '2k', '4k'], default: '1k' },
      { field: 'quality', type: 'enum', values: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' },
      n,
    ],
    references: { maxImages: 16 }, unsupported: {},
  },
  {
    id: 'gemini-3.1-flash-image-preview', kind: 'image', name: 'Gemini 3.1 Flash Image', billing: { unit: 'image' },
    params: [
      { field: 'aspect_ratio', type: 'enum', values: ratios15, default: '1:1' },
      { field: 'resolution', type: 'enum', values: ['0.5K', '1K', '2K', '4K'], default: '1K' },
      n,
    ],
    references: { maxImages: 14 }, unsupported: {},
  },
  {
    id: 'z-image-turbo', kind: 'image', name: 'Z-Image Turbo', billing: { unit: 'image' },
    params: [
      { field: 'aspect_ratio', type: 'enum', values: ratios7, default: '1:1' },
      { field: 'resolution', type: 'enum', values: ['1K', '2K'], default: '1K' },
      boolEnum('enhance_prompt'),
      n,
    ],
    references: { maxImages: 0 }, unsupported: {},
  },
  {
    id: 'seedance-2.0-mini', kind: 'video', name: 'Seedance 2.0 Mini', billing: { unit: 'second' },
    params: [
      { field: 'aspect_ratio', type: 'enum', values: videoRatios, default: '16:9' },
      { field: 'resolution', type: 'enum', values: ['480p', '720p'], default: '720p' },
      { field: 'duration', type: 'enum', values: Array.from({ length: 12 }, (_, i) => String(i + 4)), default: '5', unit: 's' },
      { field: 'seed', type: 'integer', default: null },
      boolEnum('sound'),
    ],
    references: { maxImages: 9 }, unsupported: {},
  },
] satisfies ModelSpec[] as ModelSpec[]

export async function fetchModels(): Promise<ModelSpec[]> {
  if (isMock) { await mockDelay(); return [...MOCK_MODELS, ...mockAvatarModels()] }
  return (await request<ModelCatalog>('/api/me/media/models')).models
}

/** Body of one quote entry = the generation body minus the prompt text (price does not depend on it; avoids re-quoting per keystroke). */
export interface QuoteEntry { kind: MediaKind; model: string; params: GenerationParams; reference_asset_ids: string[] }
export interface QuoteResult { points: number | null; error?: { code: string; message: string }; /** 数字人：estimate + 估算秒数，终态按真实时长结算。 */ amount_kind?: string; estimated_seconds?: number }

const mockPoints = ({ model, params }: QuoteEntry) => {
  const base = model === 'z-image-turbo' ? 2 : model === 'gpt-image-2.5-flare' ? 8 : model.startsWith('seedance') ? 6 : 6
  const res = ({ '0.5k': 0.6, '2k': 1.5, '4k': 3, '720p': 1.5 } as Record<string, number>)[String(params.resolution).toLowerCase()] ?? 1
  const quality = ({ low: 0.5, medium: 1, high: 1.6, xhigh: 2.4, max: 3.2 } as Record<string, number>)[String(params.quality)] ?? 1
  return Math.round(base * res * quality * Number(params.n ?? 1) * Number(params.duration ?? 1) * 10) / 10
}

export async function quote(entries: QuoteEntry[], signal?: AbortSignal): Promise<QuoteResult[]> {
  if (isMock) { await mockDelay(200); return entries.map(e => isAvatarParams(e.params) ? mockAvatarQuote(e) : { points: mockPoints(e) }) }
  const data = await request<{ items: { points?: string | number | null; error?: QuoteResult['error']; amount_kind?: string; estimated_seconds?: number }[] }>('/api/me/media/quote', {
    // Generation-body shape minus prompt (gateway forwards it to lanehub /v1/quote and swaps asset ids for signed URLs);
    // points come back as 8-decimal strings (display only).
    body: { items: entries.map(e => ({ model: e.model, ...e.params, reference_asset_ids: e.reference_asset_ids })) }, signal,
  })
  return data.items.map(i => ({ points: i.points == null ? null : Number(i.points), error: i.error, amount_kind: i.amount_kind, estimated_seconds: i.estimated_seconds }))
}

export async function enhancePrompt(prompt: string): Promise<string> {
  if (isMock) { await mockDelay(700); return prompt + '，电影感光影，细节丰富，高清质感' }
  return (await request<{ prompt: string }>('/api/me/image-prompt', { body: { prompt } })).prompt
}
