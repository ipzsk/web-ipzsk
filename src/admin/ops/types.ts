// 运维后台 /api/admin/ops/* 的前端类型：全部来自网关生成的契约，这里只起页面习惯用的别名。
import type {
  ChannelSummary, LaneChange, LaneChannel, LaneMatrix, LaneMatrixSaveResult, LogEntry,
  OpsChannelPage, OpsLogPage, OpsPeriod, OpsRealtime, Probe,
} from '@/shared/contracts'

export type { ChannelSummary, LaneChange, LaneChannel, LaneMatrix, LogEntry, Probe }
export type Page<T> = { items: T[]; page: number; size: number; total: number }
export type LaneSaveResult = LaneMatrixSaveResult
export type LaneChannelState = LaneMatrixSaveResult['results'][number]['before']
export type DashboardRealtime = OpsRealtime
export type DashboardPeriodRow = OpsPeriod['rows'][number]
// 编译期核对：页面用的 Page<T> 与契约的分页形状一致
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const _pageShapes: [Same<Page<ChannelSummary>, OpsChannelPage>, Same<Page<LogEntry>, OpsLogPage>] = [true, true]
