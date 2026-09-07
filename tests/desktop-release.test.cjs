const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../api/desktop-release');
function release(version) {
  const name = `IPZSK.Desktop-${version}-arm64.dmg`;
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [{name, state:'uploaded',size:100, browser_download_url:`https://github.com/JayceHuang/ipzsk-dsh-desktop/releases/download/v${version}/${name}`}] };
}
test('new releases resolve without changing website versions', () => {
  for (const version of ['2.0.7', '2.1.0']) {
    const data = summarize(release(version));
    assert.equal(data.version, version);
    assert.ok(data.assets.mac.url.includes(`/v${version}/`));
    assert.equal(data.assets.windows, undefined);
    assert.equal(data.assets['mac-intel'], undefined);
  }
});
test('draft, preview, foreign asset and unfinished uploads are not offered', () => {
  for (const field of ['draft','prerelease']) assert.throws(() => summarize({...release('2.0.7'),[field]:true}));
  const data = release('2.0.7');
  data.assets[0].browser_download_url = 'https://example.com/installer';
  assert.throws(() => summarize(data));
  data.assets[0].state = 'new';
  assert.deepEqual(summarize(data).assets, {});
});
