import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { APPEARANCE_STORAGE_KEY, applyAppearance, initAppearance, normalizeAppearance, readAppearance } from '../src/appearance.js';

const bootstrapSource = readFileSync(new URL('../appearance-bootstrap.js', import.meta.url), 'utf8');
function applyBootstrap(values, initialTheme) {
  const attributes = new Map(initialTheme ? [['data-theme', initialTheme]] : []);
  const writes = [];
  const storage = { getItem: key => values[key] ?? null, setItem: (...args) => writes.push(args) };
  const document = { documentElement: { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) } };
  runInNewContext(bootstrapSource, { localStorage: storage, document });
  return { attributes, writes };
}

test('appearance: 与 Trading Risk Manager 共享键和三种模式', () => {
  assert.equal(APPEARANCE_STORAGE_KEY, 'trading-risk-manager:appearance');
  assert.equal(normalizeAppearance('light'), 'light');
  assert.equal(normalizeAppearance('dark'), 'dark');
  assert.equal(normalizeAppearance('system'), 'system');
  assert.equal(normalizeAppearance('invalid'), 'system');
  assert.equal(readAppearance({ getItem: () => 'dark' }), 'dark');
  assert.equal(readAppearance({ getItem: () => { throw new Error('blocked'); } }), 'system');
});

test('appearance: system 移除覆盖，light/dark 设置 data-theme', () => {
  const attributes = new Map();
  const root = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  applyAppearance('dark', root); assert.equal(attributes.get('data-theme'), 'dark');
  applyAppearance('light', root); assert.equal(attributes.get('data-theme'), 'light');
  applyAppearance('system', root); assert.equal(attributes.has('data-theme'), false);
});

test('appearance: 控件写入共享偏好并立即更新页面主题', () => {
  const attributes = new Map();
  const stored = new Map([[APPEARANCE_STORAGE_KEY, 'system']]);
  const root = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const listeners = new Map();
  const select = { value: '', addEventListener: (type, handler) => listeners.set(type, handler) };
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  initAppearance(select, storage, root);
  assert.equal(select.value, 'system');
  assert.equal(attributes.has('data-theme'), false);
  select.value = 'light'; listeners.get('change')();
  assert.equal(stored.get(APPEARANCE_STORAGE_KEY), 'light');
  assert.equal(attributes.get('data-theme'), 'light');
  select.value = 'dark'; listeners.get('change')();
  assert.equal(attributes.get('data-theme'), 'dark');
});

test('appearance: controller render 可由完整备份导入立即同步选择框和页面主题', () => {
  const attributes = new Map(); const root = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
  const listeners = new Map(); const select = { value: '', addEventListener: (type, handler) => listeners.set(type, handler) };
  const controller = initAppearance(select, { getItem: () => 'system' }, root);
  controller.render('dark'); assert.equal(select.value, 'dark'); assert.equal(attributes.get('data-theme'), 'dark');
  controller.render('system'); assert.equal(select.value, 'system'); assert.equal(attributes.has('data-theme'), false);
  const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /appearanceView\?\.render\(unified\.preferences\.appearance\)/);
});

test('appearance: head 在 CSS 前同步应用偏好，控件不进入交易备份', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('appearance-bootstrap.js') < html.indexOf('styles.css'));
  assert.match(html, /id="appearance-select"/);
  assert.match(bootstrapSource, /trading-control-center:v1/);
  assert.match(bootstrapSource, /trading-risk-manager:appearance/);
  assert.doesNotMatch(bootstrapSource, /\.setItem\(/);
});

test('appearance bootstrap: canonical 优先、system 清除覆盖，缺失或损坏时回退旧键', () => {
  const canonicalDark = applyBootstrap({
    'trading-control-center:v1': JSON.stringify({ preferences: { appearance: 'dark' } }),
    'trading-risk-manager:appearance': 'light'
  });
  assert.equal(canonicalDark.attributes.get('data-theme'), 'dark');
  assert.deepEqual(canonicalDark.writes, []);

  const canonicalSystem = applyBootstrap({
    'trading-control-center:v1': JSON.stringify({ preferences: { appearance: 'system' } }),
    'trading-risk-manager:appearance': 'dark'
  }, 'light');
  assert.equal(canonicalSystem.attributes.has('data-theme'), false);

  const missingCanonical = applyBootstrap({ 'trading-risk-manager:appearance': 'light' });
  assert.equal(missingCanonical.attributes.get('data-theme'), 'light');
  const damagedCanonical = applyBootstrap({ 'trading-control-center:v1': '{', 'trading-risk-manager:appearance': 'dark' });
  assert.equal(damagedCanonical.attributes.get('data-theme'), 'dark');
});
