const repository = 'JayceHuang/ipzsk-dsh-desktop';
const releasePage = `https://github.com/${repository}/releases/latest`;

function summarize(data) {
  if (data.draft || data.prerelease || !/^v\d+\.\d+\.\d+$/.test(data.tag_name)) throw new Error('invalid release');
  const version = data.tag_name.slice(1);
  const assets = {};
  const names = {
    mac: `IPZSK.Desktop-${version}-arm64.dmg`,
    'mac-intel': `IPZSK.Desktop-${version}-x64.dmg`,
    windows: `DSH-Desktop-${version}-x64-Setup.exe`,
  };
  for (const [platform, name] of Object.entries(names)) {
    const asset = data.assets?.find(item => item.name === name && item.state === 'uploaded');
    if (!asset) continue;
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(`/${repository}/releases/download/${data.tag_name}/`) || url.search || url.hash) throw new Error('invalid asset');
    assets[platform] = { name, url: url.href, bytes: asset.size };
  }
  return { version, assets, releasePage };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ipzsk-downloads' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('release unavailable');
    const data = summarize(await response.json());
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    return res.status(200).json(data);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'release_unavailable', releasePage });
  }
};
module.exports.summarize = summarize;
