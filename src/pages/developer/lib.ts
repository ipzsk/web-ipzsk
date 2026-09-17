import { ApiError, request } from '@/shared/api'
import { queryClient } from '@/shared/query'

export const DEV_PROFILE_KEY = ['developer', 'profile'] as const

// Ported verbatim from legacy developer.js.
export const DEV_LABELS: Record<string, string> = { pending: '待审核', approved: '已批准', rejected: '已驳回', disabled: '已停用', published: '已上架', withdrawn: '已撤回 / 下架' }
export const DEV_ERRORS: Record<string, string> = {
  developer_approval_required: '需要管理员批准开发者申请。',
  developer_application_exists: '已有申请，请等待审核。',
  published_metadata_locked: '已上架插件的名称需要管理员修改。',
  invalid_release_url: '请填写当前仓库的 GitHub Release 地址。',
  select_one_tgz_asset: '请提供 npm pack 生成的 .tgz 附件；多个附件时需指定名称。',
  package_identity_mismatch: '安装包中的包名或版本与登记信息不一致。',
  already_exists: '插件标识、包名或版本已存在。',
  github_fetch_failed: '无法读取 GitHub Release，请检查是否已公开发布。',
  plugin_not_found: '插件不存在或你没有权限。',
  invalid_date_range: '日期范围不能超过一年。',
}

export const amount = (v: string | number | null | undefined) => v == null ? '未确认' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 8 }) + ' 元'
export const count = (v: string | number | null | undefined) => v == null ? '未知' : Number(v).toLocaleString('zh-CN')

export class DevError extends Error { constructor(message: string, readonly status: number) { super(message) } }

export async function devApi<T>(path: string, body?: unknown): Promise<T> {
  try { return await request<T>('/api/me/developer' + path, body === undefined ? {} : { body }) }
  catch (e) {
    // Legacy: any 401 hides the workspace and shows the login gate.
    if (e instanceof ApiError && e.status === 401 && path !== '') queryClient.setQueryData(DEV_PROFILE_KEY, 'signed-out')
    if (e instanceof ApiError) throw new DevError(DEV_ERRORS[e.code] ?? e.message, e.status); throw e }
}

export interface DevProfile { state: string; display_name: string; review_note?: string | null }
export interface Plugin { id: string; name: string; repository: string; enabled: boolean; published_versions: number | string; pending_versions: number | string; active_users: number | null; versions: number; revenue_share_bps: number | null }
export interface Release { id: string; version: string; state: string; review_note?: string | null; withdrawal_requested?: boolean }
export interface UsageRow { plugin_name: string; model: string; billed_revenue_cny: string | null; accrued_earnings_cny: string | null; active_users: number | null; requests: number; failed_requests: number; input_tokens: number | null; output_tokens: number | null; unknown_token_requests: number; media_tasks: number; completed_media_tasks: number; unconfigured_share_requests: number }

export function pluginStatus(p: Plugin) {
  const status = !p.enabled ? '已停用' : Number(p.published_versions) > 0 ? '已上架' : Number(p.pending_versions) > 0 ? '待审核' : '未上架'
  return { status, newPending: Number(p.pending_versions) > 0 && Number(p.published_versions) > 0 }
}

/** Gate for a non-approved developer: title, body, and whether the apply form shows. */
export function gateFor(profile: DevProfile | null) {
  if (profile?.state === 'approved') return null
  return {
    title: profile ? DEV_LABELS[profile.state] ?? profile.state : '申请成为开发者',
    body: profile?.review_note ?? '审核通过后，可管理自己的插件并查看使用和收益数据。',
    canApply: !profile || profile.state === 'rejected',
  }
}

export const canWithdraw = (r: Release) => ['pending', 'published'].includes(r.state) && !r.withdrawal_requested

/** Default earnings range: first of this month → today, in Asia/Shanghai. */
export function defaultRange(now = new Date()) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  return { from: today.slice(0, 8) + '01', to: today }
}
