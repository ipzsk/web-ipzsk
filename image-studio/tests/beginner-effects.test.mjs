import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = new URL('../', import.meta.url);
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('web/beginner-effects.ts', root))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {EFFECTS, buildEffectPrompt, missingEffectFields} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const effect = id => EFFECTS.find(item => item.id === id);

test('the four main choices stay simple and use existing example images', async () => {
  assert.deepEqual(EFFECTS.slice(0, 4).map(item => item.title), ['照片变手绘', '文章封面', '宣传海报', '自由描述画面']);
  assert.equal(EFFECTS.length, 8);
  assert.equal(new Set(EFFECTS.map(item => item.id)).size, EFFECTS.length);
  const catalog = JSON.parse(await fs.readFile(new URL('assets/catalog.json', root), 'utf8'));
  for (const item of EFFECTS) {
    assert.ok(item.fields.length <= 2);
    if (item.image) {
      assert.ok(catalog.some(entry => entry.image === item.image), item.image);
      await fs.access(new URL(item.image.replace('/image-studio/', ''), root));
    }
  }
  for (const [id, catalogId] of [['sketch', 20030], ['cover', 20000], ['poster', 20004]]) {
    assert.equal(effect(id).image, catalog.find(item => item.id === catalogId).image);
  }
});

test('photo effects require a photo while written effects require their named content', () => {
  for (const item of EFFECTS) {
    const missing = missingEffectFields(item, {}, false);
    assert.equal(missing.includes('照片'), item.requiresPhoto);
    assert.ok(!missing.includes('补充说明'));
    const values = Object.fromEntries(item.fields.filter(field => field.required).map(field => [field.key, '测试内容']));
    assert.deepEqual(missingEffectFields(item, values, true), []);
  }
  assert.deepEqual(missingEffectFields(effect('cover'), {title: ' \n\t'}, false), ['封面标题']);
  assert.deepEqual(missingEffectFields(effect('poster'), {}, false), ['海报标题']);
  assert.deepEqual(missingEffectFields(effect('free'), {description: ' '}, false), ['想画什么']);
  assert.deepEqual(missingEffectFields(effect('sketch'), {}, true), []);
});

test('generated prompts retain user wording and do not leave template variables', () => {
  const text = '  新品“咖啡” $5，保留 $& 与 $1\n第二行："原文"  ';
  for (const item of EFFECTS) {
    const values = Object.fromEntries(item.fields.map(field => [field.key, text]));
    const prompt = buildEffectPrompt(item, values);
    assert.ok(prompt.includes(text), item.id);
    assert.ok(!/\{\{[^}]*\}\}/.test(prompt), item.id);
    assert.ok(!prompt.includes('undefined'), item.id);
  }
  assert.equal(buildEffectPrompt(effect('free'), {description: text}), text);
  assert.match(buildEffectPrompt(effect('cover'), {title: text}), /标题必须完整使用用户原文/);
  assert.match(buildEffectPrompt(effect('poster'), {title: text}), /不自行编造宣传信息/);
});

test('optional notes can be omitted and photo prompts always refer to the uploaded photo', () => {
  for (const id of ['sketch', 'pixel']) {
    const prompt = buildEffectPrompt(effect(id), {});
    assert.match(prompt, /上传.*照片/);
    assert.ok(!prompt.includes('用户补充说明'));
  }
  assert.match(buildEffectPrompt(effect('cover'), {title: '我的文章'}), /我的文章/);
  assert.match(buildEffectPrompt(effect('paper-cut'), {subject: '月亮'}), /月亮/);
  assert.throws(() => buildEffectPrompt({...effect('free'), id: 'unknown'}, {}), /重新选择/);
});
