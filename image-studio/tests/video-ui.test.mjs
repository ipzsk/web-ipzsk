import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM, VirtualConsole} from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = (await build({
  entryPoints: [root + 'web/video/main.tsx'], bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"production"'},
})).outputFiles[0].text;

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(10); }
  assert.fail(message);
}
const TASK_A = '123e4567-e89b-42d3-a456-426614174000';
const TASK_B = '123e4567-e89b-42d3-a456-426614174001';
const MODEL = {id: 'seedance-2.0-mini', name: 'Seedance Mini', params: [{field: 'resolution', values: ['480p', '720p'], default: '720p'}, {field: 'duration', min: 1, max: 10, default: 5}]};

// server(url, options) handles /api/videos/*; signedIn controls the profile response.
function setup({signedIn = true, server = async () => ({}), storage = {}, session = {}} = {}) {
  const navigations = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (String(error.message).includes('navigation')) navigations.push(error.message); else console.error(error); });
  const dom = new JSDOM('<div id="video-root"></div>', {url: 'https://www.ipzsk.com/video', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole});
  const w = dom.window;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, JSON.stringify(value));
  for (const [key, value] of Object.entries(session)) w.sessionStorage.setItem(key, JSON.stringify(value));
  w.HTMLElement.prototype.scrollIntoView = () => {};
  const nativeTimeout = w.setTimeout.bind(w);
  w.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, Math.min(ms ?? 0, 10), ...args);
  w.requests = [];
  const reply = (status, body) => ({ok: status < 400, status, json: async () => body});
  w.fetch = async (url, options = {}) => {
    if (url.endsWith('/api/me/profile')) return signedIn ? reply(200, {user: {id: 'user-1', email_verified: true}}) : reply(401, {error: {code: 'customer_login_required'}});
    if (url.endsWith('/api/me/desktop/bootstrap')) return reply(200, {token: 'ipz_mock', video_models: [MODEL]});
    w.requests.push({url, options});
    const result = await server(url, options);
    return result.status ? reply(result.status, result.body) : reply(200, result);
  };
  w.eval(bundle);
  return {dom, w, document: w.document, navigations};
}
const button = (document, text) => {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent.trim().startsWith(text));
  assert.ok(found, `missing button: ${text}`);
  return found;
};
function type(w, value) {
  const field = w.document.querySelector('textarea');
  Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new w.Event('input', {bubbles: true}));
}
const generations = w => w.requests.filter(r => r.url === '/api/videos/generations');

test('signed out: full form, Cmd+Enter saves the draft and goes to login without a paid request', async () => {
  const {dom, w, document, navigations} = setup({signedIn: false});
  try {
    await until(() => document.querySelector('.notice')?.textContent.includes('登录后'), 'signed-out notice missing');
    assert.equal(document.querySelectorAll('.notice').length, 1);
    assert.equal(document.querySelector('select').disabled, true);
    assert.deepEqual([...document.querySelectorAll('.segmented button')].map(b => b.textContent), ['480P', '720P', '5 秒', '10 秒']);
    type(w, '橘猫伸懒腰');
    await pause(10);
    button(document, '10 秒').click();
    await pause(10);
    const textarea = document.querySelector('textarea');
    textarea.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, isComposing: true, bubbles: true}));
    await pause(10);
    assert.equal(navigations.length, 0, 'IME composition must not submit');
    textarea.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, bubbles: true}));
    await until(() => navigations.length === 1, 'did not navigate to login');
    assert.deepEqual(JSON.parse(w.sessionStorage.getItem('ipzsk.video.draft.v1')), {model: '', prompt: '橘猫伸懒腰', resolution: '480p', duration: 10});
    assert.equal(generations(w).length, 0);
  } finally { dom.window.close(); }
});

test('signed in: restores the draft, allows concurrent jobs and persists them', async () => {
  let n = 0;
  const {dom, w, document} = setup({
    session: {'ipzsk.video.draft.v1': {model: '', prompt: '橘猫伸懒腰', resolution: '480p', duration: 10}},
    server: async url => url.includes('/generations') ? {data: [{task_id: [TASK_A, TASK_B][n++]}]} : {data: {status: 'processing', progress: 40}},
  });
  try {
    await until(() => document.querySelector('select')?.value === MODEL.id, 'models did not load');
    assert.equal(document.querySelector('textarea').value, '橘猫伸懒腰');
    assert.equal(document.querySelector('[aria-pressed=true]').textContent, '480P');
    assert.equal(w.sessionStorage.getItem('ipzsk.video.draft.v1'), null);
    button(document, '开始生成视频').click();
    await until(() => document.querySelectorAll('.task-item').length === 1, 'first task missing');
    type(w, '第二个视频');
    await pause(10);
    button(document, '开始生成视频').click();
    await until(() => document.querySelectorAll('.task-item').length === 2, 'second task missing');
    const [first, second] = generations(w);
    assert.equal(JSON.parse(first.options.body).duration, 10);
    assert.notEqual(first.options.headers['Idempotency-Key'], second.options.headers['Idempotency-Key']);
    assert.equal(document.querySelector('.task-prompt').textContent, '第二个视频', 'newest first');
    await until(() => document.querySelector('.task-running small')?.textContent.startsWith('40%'), 'polling did not update progress');
    const saved = JSON.parse(w.localStorage.getItem('ipzsk.video.tasks.v1.user-1'));
    assert.deepEqual(saved.map(t => t.id), [TASK_B, TASK_A]);
  } finally { dom.window.close(); }
});

test('uncertain submission reuses its idempotency key; regenerate after success gets a new one', async () => {
  let fail = true;
  const {dom, w, document} = setup({
    storage: {'ipzsk.video.tasks.v1.user-1': [{id: TASK_A, status: 'completed', progress: 100, model: MODEL.id, modelName: 'Seedance Mini', prompt: 'cat', resolution: '720p', duration: 5, createdAt: 1, url: 'https://example.com/a.mp4'}]},
    server: async () => { if (fail) return {status: 503, body: {}}; return {data: [{task_id: TASK_B}]}; },
  });
  try {
    await until(() => document.querySelector('video'), 'history did not restore');
    button(document, '再生成一次').click();
    await until(() => document.querySelector('.form-error'), 'error not shown');
    button(document, '再生成一次').click();
    await until(() => generations(w).length === 2, 'retry not sent');
    fail = false;
    await pause(10);
    button(document, '再生成一次').click();
    await until(() => document.querySelectorAll('.task-item').length === 2, 'regenerated task missing');
    button(document, '再生成一次').click();
    await until(() => generations(w).length === 4, 'second regenerate not sent');
    const keys = generations(w).map(r => r.options.headers['Idempotency-Key']);
    assert.equal(keys[0], keys[1]);
    assert.equal(keys[1], keys[2]);
    assert.notEqual(keys[2], keys[3]);
  } finally { dom.window.close(); }
});

test('resumed task completes into a player with download, edit-retry and failed retry', async () => {
  const task = {model: MODEL.id, modelName: 'Seedance Mini', prompt: 'dog', resolution: '480p', duration: 10, createdAt: 1, progress: 0};
  const {dom, w, document} = setup({
    storage: {'ipzsk.video.tasks.v1.user-1': [{...task, id: TASK_A, status: 'processing'}, {...task, id: TASK_B, status: 'failed', error: '内容不合规'}]},
    server: async () => ({data: {status: 'completed', progress: 100, result: {videos: [{url: ['https://example.com/v.mp4']}]}}}),
  });
  try {
    await until(() => document.querySelector('video')?.getAttribute('src') === 'https://example.com/v.mp4', 'resumed task did not complete');
    assert.equal(document.querySelector('.task-actions a').href, 'https://example.com/v.mp4');
    assert.equal(document.querySelector('.task-error').textContent, '内容不合规');
    button(document, '重试');
    button(document, '改提示词重试').click();
    await pause(10);
    assert.equal(document.querySelector('textarea').value, 'dog');
    assert.equal(document.activeElement, document.querySelector('textarea'));
    assert.equal(document.querySelector('[aria-pressed=true]').textContent, '480P');
  } finally { dom.window.close(); }
});
