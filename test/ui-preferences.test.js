import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createWorkspace } from '../src/model.js';
import { serialize } from '../src/persistence.js';
import { COMMODITY_PREFERENCES_KEY, loadCommodityPreferences, preserveScrollPosition, saveCommodityPreferences, setCommodityHidden, setCommodityManagerExpanded, toggleCardCollapsed, visibleCommoditySymbols } from '../src/ui-preferences.js';

test('UI preference: 每卡折叠独立，且不进入交易状态序列化', () => {
  const state = createWorkspace(1); const before = serialize(state, 2);
  const gcCollapsed = toggleCardCollapsed(new Set(), 'GC');
  const gcAndClCollapsed = toggleCardCollapsed(gcCollapsed, 'CL');
  const clCollapsed = toggleCardCollapsed(gcAndClCollapsed, 'GC');
  assert.deepEqual([...gcCollapsed], ['GC']); assert.deepEqual([...gcAndClCollapsed], ['GC', 'CL']); assert.deepEqual([...clCollapsed], ['CL']);
  assert.equal(serialize(state, 2), before);
});

test('UI preference: 隐藏商品仅写独立偏好，交易状态与记录序列化保持不变', () => {
  const symbols = ['GC', 'CL', 'ES']; const state = createWorkspace(1); const before = serialize(state, 2);
  const hiddenCl = setCommodityHidden(null, 'CL', true, symbols);
  const hiddenAll = symbols.reduce((preferences, symbol) => setCommodityHidden(preferences, symbol, true, symbols), null);
  assert.deepEqual(hiddenCl, { hiddenSymbols: ['CL'], managerExpanded: false });
  assert.deepEqual(visibleCommoditySymbols(symbols, hiddenCl), ['GC', 'ES']);
  assert.deepEqual(visibleCommoditySymbols(symbols, setCommodityHidden(hiddenCl, 'CL', false, symbols)), symbols);
  assert.deepEqual(visibleCommoditySymbols(symbols, hiddenAll), []);
  assert.equal(serialize(state, 2), before);
});

test('UI preference: 隐藏列表和管理区展开状态可刷新恢复，非法值不进入偏好', () => {
  const symbols = ['GC', 'CL', 'ES']; const records = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)) };
  let preferences = setCommodityHidden(null, 'CL', true, symbols);
  preferences = setCommodityManagerExpanded(preferences, true, symbols);
  assert.equal(saveCommodityPreferences(storage, preferences, symbols), true);
  assert.deepEqual(loadCommodityPreferences(storage, symbols), { hiddenSymbols: ['CL'], managerExpanded: true });
  records.set(COMMODITY_PREFERENCES_KEY, JSON.stringify({ hiddenSymbols: ['CL', 'BAD', 'CL'], managerExpanded: true }));
  assert.deepEqual(loadCommodityPreferences(storage, symbols), { hiddenSymbols: ['CL'], managerExpanded: true });
  assert.deepEqual(setCommodityHidden(preferences, 'CL', false, symbols), { hiddenSymbols: [], managerExpanded: false });
});

test('UI preference: 重绘后立即并在下一帧恢复原滚动位置', () => {
  const calls = [];
  let queued;
  const viewport = {
    scrollX: 24,
    scrollY: 680,
    scrollTo(x, y) { calls.push([x, y]); },
    requestAnimationFrame(callback) { queued = callback; },
  };

  const result = preserveScrollPosition(() => 'rendered', viewport);

  assert.equal(result, 'rendered');
  assert.deepEqual(calls, [[24, 680]]);
  queued();
  assert.deepEqual(calls, [[24, 680], [24, 680]]);
});

test('UI preference: 重绘抛错或无 requestAnimationFrame 时仍恢复滚动位置', () => {
  const calls = [];
  const viewport = { scrollX: 8, scrollY: 320, scrollTo(x, y) { calls.push([x, y]); } };
  const error = new Error('render failed');

  assert.throws(() => preserveScrollPosition(() => { throw error; }, viewport), error);
  assert.deepEqual(calls, [[8, 320]]);
});

test('UI contract: 阶段控制在状态面板前，隐藏控件不触碰状态且具备可访问语义', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../refinement.css', import.meta.url), 'utf8');
  assert.match(app, /const summary = opportunity \?[^]*?BIASES\[card\.bias\][^]*?DIRECTIONS\[card\.direction\][^]*?STRUCTURES_3M\[card\.structure3m\][^]*?SETUPS\[opportunity\.type\]/);
  assert.match(app, /\['long', 'short'\]\.includes\(card\.direction\) \? `<span class="summary-direction-active">\$\{DIRECTIONS\[card\.direction\]\}<\/span>` : DIRECTIONS\[card\.direction\]/);
  assert.doesNotMatch(app, /summary-direction-long/);
  assert.match(app, /Object\.entries\(VISIBLE_STRUCTURES_3M\)/);
  assert.match(app, /isDirectionAllowed\(card\.bias, key\)/);
  assert.match(app, /isSetupAllowed\(card\.direction, card\.structure3m, key\)/);
  assert.match(app, /opportunity\?\.registeredAt !== null && opportunity\?\.zone \?[^]*?summary-zone/);
  assert.match(app, /<dt class="sr-only">当前偏见<\/dt>/);
  assert.match(app, /\$\{controls\}<section class="task/);
  assert.match(app, /data-action="toggle-collapse"[^]*?type="button" aria-expanded="\$\{!collapsed\}" aria-label="\$\{toggleLabel\}"/);
  assert.match(app, /class="card-hide" data-action="hide-card"[^]*?title="\$\{hideLabel\}" aria-label="\$\{hideLabel\}"/);
  assert.match(app, /function renderCommodityDashboard\(\)/);
  assert.match(app, /商品看板[^]*?已隐藏商品 \$\{hiddenSymbols\.length\}/);
  assert.match(app, /已隐藏，状态仍保留[^]*?恢复显示/);
  assert.match(app, /const visibleSymbols = visibleCommoditySymbols\(ORDER, commodityPreferences\);[^]*?cardsEl\.innerHTML = visibleSymbols\.map\(renderCard\)/);
  assert.match(app, /cardsEl\.className = `cards cards--count-\$\{visibleSymbols\.length\}`/);
  assert.match(app, /saveCommodityPreferences\(storage, commodityPreferences, ORDER\); renderAll\(\)/);
  assert.match(app, /collapsedCards = toggleCardCollapsed\(collapsedCards, symbol\); renderAll\(\)/);
  assert.match(app, /function renderAll\(\) \{ return preserveScrollPosition\(/);
  assert.match(readFileSync(new URL('../src/risk-manager-view.js', import.meta.url), 'utf8'), /function render\(\) \{ if \(disposed\) return; return preserveScrollPosition\(/);
  assert.match(css, /\.card\{grid-template-rows:unset;align-self:start;container-type:inline-size\}/);
  assert.match(css, /@container \(max-width:390px\)\{\.task-content\{grid-template-columns:1fr/);
  assert.doesNotMatch(css, /\.task-summary dd\{[^}]*text-overflow:ellipsis/);
  assert.doesNotMatch(css, /\.summary-zone\{[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.summary-direction-active\{display:inline-flex;[^}]*border:1px solid color-mix\(in srgb,var\(--theme-accent\) 58%,var\(--border-primary\)\);[^}]*background:color-mix\(in srgb,var\(--theme-accent\) 13%,var\(--bg-surface-secondary\)\);[^}]*box-shadow:0 0 9px color-mix\(in srgb,var\(--theme-accent\) 22%,transparent\);[^}]*color:var\(--text-primary\)\}/);
  assert.match(css, /\.commodity-dashboard\{margin:12px 0 14px/);
  assert.match(css, /\.cards\.cards--count-2\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /@media\(max-width:629px\)\{[^]*?\.commodity-dashboard-row\{grid-template-columns:42px minmax\(0,1fr\)/);
});

test('production bundle: 折叠与隐藏点击路径可执行，且不会写入交易状态', () => {
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = () => ({ hidden: true, disabled: false, inert: false, textContent: '', innerHTML: '', value: '', dataset: {}, addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; }, querySelector() { return element(); }, setAttribute() {}, focus() { this.focused = true; }, showModal() {}, close() {} });
  const ids = ['cards', 'commodity-dashboard', 'history-body', 'confirm-dialog', 'data-dialog', 'announcer', 'save-status', 'storage-banner', 'storage-message', 'storage-retry', 'start-fresh', 'import-json', 'import-file', 'dialog-confirm', 'restore-note', 'export-raw', 'export-json', 'export-today', 'export-all', 'history-count', 'history-empty', 'history-table', 'dialog-title', 'dialog-message', 'dialog-warning', 'dialog-cancel', 'data-feedback', 'data-tools', 'error-banner'];
  ids.forEach(id => elements.set(`#${id}`, element()));
  const focusTarget = element();
  const document = {
    querySelector(selector) { return selector.startsWith('article[data-symbol=') ? focusTarget : elements.get(selector) || element(); },
    querySelectorAll() { return []; },
    createElement() { return element(); }
  };
  let writes = 0; const records = new Map();
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => { writes += 1; records.set(key, String(value)); } };
  const context = { document, localStorage, console: { error() {} }, setInterval() {}, setTimeout() {}, URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob, Intl, Date, JSON, Error, SyntaxError };
  context.window = { addEventListener() {} };
  vm.runInNewContext(bundle, context);
  const cards = elements.get('#cards'); const initialWrites = writes;
  assert.match(cards.innerHTML, /当前偏见[^]*?交易方向[^]*?市场结构[^]*?当前机会[^]*?当前状态/);
  assert.doesNotMatch(cards.innerHTML, /当前 3M 市场结构/);
  assert.doesNotMatch(cards.innerHTML, /未判断/);
  assert.match(cards.innerHTML, /当前机会[^]*?趋势回调[^]*?disabled aria-disabled="true"/);
  const button = { disabled: false, dataset: { action: 'toggle-collapse', symbol: 'GC' } };
  cards.listeners.click({ detail: 1, target: { closest: () => button } });
  assert.match(cards.innerHTML, /<article class="card [^"]*is-collapsed" data-symbol="GC"/);
  assert.match(cards.innerHTML, /aria-expanded="false"/);
  assert.match(cards.innerHTML, /<article class="card state-none" data-symbol="CL"[^]*?aria-expanded="true"/);
  assert.equal(elements.get('#error-banner').textContent, ''); assert.equal(writes, initialWrites); assert.equal(focusTarget.focused, true);
  cards.listeners.click({ detail: 0, target: { closest: () => button } });
  assert.match(cards.innerHTML, /<article class="card state-none" data-symbol="GC"[^>]*>[^]*?aria-expanded="true"/);
  assert.doesNotMatch(cards.innerHTML, /<article class="card [^"]*is-collapsed" data-symbol="GC"/);
  const hide = { disabled: false, dataset: { action: 'hide-card', symbol: 'CL' } };
  cards.listeners.click({ detail: 1, target: { closest: () => hide } });
  assert.doesNotMatch(cards.innerHTML, /data-symbol="CL"/);
  assert.match(elements.get('#commodity-dashboard').innerHTML, /已隐藏商品 1[^]*?CL[^]*?已隐藏，状态仍保留[^]*?恢复显示/);
  assert.equal(writes, initialWrites + 1);
});
