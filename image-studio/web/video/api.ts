// Video generation client: same backend flow as the former /video.js, plus a per-user task history.
import {request, currentUser} from '../../../api.js';

export type Settings = {model: string; prompt: string; resolution: string; duration: number};
export type VideoTask = Settings & {
  id: string; status: string; progress: number; modelName: string; createdAt: number;
  url?: string; error?: string; note?: string;
};
export type Model = {id: string; name?: string; params?: {field: string; values?: unknown[]; default?: unknown; min?: number; max?: number}[]};

const messages: Record<string, string> = {
  invalid_api_token: '登录已失效，请重新登录。', customer_login_required: '请先登录并验证邮箱。',
  desktop_models_unavailable: '当前没有可用的视频模型。', insufficient_balance: '账户余额不足，请先充值。',
  billing_requires_priced_media: '该模型暂时没有可用价格。', missing_resolution: '请选择清晰度。',
  unsupported_resolution: '当前模型不支持这个清晰度。', invalid_number: '视频时长无效。',
  upstream_result_uncertain: '上游结果暂时无法确认，请稍后在账户记录中核对。',
};
export const HISTORY_LIMIT = 30;
export const DRAFT_KEY = 'ipzsk.video.draft.v1';
const DONE = ['completed', 'failed', 'cancelled'];
export const isActive = (task: VideoTask) => !DONE.includes(task.status);

function errorMessage(data: any, status: number) {
  const code = data?.error?.code;
  return messages[code] || data?.error?.message || (status === 429 ? '请求较多，请稍后重试。' : status >= 500 ? '视频服务暂时不可用，请稍后重试。' : '请求没有完成，请检查设置。');
}
async function json(url: string, options: RequestInit) {
  const response = await fetch(url, {cache: 'no-store', ...options});
  let data: any; try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw Object.assign(new Error(errorMessage(data, response.status)), {status: response.status, code: data?.error?.code});
  return data;
}

export type Session = {owner: string; token: string; models: Model[]};
// Resolves null when signed out. Throws with a user-facing message otherwise.
export async function signIn(): Promise<Session | null> {
  let user: any;
  try { user = await currentUser(); } catch { throw new Error('暂时无法连接 IPZSK 账户服务，请稍后刷新。'); }
  if (!user) return null;
  if (!user.email_verified) throw Object.assign(new Error('请先完成邮箱验证，再使用账户余额生成视频。'), {login: true});
  let data: any;
  try { data = await request('/api/me/desktop/bootstrap', {body: {}}); }
  catch (error: any) { throw new Error(messages[error.code] || error.message); }
  const models = Array.isArray(data.video_models) ? data.video_models : [];
  if (!models.length) throw new Error('当前号池还没有开放视频模型，请联系管理员。');
  return {owner: String(user.id), token: data.token, models};
}

export function modelOptions(model?: Model) {
  const param = (field: string) => model?.params?.find(p => p.field === field);
  const res = param('resolution'), dur = param('duration');
  const resolutions = Array.isArray(res?.values) && res.values.length ? res.values.map(String) : ['480p', '720p'];
  const min = dur?.min ?? 1, max = dur?.max ?? 10;
  let durations = Array.isArray(dur?.values) && dur.values.length ? dur.values.map(Number) : [5, 10].filter(v => v >= min && v <= max);
  if (!durations.length) durations = [Math.min(max, Math.max(min, 5))];
  const defaultDuration = durations.includes(Number(dur?.default)) ? Number(dur!.default) : durations[0];
  const defaultResolution = resolutions.includes(String(res?.default)) ? String(res!.default) : resolutions[0];
  return {resolutions, durations, defaultResolution, defaultDuration};
}

const historyKey = (owner: string) => `ipzsk.video.tasks.v1.${owner}`;
export function loadHistory(owner: string): VideoTask[] {
  try {
    const rows = JSON.parse(localStorage.getItem(historyKey(owner)) || 'null');
    if (Array.isArray(rows)) return rows.filter(row => typeof row?.id === 'string');
    // One-time pickup of the single task the old page tracked.
    const legacy = JSON.parse(localStorage.getItem(`ipzsk.video.latest.v1.${owner}`) || 'null');
    return legacy && /^[0-9a-f-]{36}$/i.test(legacy.id) ? [legacy] : [];
  } catch { return []; }
}
export function saveHistory(owner: string, tasks: VideoTask[]) {
  try { localStorage.setItem(historyKey(owner), JSON.stringify(tasks.slice(0, HISTORY_LIMIT))); } catch {}
}

// An uncertain submission (network error, 5xx) reuses its key when retried with identical settings,
// so the backend never bills twice. A successful submission clears it, so "再生成一次" gets a new key.
function submissionKey(owner: string, body: string) {
  const key = historyKey(owner) + '.submission';
  let previous: any; try { previous = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  if (previous?.body === body && typeof previous.id === 'string') return previous.id as string;
  const id = crypto.randomUUID();
  try { localStorage.setItem(key, JSON.stringify({body, id})); } catch {}
  return id;
}

export async function submitVideo(session: Session, settings: Settings): Promise<VideoTask> {
  const model = session.models.find(m => m.id === settings.model) || session.models[0];
  const body = {model: model.id, prompt: settings.prompt.trim(), resolution: settings.resolution, duration: settings.duration};
  const serialized = JSON.stringify(body);
  const data = await json('/api/videos/generations', {method: 'POST', headers: {Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', 'Idempotency-Key': submissionKey(session.owner, serialized)}, body: serialized});
  const id = data?.data?.[0]?.task_id;
  if (typeof id !== 'string') throw new Error('服务没有返回有效的任务编号。');
  try { localStorage.removeItem(historyKey(session.owner) + '.submission'); } catch {}
  return {...body, id, status: 'submitted', progress: 0, modelName: model.name || model.id, createdAt: Date.now()};
}

function videoUrl(data: any) {
  const raw = data?.result?.videos?.[0]?.url;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return '';
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

// Returns the task with fresh status. Throws an Error with .status (401 = session expired).
export async function pollVideo(session: Session, task: VideoTask): Promise<VideoTask> {
  const response = await json(`/api/videos/tasks?task_id=${encodeURIComponent(task.id)}`, {headers: {Authorization: `Bearer ${session.token}`}});
  const data = response.data;
  const status = String(data?.status || task.status);
  const next: VideoTask = {...task, status, progress: Math.max(0, Math.min(100, Number(data?.progress) || 0)), note: undefined};
  if (status === 'completed') {
    next.url = videoUrl(data);
    if (!next.url) next.error = '任务已经完成，但没有取得可播放的视频地址，请到个人中心核对记录。';
  }
  if (status === 'failed' || status === 'cancelled') next.error = data?.error?.message || '生成服务没有完成这个任务，冻结金额会按后台结算状态处理。';
  return next;
}
