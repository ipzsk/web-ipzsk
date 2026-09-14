(() => {
  'use strict';

  const DATA_URL = 'https://gpt-image2.canghe.ai/cases.json';
  const IMAGE_BASE_URL = 'https://gpt-image2.canghe.ai/images/';
  const PUNK_DATA_URL = 'https://raw.githubusercontent.com/JayceHuang/dsh-imagegen/main/src/templates/punk-cases.json';
  const PUNK_IMAGES_URL = 'https://raw.githubusercontent.com/JayceHuang/dsh-imagegen/main/src/templates/punk-images.json';
  const TRANSLATE_URL = '/api/prompts/translate';
  const PAGE_SIZE = 32;
  let allCases = [];
  let visibleCount = PAGE_SIZE;
  let loaded = false;
  let translationTimer = 0;
  let activeTranslations = 0;
  const translationQueue = new Map();
  const englishPrompts = new Set();
  const translations = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ipzsk-prompt-translations-v1') || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  })();

  const overlay = document.createElement('section');
  overlay.className = 'inspiration-overlay hidden';
  overlay.setAttribute('aria-label', '生图灵感案例库');
  overlay.innerHTML = `
    <header class="inspiration-head">
      <div class="inspiration-head-copy"><h2>生图灵感案例</h2><p>优先显示中文提示词，也可查看英文原文并直接生成</p></div>
      <div class="inspiration-controls">
        <input id="caseSearch" class="inspiration-search" type="search" placeholder="搜索标题、Prompt、风格或用途" aria-label="搜索生图案例" />
        <select id="caseCategory" class="inspiration-select" aria-label="按分类筛选"><option value="">全部分类</option></select>
        <button id="caseClose" class="inspiration-close" type="button" aria-label="关闭案例库">×</button>
      </div>
    </header>
    <div class="inspiration-notice">案例整理自 <a href="https://github.com/freestylefly/awesome-gpt-image-2" target="_blank" rel="noreferrer">awesome-gpt-image-2</a> 与采用 MIT 协议的 <a href="https://github.com/adrianpunk/Punk-Skill" target="_blank" rel="noreferrer">Punk-Skill</a>，均保留作者与原始链接。部分内容来自第三方平台，商业使用前请自行核验授权。</div>
    <main class="inspiration-main">
      <div class="inspiration-status"><span id="caseStatus">正在加载案例…</span><span>可以编辑 Prompt，也可以一键直接生成</span></div>
      <div id="caseGrid" class="inspiration-grid"></div>
      <button id="caseMore" class="inspiration-more hidden" type="button">加载更多</button>
    </main>`;
  document.body.appendChild(overlay);

  const byId = id => document.getElementById(id);
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  const caseImageUrl = item => {
    if (item.previewUrl) return safeUrl(item.previewUrl);
    if (!item.image) return '';
    try {
      return new URL(item.image, item.image.startsWith('/') ? 'https://gpt-image2.canghe.ai' : IMAGE_BASE_URL).href;
    } catch {
      return '';
    }
  };
  const isChinese = value => /[\u3400-\u9fff]/.test(value || '');
  const caseKey = item => `${item.librarySource || 'canghe'}-${item.id}`;
  const promptFor = item => englishPrompts.has(caseKey(item)) ? item.prompt : (translations[caseKey(item)] || item.prompt);
  const saveTranslations = () => {
    try { localStorage.setItem('ipzsk-prompt-translations-v1', JSON.stringify(translations)); } catch {}
  };
  const applyTranslation = item => {
    const key = caseKey(item);
    const card = document.querySelector(`[data-case-id="${CSS.escape(key)}"]`);
    if (!card || englishPrompts.has(key)) return;
    const prompt = card.querySelector('.case-prompt');
    const button = card.querySelector('.case-language');
    if (translations[key]) {
      prompt.textContent = translations[key];
      prompt.title = translations[key];
      prompt.classList.remove('translating');
      button.textContent = '查看英文原文';
      button.disabled = false;
    }
  };
  const flushTranslations = async () => {
    translationTimer = 0;
    if (activeTranslations >= 2) {
      translationTimer = window.setTimeout(flushTranslations, 200);
      return;
    }
    const items = [...translationQueue.values()].slice(0, 4);
    items.forEach(item => translationQueue.delete(caseKey(item)));
    if (!items.length) return;
    activeTranslations += 1;
    if (translationQueue.size && !translationTimer) translationTimer = window.setTimeout(flushTranslations, 120);
    try {
      const ids = encodeURIComponent(items.map(item => item.id).join(','));
      const response = await fetch(`${TRANSLATE_URL}?v=1&ids=${ids}`);
      const payload = await response.json();
      if (!response.ok || !payload.translations) throw new Error('translation_failed');
      items.forEach(item => {
        const translated = payload.translations[item.id];
        if (translated) translations[caseKey(item)] = translated;
      });
      saveTranslations();
      items.forEach(applyTranslation);
    } catch {
      items.forEach(item => {
        const card = document.querySelector(`[data-case-id="${CSS.escape(caseKey(item))}"]`);
        if (!card) return;
        const prompt = card.querySelector('.case-prompt');
        const button = card.querySelector('.case-language');
        prompt.classList.remove('translating');
        prompt.textContent = item.prompt;
        prompt.title = item.prompt;
        button.textContent = '重试中文翻译';
        button.disabled = false;
      });
    } finally {
      activeTranslations -= 1;
      if (translationQueue.size && !translationTimer) translationTimer = window.setTimeout(flushTranslations, 120);
    }
  };
  const queueTranslation = item => {
    if (isChinese(item.prompt) || translations[caseKey(item)]) return;
    translationQueue.set(caseKey(item), item);
    if (!translationTimer) translationTimer = window.setTimeout(flushTranslations, 80);
  };
  const filteredCases = () => {
    const query = byId('caseSearch').value.trim().toLowerCase();
    const category = byId('caseCategory').value;
    return allCases.filter(item => {
      if (category && item.category !== category) return false;
      if (!query) return true;
      return [item.title, item.prompt, translations[caseKey(item)], item.categoryZh, item.category, ...(item.styles || []), ...(item.scenes || [])]
        .join(' ').toLowerCase().includes(query);
    });
  };
  const makeButton = (label, className, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };
  const render = () => {
    const matches = filteredCases();
    const shown = matches.slice(0, visibleCount);
    const grid = byId('caseGrid');
    grid.replaceChildren();
    byId('caseStatus').textContent = `找到 ${matches.length} 个案例，已显示 ${shown.length} 个`;

    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'inspiration-empty';
      empty.textContent = '没有找到匹配案例，换个关键词试试。';
      grid.appendChild(empty);
    }

    shown.forEach(item => {
      const article = document.createElement('article');
      article.className = 'case-card';
      article.dataset.caseId = caseKey(item);
      const imageWrap = document.createElement('div');
      imageWrap.className = 'case-image';
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.alt = `${item.title}案例预览`;
      image.src = caseImageUrl(item);
      image.addEventListener('error', () => imageWrap.remove());
      imageWrap.appendChild(image);

      const body = document.createElement('div');
      body.className = 'case-body';
      const category = document.createElement('span');
      category.className = 'case-category';
      category.textContent = item.categoryZh || item.category || '灵感案例';
      const title = document.createElement('h3');
      title.textContent = item.title;
      const prompt = document.createElement('p');
      prompt.className = 'case-prompt';
      const needsTranslation = !isChinese(item.prompt) && !translations[caseKey(item)];
      const shownPrompt = promptFor(item);
      prompt.textContent = needsTranslation ? '中文提示词翻译中…' : shownPrompt;
      prompt.title = needsTranslation ? '' : shownPrompt;
      prompt.classList.toggle('translating', needsTranslation);
      const meta = document.createElement('div');
      meta.className = 'case-meta';
      const author = document.createElement('span');
      author.textContent = item.sourceLabel || '原作者';
      const sourceUrl = safeUrl(item.sourceUrl || item.githubUrl);
      if (sourceUrl) {
        const source = document.createElement('a');
        source.className = 'case-source';
        source.href = sourceUrl;
        source.target = '_blank';
        source.rel = 'noreferrer';
        source.textContent = '查看出处 ↗';
        meta.append(author, source);
      } else {
        meta.append(author);
      }

      const actions = document.createElement('div');
      actions.className = 'case-actions';
      const language = makeButton(isChinese(item.prompt) ? '中文提示词' : (translations[caseKey(item)] ? '查看英文原文' : '中文翻译中…'), 'case-language', () => {
        const id = caseKey(item);
        if (!translations[id]) {
          language.disabled = true;
          language.textContent = '中文翻译中…';
          prompt.textContent = '中文提示词翻译中…';
          prompt.classList.add('translating');
          queueTranslation(item);
          return;
        }
        if (englishPrompts.has(id)) englishPrompts.delete(id); else englishPrompts.add(id);
        const value = promptFor(item);
        prompt.textContent = value;
        prompt.title = value;
        language.textContent = englishPrompts.has(id) ? '查看中文译文' : '查看英文原文';
      });
      language.disabled = isChinese(item.prompt) || needsTranslation;
      actions.append(
        language,
        makeButton('复制提示词', 'case-copy', async () => {
          try {
            await navigator.clipboard.writeText(promptFor(item));
            byId('toast').textContent = '提示词已复制';
            byId('toast').classList.add('show');
            setTimeout(() => byId('toast').classList.remove('show'), 2200);
          } catch {
            window.prompt('复制下面的提示词', promptFor(item));
          }
        }),
        makeButton('编辑后生成', 'case-use', () => {
          if (typeof window.ipzskUseTemplate === 'function') window.ipzskUseTemplate(promptFor(item), item.title, false);
          closeLibrary();
        }),
        makeButton('直接生成', 'case-direct', () => {
          if (typeof window.ipzskUseTemplate === 'function') window.ipzskUseTemplate(promptFor(item), item.title, true);
          closeLibrary();
        })
      );
      body.append(category, title, prompt, meta, actions);
      article.append(imageWrap, body);
      grid.appendChild(article);
      if (needsTranslation) queueTranslation(item);
    });
    byId('caseMore').classList.toggle('hidden', shown.length >= matches.length);
  };
  const loadCases = async () => {
    if (loaded) return;
    try {
      const [caseResponse, punkResponse, punkImagesResponse] = await Promise.all([
        fetch(DATA_URL),
        fetch(PUNK_DATA_URL),
        fetch(PUNK_IMAGES_URL),
      ]);
      if (!caseResponse.ok || !punkResponse.ok || !punkImagesResponse.ok) throw new Error('load_failed');
      const [payload, punkPayload, punkImages] = await Promise.all([
        caseResponse.json(),
        punkResponse.json(),
        punkImagesResponse.json(),
      ]);
      const unique = new Map();
      const cases = [
        ...(payload.cases || []).map(item => ({ ...item, librarySource: 'canghe' })),
        ...(punkPayload.cases || []).map(item => ({ ...item, librarySource: 'punk', previewUrl: punkImages[item.image] || '' })),
      ];
      for (const item of cases) {
        if (item && typeof item.prompt === 'string' && item.prompt.trim() && !unique.has(item.prompt)) unique.set(item.prompt, item);
      }
      allCases = [...unique.values()];
      const categories = [...new Map(allCases.map(item => [item.category, item.categoryZh || item.category])).entries()]
        .filter(([value]) => value).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
      for (const [value, label] of categories) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        byId('caseCategory').appendChild(option);
      }
      loaded = true;
      render();
    } catch {
      byId('caseStatus').textContent = '案例库暂时无法加载，请稍后重试。';
      byId('caseGrid').innerHTML = '<div class="inspiration-empty">网络连接失败，关闭后可以继续使用封面与头像风格。</div>';
    }
  };
  const openLibrary = () => {
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadCases();
  };
  const closeLibrary = () => {
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  };

  byId('inspirationTab').addEventListener('click', openLibrary);
  byId('caseClose').addEventListener('click', closeLibrary);
  byId('caseSearch').addEventListener('input', () => { visibleCount = PAGE_SIZE; render(); });
  byId('caseCategory').addEventListener('change', () => { visibleCount = PAGE_SIZE; render(); });
  byId('caseMore').addEventListener('click', () => { visibleCount += PAGE_SIZE; render(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.classList.contains('hidden')) closeLibrary(); });
})();
