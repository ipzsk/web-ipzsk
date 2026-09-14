const platformLabels = {
  mac: 'Mac ARM64',
  'mac-intel': 'Mac x64',
  windows: 'Windows x64',
};

const trigger = document.querySelector('#downloadTrigger');
const control = trigger?.closest('.download-control');
const status = document.querySelector('#releaseStatus');
const deviceHint = document.querySelector('#deviceHint');
const fallbackReleaseUrl = 'https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/latest';
const rotatingPhrase = document.querySelector('#rotatingPhrase');
const phrases = ['帮你生图', '帮你生视频', '帮你生产内容'];

function detectedPlatform() {
  const ua = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return ua.includes('arm') || ua.includes('apple') ? 'mac' : 'mac-intel';
  return '';
}

function closeMenu() {
  control?.classList.remove('is-open');
  trigger?.setAttribute('aria-expanded', 'false');
}

function toggleMenu() {
  const open = !control.classList.contains('is-open');
  control.classList.toggle('is-open', open);
  trigger.setAttribute('aria-expanded', String(open));
}

function setOption(platform, asset, version, fallbackUrl) {
  const option = document.querySelector(`[data-platform="${platform}"]`);
  if (!option) return;
  const action = option.querySelector('.platform-action');
  const url = asset?.url || fallbackUrl || fallbackReleaseUrl;
  option.href = url;
  option.removeAttribute('aria-disabled');
  action.textContent = asset ? `下载 v${version} ↓` : '前往发布页 ↗';
  option.title = asset ? `${platformLabels[platform]} · v${version}` : '前往 GitHub 发布页选择安装包';
}

async function loadRelease() {
  const current = detectedPlatform();
  deviceHint.textContent = current ? `当前设备：${platformLabels[current]}` : '支持 Mac 与 Windows';
  try {
    const response = await fetch('/api/desktop-release', { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.releasePage || 'release unavailable');
    Object.keys(platformLabels).forEach(platform => setOption(platform, payload.assets?.[platform], payload.version, payload.releasePage));
    status.textContent = `当前正式版 v${payload.version} · 点击对应版本开始下载。`;
  } catch (error) {
    const fallbackUrl = error.message.startsWith('http') ? error.message : fallbackReleaseUrl;
    Object.keys(platformLabels).forEach(platform => setOption(platform, null, '', fallbackUrl));
    status.textContent = '暂时无法读取版本，前往 GitHub 发布页选择安装包。';
  }
}

trigger?.addEventListener('click', event => {
  event.preventDefault();
  toggleMenu();
});

document.addEventListener('pointerdown', event => {
  if (control && !control.contains(event.target)) closeMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeMenu();
    trigger?.focus();
  }
});

loadRelease();

let phraseIndex = 0;
setInterval(() => {
  if (!rotatingPhrase) return;
  phraseIndex = (phraseIndex + 1) % phrases.length;
  rotatingPhrase.classList.add('is-changing');
  setTimeout(() => {
    rotatingPhrase.textContent = phrases[phraseIndex];
    rotatingPhrase.classList.remove('is-changing');
  }, 180);
}, 2200);
