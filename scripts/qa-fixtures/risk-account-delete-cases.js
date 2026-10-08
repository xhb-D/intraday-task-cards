import { mountRiskManager } from '../../src/risk-manager-view.js';
import { createAccount, deleteAccount, updateAccountMeta } from '../../src/risk-manager/account-service.js';
import { addBalanceUpdate } from '../../src/risk-manager/session-service.js';
import { makeUnified, commitUnified, loadUnified, UNIFIED_KEY } from '../../src/capture-unified.js';
import { makeEnvelope } from '../../src/capture-persistence.js';
import { pair, T } from '../../test/fixtures/intraday-v6.js';

// The same interaction assertions run under Node's DOM fixture and native browser DOM.
// All storage is an in-memory Map; this suite never accesses browser localStorage.
export function setupDeleteDom(compact) {
  let unified = makeUnified(makeEnvelope(pair().state, T + 100));
  for (const name of ['SYNTHETIC DELETE A', 'SYNTHETIC DELETE B']) {
    unified.sections.riskManager = createAccount(unified.sections.riskManager, {
      name, nominalAccountSize: 50000, riskReferenceBalance: 50000,
      hardLossAmount: 2000, drawdownType: 'NONE', defaultHardLossFloor: null, initialBalance: 50000,
    });
  }
  for (const account of unified.sections.riskManager.accounts) {
    unified.sections.riskManager = addBalanceUpdate(unified.sections.riskManager, account.id, 50100);
  }
  const records = new Map([[UNIFIED_KEY, JSON.stringify(unified)]]);
  let failWrite = false, locked = false, commits = 0, onCommit = () => {};
  const storage = {
    getItem: key => records.get(key) ?? null,
    setItem: (key, value) => { if (failWrite) throw new Error('synthetic disk failure'); records.set(key, String(value)); },
    removeItem: key => records.delete(key),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const view = mountRiskManager(host, {
    getState: () => unified.sections.riskManager,
    isLocked: () => locked,
    commit: next => {
      commits += 1; onCommit();
      const candidate = structuredClone(unified); candidate.sections.riskManager = next;
      unified = commitUnified(storage, candidate, { expectedRaw: JSON.stringify(unified) });
    },
  }, { compact });
  const click = (root, label) => {
    const node = [...root.querySelectorAll('button')].find(button => button.textContent === label);
    if (!node) throw new Error(`Missing button: ${label}`);
    node.click(); return node;
  };
  const dialog = () => document.body.querySelector('.risk-dialog');
  const openDelete = () => { click(host, '编辑账户'); const editor = dialog(); click(editor, '删除账户'); return { editor, confirmation: dialog() }; };
  return {
    host, view, click, dialog, openDelete, storage, records,
    state: () => structuredClone(unified), commits: () => commits,
    setFailure: () => { failWrite = true; }, setLocked: () => { locked = true; },
    setOnCommit: callback => { onCommit = callback; },
    externalUpdate: transform => { unified.sections.riskManager = transform(unified.sections.riskManager); records.set(UNIFIED_KEY, JSON.stringify(unified)); },
    dispose: () => { dialog()?.close(); dialog()?.remove(); view.destroy(); host.remove(); },
  };
}

export const deleteDomCases = [
  ['editor → confirmation: one modal, exact copy, cancel preserves all data and can reopen', async (x, a) => {
    const before = x.state(); const { editor, confirmation } = x.openDelete();
    a.equal(editor.open, false); a.equal(editor.parentNode, null);
    a.equal(document.body.querySelectorAll('.risk-dialog').length, 1);
    a.equal(confirmation.open, true); a.equal(confirmation.querySelector('h2').textContent, '删除账户');
    a.equal(confirmation.querySelector('.risk-dialog-note').textContent,
      '确定删除「SYNTHETIC DELETE A」吗？此操作会移除此账户及其本地余额历史，无法直接撤销。');
    a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    // A delayed close from the editor must not clear the successor's active guard.
    editor.dispatchEvent(new Event('close')); x.click(x.host, '编辑账户');
    a.equal(document.body.querySelectorAll('.risk-dialog').length, 1);
    const staleConfirm = [...confirmation.querySelectorAll('button')].find(button => button.textContent === '确认删除');
    x.click(confirmation, '取消'); staleConfirm.click();
    a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    x.click(x.host, '编辑账户'); a.equal(x.dialog().querySelector('h2').textContent, '编辑账户');
    x.click(x.dialog(), '取消');
  }],
  ['confirm deletes only target, preserves other balance events and Unified sections; duplicate/reentrant clicks commit once', async (x, a) => {
    const before = x.state(); const { confirmation } = x.openDelete();
    const confirm = [...confirmation.querySelectorAll('button')].find(button => button.textContent === '确认删除');
    x.setOnCommit(() => confirm.dispatchEvent(new Event('click')));
    confirm.click(); confirm.dispatchEvent(new Event('click'));
    const after = x.state();
    a.equal(x.commits(), 1); a.equal(after.sections.riskManager.accounts.length, 1);
    a.deepEqual(after.sections.riskManager.accounts[0], before.sections.riskManager.accounts[1]);
    a.equal(after.sections.riskManager.selectedAccountId, before.sections.riskManager.accounts[1].id);
    for (const key of ['intraday', 'chime']) a.deepEqual(after.sections[key], before.sections[key]);
    a.deepEqual(after.preferences, before.preferences); a.equal(after.revision, before.revision + 1);
    a.deepEqual([...x.records.keys()], [UNIFIED_KEY]);
    a.deepEqual(loadUnified(x.storage).state, after); a.equal(x.dialog(), null);
    a.equal(x.host.querySelector('.risk-feedback').textContent, '账户已删除。');
    x.click(x.host, '编辑账户'); x.click(x.dialog(), '取消');
  }],
  ['last account deletion enters empty state', async (x, a) => {
    x.externalUpdate(state => deleteAccount(state, state.accounts[1].id)); x.view.render();
    x.openDelete(); x.click(x.dialog(), '确认删除');
    a.equal(x.state().sections.riskManager.accounts.length, 0);
    a.equal(x.state().sections.riskManager.selectedAccountId, null);
    a.equal(x.host.querySelectorAll('.risk-account-card').length, 0);
    const edit = [...x.host.querySelectorAll('button')].find(button => button.textContent === '编辑账户');
    a.equal(edit.disabled, true); x.click(x.host, '添加账户'); x.click(x.dialog(), '取消');
  }],
  ['save failure: no deletion, no success notice, original persisted bytes and state unchanged', async (x, a) => {
    const before = x.state(), raw = x.records.get(UNIFIED_KEY);
    x.openDelete(); x.setFailure(); x.click(x.dialog(), '确认删除');
    a.deepEqual(x.state(), before); a.equal(x.records.get(UNIFIED_KEY), raw);
    a.match(x.dialog().querySelector('.risk-form-error').textContent, /未保存/);
    a.equal(x.host.querySelector('.risk-feedback').dataset.kind, 'error');
    x.click(x.dialog(), '取消'); x.click(x.host, '编辑账户'); x.click(x.dialog(), '取消');
  }],
  ['CAS conflict: newer tab data is never overwritten', async (x, a) => {
    const before = x.state(); x.openDelete();
    const newer = structuredClone(before); newer.revision += 1; newer.preferences.appearance = 'dark';
    const raw = JSON.stringify(newer); x.records.set(UNIFIED_KEY, raw);
    x.click(x.dialog(), '确认删除');
    a.equal(x.records.get(UNIFIED_KEY), raw); a.deepEqual(x.state(), before);
    a.match(x.dialog().querySelector('.risk-form-error').textContent, /其他页面修改/);
    a.equal(x.host.querySelector('.risk-feedback').dataset.kind, 'error');
    x.click(x.dialog(), '取消');
  }],
  ['externally deleted target is safely blocked without uncaught error or commit', async (x, a) => {
    const target = x.state().sections.riskManager.selectedAccountId; x.openDelete();
    x.externalUpdate(state => deleteAccount(state, target)); const before = x.state();
    a.doesNotThrow(() => x.click(x.dialog(), '确认删除'));
    a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    a.match(x.dialog().querySelector('.risk-form-error').textContent, /删除或更改/); x.click(x.dialog(), '取消');
  }],
  ['externally changed target requires renewed review without overwriting changes', async (x, a) => {
    const target = x.state().sections.riskManager.selectedAccountId; x.openDelete();
    x.externalUpdate(state => updateAccountMeta(state, target, { name: 'SYNTHETIC EXTERNAL EDIT' }));
    const before = x.state(); a.doesNotThrow(() => x.click(x.dialog(), '确认删除'));
    a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    a.match(x.dialog().querySelector('.risk-form-error').textContent, /删除或更改/); x.click(x.dialog(), '取消');
  }],
  ['locked controller rejects delete before submission', async (x, a) => {
    const before = x.state(); x.openDelete(); x.setLocked(); x.click(x.dialog(), '确认删除');
    a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    a.match(x.dialog().querySelector('.risk-form-error').textContent, /已锁定/); x.click(x.dialog(), '取消');
  }],
  ['native close releases editor guard and permits another Risk dialog', async (x, a) => {
    const before = x.state(); x.click(x.host, '编辑账户'); const editor = x.dialog();
    const closed = new Promise(resolve => editor.addEventListener('close', resolve, { once: true })); editor.close(); await closed;
    a.equal(x.dialog(), null); a.deepEqual(x.state(), before);
    x.click(x.host, '更新余额'); a.equal(x.dialog().querySelector('h2').textContent, '更新余额'); x.click(x.dialog(), '取消');
  }],
  ['native confirmation close never deletes and permits reopening', async (x, a) => {
    const before = x.state(); x.openDelete(); const confirmation = x.dialog();
    const closed = new Promise(resolve => confirmation.addEventListener('close', resolve, { once: true })); confirmation.close(); await closed;
    a.equal(x.dialog(), null); a.deepEqual(x.state(), before); a.equal(x.commits(), 0);
    x.openDelete(); x.click(x.dialog(), '取消');
  }],
];
