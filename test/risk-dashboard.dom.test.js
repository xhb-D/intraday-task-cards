import test from 'node:test';
import assert from 'node:assert/strict';
import { initRiskDashboard } from '../src/risk-dashboard.js';
import { initRiskManagerView } from '../src/risk-manager-view.js';
import { createAccount } from '../src/risk-manager/account-service.js';
import { addBalanceUpdate } from '../src/risk-manager/session-service.js';
import { RISK_MANAGER_SCHEMA_VERSION } from '../src/risk-manager/migration.js';

class FakeElement {
  constructor(tagName = 'div') { this.tagName = tagName; this.children = []; this.listeners = new Map(); this.dataset = {}; this.className = ''; this.disabled = false; this.value = ''; this.type = ''; this.parentNode = null; this._text = ''; }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text; }
  appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  add(node) { this.appendChild(node); if (this.tagName === 'select' && (node.selected || this.children.length === 1)) this.value = node.value; }
  addEventListener(type, listener) { const handlers = this.listeners.get(type) || []; handlers.push(listener); this.listeners.set(type, handlers); }
  dispatch(type) { const event = { target: this, preventDefault() { this.defaultPrevented = true; } }; (this.listeners.get(type) || []).forEach(listener => listener(event)); return event; }
  click() { this.dispatch('click'); if (this.type === 'submit') { let parent = this.parentNode; while (parent && parent.tagName !== 'form') parent = parent.parentNode; parent?.dispatch('submit'); } }
  setAttribute(name, value) { this[name] = String(value); }
  querySelector(selector) { return find(this, node => selector.startsWith('.') && node.className.split(/\s+/).includes(selector.slice(1))); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { const siblings = this.parentNode?.children || []; const index = siblings.indexOf(this); if (index >= 0) siblings.splice(index, 1); this.parentNode = null; }
}
class FakeOption extends FakeElement {
  constructor(text, value, defaultSelected = false, selected = false) { super('option'); this.textContent = text; this.value = value; this.defaultSelected = defaultSelected; this.selected = selected; }
}
const find = (root, predicate) => {
  if (predicate(root)) return root;
  for (const child of root.children) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
};
const byText = (root, text) => find(root, node => node._text === text);
const byButtonText = (root, text) => {
  const found = [];
  const visit = node => { if (node.tagName === 'button' && node._text === text) found.push(node); node.children.forEach(visit); };
  visit(root); return found.at(-1) || null;
};
const byName = (root, name) => find(root, node => node.name === name);
const byClass = (root, token) => find(root, node => node.className.split(/\s+/).includes(token));
const all = (root, predicate) => {
  const found = [];
  const visit = node => { if (predicate(node)) found.push(node); node.children.forEach(visit); };
  visit(root); return found;
};
const renderedText = node => `${node._text}${node.children.map(renderedText).join('')}`;

test('risk dashboard DOM: 点击表单确认会真实创建、更新、撤销、编辑，并保留无效表单', () => {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, Option: globalThis.Option };
  const body = new FakeElement('body'); const document = { body, createElement: tag => new FakeElement(tag) };
  const records = new Map(); const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)) };
  globalThis.document = document; globalThis.window = { addEventListener() {} }; globalThis.localStorage = localStorage; globalThis.Option = FakeOption;
  try {
    let state = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
    const host = new FakeElement('div'); body.appendChild(host); initRiskDashboard(host, { getState: () => state, commit: next => { state = next; }, isLocked: () => false });
    byText(host, '添加账户').click();
    byName(body, 'name').value = 'DEMO-ACCOUNT-001'; byName(body, 'nominal').value = '50000'; byName(body, 'reference').value = '50000'; byName(body, 'hardLoss').value = '2000'; byName(body, 'floor').value = '49400'; byName(body, 'initial').value = '50000';
    byButtonText(body, '添加账户').click();
    assert.ok(byClass(host, 'risk-account-card')); assert.ok(byClass(host, 'selected')); assert.equal(byText(host, '更新余额').disabled, false);

    byText(host, '更新余额').click(); byName(body, 'balance').value = '50100'; byText(body, '确认更新').click();
    assert.ok(byText(host, '$50,100.00')); assert.equal(byText(host, '撤销上一条余额更新').disabled, false);

    byText(host, '撤销上一条余额更新').click(); byText(body, '确认撤销').click();
    assert.ok(byText(host, '$50,000.00')); assert.equal(byText(host, '撤销上一条余额更新').disabled, true);

    byText(host, '编辑账户').click(); byName(body, 'name').value = 'DEMO-ACCOUNT-001-EDITED'; byText(body, '保存账户').click();
    assert.ok(byText(host, 'DEMO-ACCOUNT-001-EDITED'));

    byText(host, '编辑账户').click(); byName(body, 'nominal').value = '0'; byText(body, '保存账户').click();
    assert.match(byClass(body, 'risk-form-error').textContent, /名义账户规模必须是正数/);
    assert.ok(byText(body, '保存账户'));
    byText(body, '取消').click();
  } finally {
    globalThis.document = prior.document; globalThis.window = prior.window; globalThis.localStorage = prior.localStorage; globalThis.Option = prior.Option;
  }
});

test('risk manager DOM: 完整页不重复首页摘要，限制 Floor、V1 编辑和全局 rollover 重入', () => {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, Option: globalThis.Option };
  const body = new FakeElement('body'); const document = { body, createElement: tag => new FakeElement(tag) };
  globalThis.document = document; globalThis.window = { addEventListener() {} }; globalThis.Option = FakeOption;
  try {
    const base = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
    let state = createAccount(base, {
      name: 'EOD', nominalAccountSize: 50000, riskReferenceBalance: 50000,
      hardLossAmount: 2000, drawdownType: 'EOD_TRAILING', defaultHardLossFloor: 49000, initialBalance: 50000,
    });
    let commits = 0;
    const host = new FakeElement('div'); body.appendChild(host);
    initRiskManagerView(host, { getState: () => state, commit: next => { commits += 1; state = next; }, isLocked: () => false });
    assert.equal(byClass(host, 'risk-summary'), null, '完整页不渲染首页摘要');
    assert.equal(all(host, node => node.className.split(/\s+/).includes('decision-card')).length, 1, '完整页只有一个风险决策卡');
    assert.equal(byButtonText(host, 'Hard Loss Floor'), null, 'EOD trailing 不提供盘中 Floor 编辑');

    byText(host, '添加账户').click(); byText(host, '添加账户').click();
    assert.equal(all(body, node => node.tagName === 'dialog').length, 1, '重复打开不会叠加模态框');
    byText(body, '取消').click();

    byText(host, '编辑账户').click();
    const hardLoss = byName(body, 'hardLoss');
    assert.equal(hardLoss.required, false, 'V1 或历史账户允许清空下一时段最大亏损额度');
    hardLoss.value = '';
    byText(body, '保存账户').click();
    assert.equal(state.accounts[0].hardLossAmount, null, '空值保存为下一时段未设置，而不是 NaN');

    state = createAccount(base, {
      name: 'Tail', nominalAccountSize: 50000, riskReferenceBalance: 50000,
      hardLossAmount: 2000, drawdownType: 'INTRADAY_TRAILING', defaultHardLossFloor: 49000, initialBalance: 50000,
    });
    state = addBalanceUpdate(state, state.selectedAccountId, 49750);
    initRiskManagerView(host, { getState: () => state, commit: next => { commits += 1; state = next; }, isLocked: () => false });
    assert.ok(byButtonText(host, 'Hard Loss Floor'), '盘中 trailing 提供 Floor 编辑');
    assert.match(renderedText(byClass(host, 'tail-warning')), /当前可用风险低于 Low R/);
    assert.match(renderedText(byClass(host, 'decision-reason')), /剩余风险低于 Low R/);

    byText(host, '结束当前并开始新交易日').click();
    const confirm = byText(body, '确认开始新交易日');
    const beforeRollover = commits;
    confirm.click(); confirm.click();
    assert.equal(commits, beforeRollover + 1, '重复确认只能提交一次全局 rollover');
  } finally {
    globalThis.document = prior.document; globalThis.window = prior.window; globalThis.localStorage = prior.localStorage; globalThis.Option = prior.Option;
  }
});
