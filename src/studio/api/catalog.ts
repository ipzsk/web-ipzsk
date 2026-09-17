import { request } from '@/shared/api'
import type { GenerationParams, MediaKind, ModelSpec } from '@/shared/contracts'

/** Mock adapters (§ backend B2/B3 not built yet): `?mock=1` on entry, or DEV + localStorage['ipzsk.mock']==='1'. Read once per page load. */
export const isMock = (() => {
  try {
    return new URLSearchParams(location.search).get('mock') === '1' || (import.meta.env.DEV && localStorage.getItem('ipzsk.mock') === '1')
  } catch { return false }
})()

export const mockDelay = (ms = 250) => new Promise(r => setTimeout(r, ms))

const ratios16 = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9', '9:21', '2:1', '1:2', '3:1', '1:3']
const n = { name: 'n', label: '张数', type: 'integer', min: 1, max: 4, default: 1 } as const

export const MOCK_MODELS: ModelSpec[] = [
  {
    id: 'gpt-image-2', kind: 'image', name: 'GPT Image 2', description: '综合能力强，擅长文字与排版', billing_unit: '按张',
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['1:1', '3:2', '2:3', '16:9', '9:16'], default: '1:1' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['1K', '2K', '4K'], default: '2K' },
      n,
    ],
    references: { max: 15 },
  },
  {
    id: 'gpt-image-2.5-flare', kind: 'image', name: 'GPT Image 2.5 Flare', description: '更多比例，支持 auto', billing_unit: '按张',
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ratios16, default: 'auto' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['1K', '2K', '4K'], default: '1K' },
      n,
    ],
    references: { max: 15 },
  },
  {
    id: 'z-image-turbo', kind: 'image', name: 'Z-Image Turbo', description: '速度快、价格低，仅文生图', billing_unit: '按张',
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['1:1', '16:9', '9:16'], default: '1:1' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['1K'], default: '1K' },
      n,
    ],
    references: { max: 0 },
  },
  {
    id: 'seedance-2.0-mini', kind: 'video', name: 'Seedance 2.0 Mini', description: '5–10 秒短视频', billing_unit: '按秒',
    params: [
      { name: 'aspect_ratio', label: '比例', type: 'enum', values: ['16:9', '9:16', '1:1'], default: '16:9' },
      { name: 'resolution', label: '清晰度', type: 'enum', values: ['480p', '720p'], default: '720p' },
      { name: 'duration', label: '时长', type: 'enum', values: [5, 10], default: 5 },
    ],
    references: { max: 0 },
  },
]

export async function fetchModels(): Promise<ModelSpec[]> {
  if (isMock) { await mockDelay(); return MOCK_MODELS }
  const data = await request<ModelSpec[] | { items: ModelSpec[] }>('/api/me/media/models')
  return Array.isArray(data) ? data : data.items
}

/** Body of one quote entry = the generation body minus the prompt text (price does not depend on it; avoids re-quoting per keystroke). */
export interface QuoteEntry { kind: MediaKind; model: string; params: GenerationParams; reference_count: number }
export interface QuoteResult { points: number | null; error?: { code: string; message: string } }

const mockPoints = ({ model, params }: QuoteEntry) => {
  const base = model === 'z-image-turbo' ? 2 : model === 'gpt-image-2.5-flare' ? 8 : model.startsWith('seedance') ? 6 : 6
  const res = ({ '2K': 1.5, '4K': 3, '720p': 1.5 } as Record<string, number>)[String(params.resolution)] ?? 1
  return Math.round(base * res * Number(params.n ?? 1) * Number(params.duration ?? 1) * 10) / 10
}

export async function quote(entries: QuoteEntry[], signal?: AbortSignal): Promise<QuoteResult[]> {
  if (isMock) { await mockDelay(200); return entries.map(e => ({ points: mockPoints(e) })) }
  const data = await request<{ items: { points: string | number | null; error?: QuoteResult['error'] }[] }>('/api/me/media/quote', { body: entries, signal })
  return data.items.map(i => ({ points: i.points == null ? null : Number(i.points), error: i.error }))
}

export async function enhancePrompt(prompt: string): Promise<string> {
  if (isMock) { await mockDelay(700); return prompt + '，电影感光影，细节丰富，高清质感' }
  return (await request<{ prompt: string }>('/api/me/image-prompt', { body: { prompt } })).prompt
}
