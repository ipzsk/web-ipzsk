import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {loginUrl} from '../../../api.js';
import {DRAFT_KEY, HISTORY_LIMIT, isActive, loadHistory, modelOptions, pollVideo, saveHistory, signIn, submitVideo} from './api';
import type {Model, Session, Settings, VideoTask} from './api';

type Notice = {text: string; error?: boolean; link?: boolean} | null;
const POLL_MS = 8000;
const statusLabel: Record<string, string> = {submitted: '已提交', pending: '排队中', queued: '排队中', processing: '生成中', completed: '已完成', failed: '失败', cancelled: '已取消'};
const statusCopy = (status: string) => ({submitted: '任务已提交，正在等待生成资源。', pending: '任务正在排队，请耐心等待。', queued: '任务正在排队，请耐心等待。', processing: '模型正在生成画面，通常需要几分钟。'} as Record<string, string>)[status] || '正在读取任务进度。';
const walletChanged = () => window.dispatchEvent(new Event('ipzsk-wallet-changed'));

function readDraft(): Partial<Settings> | null {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
// Keeps the draft's values only where the chosen model allows them.
function fit(models: Model[], draft: Partial<Settings> = {}): Settings {
  const model = models.find(m => m.id === draft.model) || models[0];
  const options = modelOptions(model);
  return {
    model: model?.id || '', prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    resolution: options.resolutions.includes(String(draft.resolution)) ? String(draft.resolution) : options.defaultResolution,
    duration: options.durations.includes(Number(draft.duration)) ? Number(draft.duration) : options.defaultDuration,
  };
}

function Segmented<T extends string | number>({label, values, value, format, onChange}: {label: string; values: T[]; value: T; format: (v: T) => string; onChange: (v: T) => void}) {
  return <div className="setting"><span>{label}</span><div className="segmented" role="group" aria-label={label}>
    {values.map(v => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{format(v)}</button>)}
  </div></div>;
}

function App() {
  const [auth, setAuth] = useState<'loading' | 'out' | 'ready' | 'error'>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<Notice>({text: '正在确认登录状态和可用模型…'});
  const [form, setForm] = useState<Settings>(() => fit([], readDraft() || {}));
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{text: string; where: 'form' | 'list'} | null>(null);
  const [copied, setCopied] = useState('');
  const [expired, setExpired] = useState(false);
  const busy = useRef(false);
  const tasksRef = useRef(tasks); tasksRef.current = tasks;
  const formRef = useRef<HTMLFormElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    signIn().then(value => {
      if (!value) {
        setAuth('out');
        setNotice({text: '登录后即可用账户余额生成视频。可以先写好提示词，点击生成会带你去登录，回来后内容仍在。'});
        return;
      }
      setSession(value);
      setForm(fit(value.models, readDraft() || {}));
      try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
      setTasks(loadHistory(value.owner));
      setAuth('ready'); setNotice(null);
    }).catch((e: any) => { setAuth('error'); setNotice({text: e.message, error: true, link: Boolean(e.login)}); });
  }, []);

  useEffect(() => { if (session) saveHistory(session.owner, tasks); }, [session, tasks]);

  const update = (next: VideoTask) => setTasks(rows => rows.map(row => row.id === next.id ? next : row));
  const hasActive = tasks.some(isActive);
  useEffect(() => {
    if (!session || !hasActive || expired) return;
    let stopped = false, timer = 0;
    const tick = async () => {
      for (const task of tasksRef.current.filter(isActive)) {
        try {
          const next = await pollVideo(session, task);
          if (stopped) return;
          update(next);
          if (!isActive(next)) walletChanged();
        } catch (e: any) {
          if (stopped) return;
          if (e.status === 401) { setExpired(true); setNotice({text: '登录已失效，请重新登录后继续查看任务。', error: true, link: true}); return; }
          update({...task, note: `${e.message} 将自动重试。`});
        }
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [session, hasActive, expired]);

  async function generate(settings: Settings, where: 'form' | 'list') {
    if (auth === 'out') {
      try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(settings)); } catch {}
      location.assign(loginUrl('/video'));
      return;
    }
    if (!session || busy.current || !settings.prompt.trim()) return;
    busy.current = true; setSubmitting(true); setError(null);
    try {
      const task = await submitVideo(session, settings);
      setTasks(rows => [task, ...rows.filter(row => row.id !== task.id)].slice(0, HISTORY_LIMIT));
      walletChanged();
    } catch (e: any) {
      setError({text: e.message, where});
    } finally { busy.current = false; setSubmitting(false); }
  }

  function editRetry(task: VideoTask) {
    setForm(fit(session?.models || [], task));
    promptRef.current?.scrollIntoView({block: 'center', behavior: 'smooth'});
    promptRef.current?.focus({preventScroll: true});
  }
  async function copyPrompt(task: VideoTask) {
    try { await navigator.clipboard.writeText(task.prompt); setCopied(task.id); setTimeout(() => setCopied(''), 1500); } catch {}
  }

  const models = session?.models || [];
  const model = models.find(m => m.id === form.model);
  const options = modelOptions(model);
  const settings = (task: VideoTask): Settings => ({model: task.model, prompt: task.prompt, resolution: task.resolution, duration: task.duration});
  const running = tasks.filter(isActive).length;
  const blocked = auth === 'loading' || auth === 'error' || submitting;

  return <>
    <section className="workspace">
      <form ref={formRef} className="generator-card" onSubmit={event => { event.preventDefault(); void generate(form, 'form'); }}>
        <div className="card-heading"><div><span>01</span><h2>描述这一帧之后</h2></div><small>{model?.name || model?.id || ''}</small></div>
        <label className="prompt-field">视频提示词
          <textarea ref={promptRef} name="prompt" rows={8} maxLength={32000} required value={form.prompt}
            placeholder="例如：一只橘猫在清晨的窗边慢慢伸懒腰，柔和逆光，镜头缓慢推进，电影质感"
            onChange={event => setForm({...form, prompt: event.target.value})}
            onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); formRef.current?.requestSubmit(); } }} />
          <span><b>{[...form.prompt].length}</b> / 32000</span>
        </label>
        <div className="settings-grid">
          <label>生成模型
            <select name="model" value={form.model} disabled={!models.length} onChange={event => setForm(fit(models, {...form, model: event.target.value}))}>
              {models.length ? models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>) : <option value="">{auth === 'loading' ? '正在读取模型…' : '登录后显示可用模型'}</option>}
            </select>
          </label>
          <Segmented label="清晰度" values={options.resolutions} value={form.resolution} format={v => v.toUpperCase()} onChange={resolution => setForm({...form, resolution})} />
          <Segmented label="视频时长" values={options.durations} value={form.duration} format={v => `${v} 秒`} onChange={duration => setForm({...form, duration})} />
        </div>
        <div className="billing-note"><span>账户计费</span><p>费用以后台当前计费配置和个人中心记录为准。启用计费时，提交会冻结预估金额，任务结束后结算或释放。</p></div>
        {notice && <div className={'notice' + (notice.error ? ' error' : '')} role="status">
          {notice.text}{notice.link && <> <a href={loginUrl('/video')}>前往登录 ↗</a></>}
        </div>}
        <button className="generate-button" type="submit" disabled={blocked}>
          {submitting ? '正在提交… ' : auth === 'out' ? '登录并生成视频 ' : '开始生成视频 '}<span>↗</span>
        </button>
        <small className="shortcut-hint">⌘/Ctrl + Enter 快速提交，可同时生成多个视频</small>
        {error?.where === 'form' && <p className="form-error" role="alert">{error.text}</p>}
      </form>
      <section className="result-card" aria-live="polite">
        <div className="card-heading"><div><span>02</span><h2>生成记录</h2></div><small>{tasks.length ? `${tasks.length} 个任务${running ? ` · ${running} 个进行中` : ''}` : '等待提交'}</small></div>
        {error?.where === 'list' && <p className="form-error" role="alert">{error.text}</p>}
        {!tasks.length ? <div className="empty-result"><div className="frame-mark">▶</div><strong>视频会出现在这里</strong><p>提交后可留在页面查看进度或稍后回来，最近 {HISTORY_LIMIT} 条记录保存在本浏览器。</p></div>
          : <ol className="task-list">{tasks.map(task => {
            const done = task.status === 'completed' && task.url;
            return <li key={task.id} className={'task-item status-' + task.status}>
              <div className="task-meta"><b>{statusLabel[task.status] || task.status}</b><small>{task.modelName || task.model} · {String(task.resolution).toUpperCase()} · {task.duration} 秒 · {new Date(task.createdAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}</small></div>
              <p className="task-prompt">{task.prompt}</p>
              {isActive(task) && <div className="task-running">
                <div className="progress-track"><i style={{width: `${Math.max(4, task.progress || 0)}%`}} /></div>
                <small>{task.progress || 0}% · {task.note || statusCopy(task.status)}</small>
              </div>}
              {done && <video src={task.url} controls playsInline preload="metadata" />}
              {!isActive(task) && task.error && <p className="task-error">{task.error}</p>}
              {!isActive(task) && <div className="task-actions">
                {done && <a href={task.url} target="_blank" rel="noopener noreferrer" download>下载 / 打开原视频 ↗</a>}
                {done ? <button type="button" disabled={blocked} onClick={() => void generate(settings(task), 'list')}>再生成一次</button>
                  : <button type="button" disabled={blocked} onClick={() => void generate(settings(task), 'list')}>重试</button>}
                <button type="button" onClick={() => editRetry(task)}>改提示词重试</button>
                <button type="button" onClick={() => void copyPrompt(task)}>{copied === task.id ? '已复制' : '复制提示词'}</button>
              </div>}
            </li>;
          })}</ol>}
      </section>
    </section>
  </>;
}

createRoot(document.getElementById('video-root')!).render(<App />);
