import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: {
    contents: `import {createElement} from 'react';
      import {createRoot} from 'react-dom/client';
      import {BeginnerStudio} from './web/BeginnerStudio';
      const root = createRoot(document.getElementById('studio'));
      root.render(createElement(BeginnerStudio, {api: window.testApi, onAdvanced: () => {window.advancedOpened = true;}}));
      window.unmountStudio = () => root.unmount();`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  loader: {'.css': 'empty'},
  define: {'process.env.NODE_ENV': '"production"'},
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const copy = value => structuredClone(value);
const imageBytes = 'generated-image';
const imageB64 = Buffer.from(imageBytes).toString('base64');
const imageUrl = `data:image/png;base64,${imageB64}`;
const secondImageBytes = 'second-generated-image';
const secondImageUrl = `data:image/jpeg;base64,${Buffer.from(secondImageBytes).toString('base64')}`;

async function until(predicate, message) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail(message);
}

function fakeApi(initialHistory = []) {
  return {
    requests: [], tasks: [], history: copy(initialHistory), submitGate: null,
    async historyList() {return copy(this.history);},
    async taskList() {return copy(this.tasks);},
    async taskSubmit(request) {
      this.requests.push(copy(request));
      const task = {id: `task-${this.requests.length}`, status: 'running', createdAt: Date.now(), request: copy(request)};
      this.tasks.unshift(task);
      if (this.submitGate) await this.submitGate;
      return copy(task);
    },
    complete(chargedPoints = '0') {
      const task = this.tasks[0];
      assert.ok(task, 'a task must be submitted before completion');
      const {image, images, ...request} = task.request;
      const entry = {...request, id: `work-${task.id}`, createdAt: Date.now(), images: [{url: imageUrl}], billing: {charged_points: chargedPoints}};
      this.history.unshift(entry);
      Object.assign(task, {
        status: 'completed', finishedAt: Date.now(), billing: entry.billing,
        result: {images: [{mime: 'image/png', b64: imageB64}], history: [copy(entry)]},
      });
    },
  };
}

async function environment(api = fakeApi(), {mobile = false} = {}) {
  const dom = new JSDOM('<div id="studio"></div>', {
    url: 'https://www.ipzsk.com/image.html', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  w.testApi = api;
  w.scrollCalls = [];
  w.HTMLElement.prototype.scrollIntoView = function (options) {w.scrollCalls.push({element: this, options});};
  w.matchMedia = query => ({matches: mobile, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {return true;}});
  const nativeTimeout = w.setTimeout.bind(w);
  w.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, ms === 1000 ? 10 : ms, ...args);
  w.imageFetches = [];
  w.fetch = async url => {
    w.imageFetches.push(url);
    const image = new Map([[imageUrl, [imageBytes, 'image/png']], [secondImageUrl, [secondImageBytes, 'image/jpeg']]]).get(url);
    assert.ok(image, 'editing must read one of the generated fixture images');
    return {ok: true, blob: async () => new w.Blob([image[0]], {type: image[1]})};
  };
  w.eval(bundle.outputFiles[0].text);
  await until(() => w.document.querySelector('[data-beginner-studio]'), 'studio did not render');
  await pause(20);
  const originalClose = dom.window.close.bind(dom.window);
  dom.window.close = () => {w.unmountStudio(); originalClose();};
  return {dom, w, api, document: w.document};
}

function button(document, text) {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
  assert.ok(found, `missing button: ${text}`);
  return found;
}

async function choose(document, title) {
  const card = [...document.querySelectorAll('.easy-effect')].find(item => item.querySelector('strong')?.textContent === title);
  assert.ok(card, `missing effect: ${title}`);
  card.click();
  await until(() => document.querySelector('.easy-form h1')?.textContent === title, `effect ${title} did not open`);
}

async function input(w, selector, value) {
  const field = w.document.querySelector(selector);
  assert.ok(field, `missing field: ${selector}`);
  const prototype = field.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
  field.dispatchEvent(new w.Event('input', {bubbles: true}));
  await pause(10);
}

async function generateCover(context) {
  const {w, api, document} = context;
  await choose(document, '文章封面');
  await input(w, '#easy-title', '给新手的摄影入门指南');
  document.querySelector('.easy-submit').click();
  await until(() => api.requests.length === 1, 'cover generation was not submitted');
  await until(() => document.querySelector('.easy-progress'), 'generation progress did not show');
}

test('beginners start with four visual choices and no exposed prompt or model controls', async () => {
  const {dom, document} = await environment();
  try {
    assert.deepEqual([...document.querySelectorAll('.easy-effect strong')].map(item => item.textContent), ['照片变手绘', '文章封面', '宣传海报', '自由描述画面']);
    assert.equal(document.querySelector('[aria-label="生图模型"]'), null);
    assert.equal(document.querySelector('[aria-label="完整提示词"]'), null);
    button(document, '看看更多风格 ＋').click();
    await until(() => document.querySelectorAll('.easy-effect').length === 8, 'extra styles did not expand');
    await choose(document, '文章封面');
    assert.equal(document.querySelector('[aria-label="生图模型"]').closest('details').open, false);
    assert.equal(document.querySelector('[aria-label="完整提示词"]').closest('details').open, false);
  } finally {dom.window.close();}
});

test('a photo effect cannot submit a paid request until a photo is supplied', async () => {
  const {dom, document, api} = await environment();
  try {
    await choose(document, '照片变手绘');
    document.querySelector('.easy-submit').click();
    await until(() => document.querySelector('[role="alert"]'), 'missing-photo explanation did not appear');
    assert.match(document.querySelector('[role="alert"]').textContent, /照片/);
    assert.equal(api.requests.length, 0);
    assert.equal(api.tasks.length, 0);
  } finally {dom.window.close();}
});

test('cover generation uses the default model and prevents duplicate submits through completion', async () => {
  const api = fakeApi();
  let release;
  api.submitGate = new Promise(resolve => {release = resolve;});
  const context = await environment(api);
  const {dom, w, document} = context;
  try {
    await choose(document, '文章封面');
    await input(w, '#easy-title', '原样保留“标题” $5');
    const form = document.querySelector('.easy-form');
    form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    assert.equal(api.requests.length, 1, 'the submission lock must also cover the asynchronous submission itself');
    assert.equal(api.requests[0].model, 'gpt-image-2');
    assert.equal(api.requests[0].n, 1);
    assert.equal(api.requests[0].mode, 'text');
    assert.equal(api.requests[0].size, '16:9');
    assert.match(api.requests[0].prompt, /原样保留“标题” \$5/);
    assert.equal(api.requests[0].image, undefined);
    release();
    await until(() => document.querySelector('.easy-progress'), 'running progress did not show');
    assert.equal(document.querySelector('.easy-submit').disabled, true);
    assert.equal(document.querySelector('.easy-form fieldset').disabled, true);
    form.dispatchEvent(new w.Event('submit', {bubbles: true, cancelable: true}));
    assert.equal(api.requests.length, 1, 'running tasks must remain protected from a second request');
    api.complete('0');
    await until(() => document.querySelector('.easy-result'), 'completed result did not appear');
    const metadata = document.querySelector('.easy-result-meta');
    assert.match(metadata.textContent, /本次消耗 0 点/);
    assert.match(metadata.textContent, /GPT Image 2/);
    assert.ok(!metadata.textContent.includes('点数结算中'));
    const settings = document.querySelector('[aria-label="生图模型"]');
    settings.closest('details').open = true;
    settings.value = 'gemini-3.1-flash-image-preview';
    settings.dispatchEvent(new w.Event('change', {bubbles: true}));
    await pause(10);
    assert.match(metadata.textContent, /GPT Image 2/);
    assert.ok(!metadata.textContent.includes('Gemini'), 'completed billing metadata must use the task model');
    const original = copy(api.requests[0]);
    button(document, '再生成一张').click();
    await until(() => api.requests.length === 2, 'regeneration was not submitted');
    assert.deepEqual(api.requests[1], original, 'regeneration must reuse the original task parameters');
  } finally {release(); dom.window.close();}
});

test('editing a generated image sends that image as reference and retains its model and dimensions', async () => {
  const context = await environment();
  const {dom, w, api, document} = context;
  try {
    await generateCover(context);
    api.complete('8.25');
    await until(() => document.querySelector('.easy-result'), 'completed result did not appear');
    button(document, '修改这张图').click();
    await until(() => document.querySelector('#easy-edit'), 'edit field did not appear');
    await input(w, '#easy-edit', '背景换成浅蓝色');
    button(document, '按这个要求修改').click();
    await until(() => api.requests.length === 2, 'image edit was not submitted');
    const request = api.requests[1];
    assert.equal(request.mode, 'edit');
    assert.equal(request.model, api.requests[0].model);
    assert.equal(request.size, api.requests[0].size);
    assert.equal(request.quality, api.requests[0].quality);
    assert.equal(request.n, 1);
    assert.equal(request.image, imageUrl);
    assert.match(request.prompt, /背景换成浅蓝色/);
    assert.match(request.prompt, /保留未要求修改/);
  } finally {dom.window.close();}
});

test('mobile generation brings the progress area into view', async () => {
  const context = await environment(fakeApi(), {mobile: true});
  const {dom, w, document} = context;
  try {
    await generateCover(context);
    await until(() => w.scrollCalls.length > 0, 'mobile progress did not scroll into view');
    const progressScroll = w.scrollCalls.find(call => call.element === document.querySelector('.easy-preview'));
    assert.ok(progressScroll, 'the generated image preview area should receive the scroll');
    assert.equal(progressScroll.options.block, 'start');
    const leaving = new w.Event('beforeunload', {cancelable: true});
    assert.equal(w.dispatchEvent(leaving), true, 'durable tasks should not prevent leaving the page');
    assert.equal(leaving.defaultPrevented, false);
    assert.match(document.querySelector('.easy-progress').textContent, /刷新或重新打开本页后可恢复进度/);
  } finally {dom.window.close();}
});

function apiWithRecoverableTask(status, state) {
  const api = fakeApi();
  api.tasks = [{id: 'original-task', status, createdAt: 1000, error: '上次连接已中断', request: {mode: 'text', model: 'gpt-image-2', prompt: '原来的创作描述', n: 1, size: '1:1'}, submissions: [{key: 'durable-key', state, ...(state === 'accepted' ? {taskId: 'server-task'} : {})}]}];
  api.retries = [];
  api.taskRetry = async function (id) {
    this.retries.push(id);
    const task = this.tasks.find(item => item.id === id);
    assert.ok(task, 'recovery must reference an existing task');
    task.status = 'running';
    return copy(task);
  };
  return api;
}

for (const [status, state] of [['failed', 'submitting'], ['cancelled', 'accepted']]) {
  test(`${status} tasks with uncertain submissions restore a query action and never create a replacement request`, async () => {
    const api = apiWithRecoverableTask(status, state);
    const {dom, w, document} = await environment(api);
    try {
      await until(() => document.querySelector('[aria-label="未完成任务"]'), 'unfinished task notice did not restore');
      assert.equal(api.requests.length, 0);
      assert.equal(api.retries.length, 0, 'reopening a failed task requires an explicit resume click');
      assert.match(document.querySelector('.easy-submit').textContent, /继续查询原任务/);
      button(document, '← 换个效果').click();
      await until(() => document.querySelector('.easy-effects'), 'effect selection did not open');
      await choose(document, '照片变手绘');
      assert.ok(document.querySelector('[aria-label="未完成任务"]'), 'choosing another effect must retain the unresolved task');
      const submit = document.querySelector('.easy-submit');
      assert.equal(submit.type, 'button', 'querying an existing task must not be blocked by new-form validation');
      submit.click();submit.click();
      await until(() => api.retries.length === 1, 'primary action did not resume the original task');
      assert.deepEqual(api.retries, ['original-task']);
      assert.equal(api.requests.length, 0, 'resume must not call taskSubmit even after changing the form');
      api.complete('2.5');
      await until(() => document.querySelector('.easy-result'), 'resumed task did not display its result');
      assert.equal(document.querySelector('[aria-label="未完成任务"]'), null);
      assert.equal(document.querySelector('.easy-result > img').src, imageUrl);
    } finally {dom.window.close();}
  });
}

test('confirmed failed images expose a paid retry action that keeps the original task identity', async () => {
  const api = apiWithRecoverableTask('failed', 'failed');
  const {dom, document} = await environment(api);
  try {
    const recovery = document.querySelector('[aria-label="未完成任务"]');
    assert.ok(recovery);
    assert.match(recovery.textContent, /重新生成未完成图片会按实际消耗扣点/);
    button(document, '重试未完成图片').click();
    await until(() => api.retries.length === 1, 'failed-image retry did not run');
    assert.deepEqual(api.retries, ['original-task']);
    assert.equal(api.requests.length, 0);
  } finally {dom.window.close();}
});

test('a multi-image history entry downloads and edits the selected image with its original settings', async () => {
  const api = fakeApi([{
    id: 'old-multi-edit', mode: 'edit', prompt: '把照片变成手绘作品', model: 'gemini-3.1-flash-image-preview',
    size: '3:4', quality: '2k', createdAt: 1000, images: [{url: imageUrl}, {url: secondImageUrl}], billing: {charged_points: '8.5'},
  }]);
  const {dom, w, document} = await environment(api);
  try {
    const historyButton = [...document.querySelectorAll('button')].find(item => item.textContent.startsWith('我的作品'));
    assert.ok(historyButton);
    historyButton.click();
    await until(() => document.querySelector('[aria-label^="查看作品："]'), 'multi-image historical work did not appear');
    document.querySelector('[aria-label^="查看作品："]').click();
    await until(() => document.querySelector('.easy-result'), 'multi-image historical work did not open');
    assert.equal(document.querySelectorAll('.easy-image-tabs button').length, 2);
    assert.equal(document.querySelector('.easy-result > img').src, imageUrl);
    assert.equal(document.querySelector('[aria-label="第 1 张图片"]').getAttribute('aria-pressed'), 'true');
    document.querySelector('[aria-label="第 2 张图片"]').click();
    await until(() => document.querySelector('.easy-result > img').src === secondImageUrl, 'second image did not become the current preview');
    assert.equal(document.querySelector('[aria-label="第 2 张图片"]').getAttribute('aria-pressed'), 'true');
    const download = document.querySelector('.easy-result-actions a[download]');
    assert.equal(download.href, secondImageUrl);
    assert.equal(download.download, 'IPZSK-old-multi-edit-2.jpg');
    assert.equal(api.requests.length, 0, 'selecting and downloading a history image must not submit generation');
    button(document, '修改这张图').click();
    await until(() => document.querySelector('#easy-edit'), 'history image edit field did not appear');
    await input(w, '#easy-edit', '把背景改成绿色');
    button(document, '按这个要求修改').click();
    await until(() => api.requests.length === 1, 'selected history image edit was not submitted');
    assert.deepEqual(w.imageFetches, [secondImageUrl]);
    const request = api.requests[0];
    assert.equal(request.image, secondImageUrl);
    assert.equal(request.mode, 'edit');
    assert.equal(request.model, 'gemini-3.1-flash-image-preview');
    assert.equal(request.size, '3:4');
    assert.equal(request.quality, '2k');
    assert.equal(request.n, 1);
    assert.match(request.prompt, /把背景改成绿色/);
  } finally {dom.window.close();}
});

test('remaking an old photo-based work asks for its missing reference instead of silently charging', async () => {
  const api = fakeApi([{
    id: 'old-edit', mode: 'edit', prompt: '把照片变成像素头像', model: 'gemini-3.1-flash-image-preview',
    size: '1:1', quality: '2k', createdAt: 1000, images: [{url: imageUrl}], billing: {charged_points: '3.75'},
  }]);
  const {dom, document} = await environment(api);
  try {
    const historyButton = [...document.querySelectorAll('button')].find(item => item.textContent.startsWith('我的作品'));
    assert.ok(historyButton);
    historyButton.click();
    await until(() => document.querySelector('[aria-label^="查看作品："]'), 'historical work did not appear');
    document.querySelector('[aria-label^="查看作品："]').click();
    await until(() => document.querySelector('.easy-result'), 'historical work did not open');
    assert.match(document.querySelector('.easy-result-meta').textContent, /Gemini 生图.*3.75 点/);
    button(document, '重新制作').click();
    await until(() => document.querySelector('.easy-toast'), 'missing-reference notice did not appear');
    assert.equal(api.requests.length, 0);
    assert.equal(document.querySelector('#easy-description').value, '把照片变成像素头像');
    assert.match(document.querySelector('.easy-toast').textContent, /原参考照片.*重新上传/);
    assert.equal(document.querySelector('.easy-result'), null);
  } finally {dom.window.close();}
});
