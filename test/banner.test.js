import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBannerMessage, renderBannerVisibility } from '../src/banner.js';

const element = (textContent = 'stale') => ({ hidden: false, textContent });

test('banner: 空、null、undefined 和空白消息均彻底隐藏并清空文本', () => {
  for (const message of ['', null, undefined, '   ']) {
    const banner = element();
    assert.equal(renderBannerVisibility(banner, message), false);
    assert.equal(banner.hidden, true);
    assert.equal(banner.textContent, '');
  }
});

test('banner: 真实消息显示；清除后再次隐藏', () => {
  const banner = element();
  assert.equal(renderBannerVisibility(banner, '保存失败'), true);
  assert.equal(banner.hidden, false);
  assert.equal(renderBannerVisibility(banner, ''), false);
  assert.equal(banner.hidden, true);
});

test('banner: 两个独立容器只显示实际有消息的一条', () => {
  const storage = element(); const runtime = element();
  renderBannerVisibility(storage, '多页面冲突'); renderBannerVisibility(runtime, '');
  assert.equal(storage.hidden, false); assert.equal(runtime.hidden, true);
  assert.equal(hasBannerMessage('  警告  '), true);
});

test('banner CSS: hidden 属性强制为 display:none，不保留布局空间', async () => {
  const css = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../banner.css', import.meta.url), 'utf8'));
  assert.match(css, /\.banner\[hidden\]\{display:none!important\}/);
});
