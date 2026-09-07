import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBannerMessage, renderBannerVisibility, renderTextBanner } from '../src/banner.js';

const element = (textContent = 'stale') => ({ hidden: false, textContent });

test('banner: text-only banner 对空、null、undefined 和空白消息均彻底隐藏并清空文本', () => {
  for (const message of ['', null, undefined, '   ']) {
    const banner = element();
    assert.equal(renderTextBanner(banner, message), false);
    assert.equal(banner.hidden, true);
    assert.equal(banner.textContent, '');
  }
});

test('banner: 真实消息显示；清除后再次隐藏', () => {
  const banner = element();
  assert.equal(renderTextBanner(banner, '保存失败'), true);
  assert.equal(banner.hidden, false);
  assert.equal(renderTextBanner(banner, ''), false);
  assert.equal(banner.hidden, true);
});

test('banner: 两个独立容器只显示实际有消息的一条', () => {
  const storage = element(); const runtime = element();
  renderBannerVisibility(storage, '多页面冲突'); renderBannerVisibility(runtime, '');
  assert.equal(storage.hidden, false); assert.equal(runtime.hidden, true);
  assert.equal(hasBannerMessage('  警告  '), true);
});

test('banner: 初始正常渲染后，首次状态变更保存不会因 structured banner 进入 safe stop', () => {
  const children = {
    '#storage-message': { textContent: 'stale' },
    '#storage-retry': { hidden: false },
    '#start-fresh': { hidden: false }
  };
  const banner = { hidden: false, querySelector: selector => children[selector] || null };
  Object.defineProperty(banner, 'textContent', {
    get: () => Object.values(children).map(child => child.textContent || '').join(''),
    set: () => { Object.keys(children).forEach(key => { delete children[key]; }); }
  });
  const normalStorageStatus = () => {
    const message = banner.querySelector('#storage-message');
    const retry = banner.querySelector('#storage-retry');
    const startFresh = banner.querySelector('#start-fresh');
    message.textContent = '';
    renderBannerVisibility(banner, message.textContent);
    retry.hidden = true;
    startFresh.hidden = true;
  };
  assert.doesNotThrow(normalStorageStatus, '初始 renderAll 的 storageStatus');
  assert.doesNotThrow(normalStorageStatus, '首次 mutate → persist 的 storageStatus');
  assert.equal(banner.hidden, true);
  assert.ok(banner.querySelector('#storage-message'));
  assert.ok(banner.querySelector('#storage-retry'));
  assert.ok(banner.querySelector('#start-fresh'));
});

test('banner CSS: hidden 属性强制为 display:none，不保留布局空间', async () => {
  const css = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../banner.css', import.meta.url), 'utf8'));
  assert.match(css, /\.banner\[hidden\]\{display:none!important\}/);
});
