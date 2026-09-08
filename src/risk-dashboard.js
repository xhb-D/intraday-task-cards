import { RISK_MANAGER_SCHEMA_VERSION, migrateState } from './risk-manager/migration.js';
import { STORAGE_KEY, loadAppState, saveAppState } from './risk-manager/storage/local-storage-adapter.js';
import { createAccount, selectAccount, updateAccountMeta } from './risk-manager/account-service.js';
import { addBalanceUpdate, deriveCurrentBalance, deriveDecision, undoLastBalanceUpdate } from './risk-manager/session-service.js';
import { drawdownTypeLabel, fmtUSD } from './risk-manager/utils.js';

// Homepage shell for the locked Trading Risk Manager V2 services.
// This file owns presentation only; account/session/risk decisions remain in
// src/risk-manager/* and persist under the existing manager storage key.

const RISK_EMPTY_STATE = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
let riskDashboardHost = null;
let riskDashboardState = null;
let riskDashboardStorage = null;

const riskEl = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const riskAccount = () => riskDashboardState?.accounts.find(account => account.id === riskDashboardState.selectedAccountId) || null;
const riskDecision = account => account ? deriveDecision(account) : null;
const riskStatus = decision => decision?.status === 'ALLOWED' ? ['可以交易', 'green'] : decision?.status === 'TAIL_RISK' ? ['尾部风险', 'yellow'] : decision?.status === 'BLOCKED' ? ['禁止开仓', 'red'] : ['需要配置', 'muted'];
const riskAllowed = decision => decision?.status === 'TAIL_RISK' ? decision.finalRisk : decision?.allowedR;

function riskStorage() {
  try { return globalThis.localStorage; } catch (_) { return null; }
}

function riskNormalizeState(raw) {
  const migrated = migrateState(raw);
  if (!migrated || !Array.isArray(migrated.accounts)) return { ...RISK_EMPTY_STATE, accounts: [] };
  const selected = migrated.accounts.some(account => account.id === migrated.selectedAccountId) ? migrated.selectedAccountId : migrated.accounts[0]?.id || null;
  return { ...migrated, schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: selected };
}

function riskNotice(message, kind = 'info') {
  const region = riskDashboardHost?.querySelector('.risk-feedback');
  if (!region) return;
  region.textContent = message;
  region.dataset.kind = kind;
}

function riskMutate(nextState, message) {
  riskDashboardState = nextState;
  if (!saveAppState(riskDashboardState, riskDashboardStorage)) riskNotice('风险管理器数据尚未保存；请勿刷新，并检查浏览器本地保存权限。', 'error');
  else riskNotice(message || '风险管理器已本地保存。', 'success');
  renderRiskDashboard();
}

function riskCloseDialog(dialog) { dialog?.close(); dialog?.remove(); }

function riskDialog(title, build) {
  const dialog = document.createElement('dialog');
  dialog.className = 'risk-dialog';
  const form = riskEl('form', 'risk-dialog-body');
  form.method = 'dialog';
  form.appendChild(riskEl('h2', null, title));
  const close = () => riskCloseDialog(dialog);
  build(form, close);
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  dialog.showModal();
  return dialog;
}

function riskButton(text, className = 'risk-button') {
  const button = riskEl('button', className, text);
  button.type = 'button';
  return button;
}

function riskField(form, { label, name, value = '', type = 'text', required = false, hint = '' }) {
  const wrap = riskEl('label', 'risk-field');
  wrap.appendChild(riskEl('span', null, label));
  const input = document.createElement(type === 'select' ? 'select' : 'input');
  input.name = name;
  if (type !== 'select') { input.type = type; input.value = value; }
  if (required) input.required = true;
  if (type === 'number') { input.inputMode = 'decimal'; input.step = '0.01'; input.min = '0.01'; }
  wrap.appendChild(input);
  if (hint) wrap.appendChild(riskEl('small', null, hint));
  form.appendChild(wrap);
  return input;
}

function riskAccountForm(account = null) {
  const editing = Boolean(account);
  riskDialog(editing ? '编辑账户' : '添加账户', (form, close) => {
    form.appendChild(riskEl('p', 'risk-dialog-note', editing ? '风险参考余额和最大亏损额度将在下一交易时段生效；当前时段的 Base R 保持冻结。' : '只记录已实现余额；不读取行情，也不下单。'));
    const name = riskField(form, { label: '账户名称', name: 'name', value: account?.name, required: true });
    const firm = riskField(form, { label: 'Prop Firm（可选）', name: 'firm', value: account?.propFirm || '' });
    const type = riskField(form, { label: '账户类型（可选）', name: 'type', value: account?.accountType || '' });
    const nominal = riskField(form, { label: '名义账户规模', name: 'nominal', value: account?.nominalAccountSize || '', type: 'number', required: true });
    const reference = riskField(form, { label: '风险参考余额', name: 'reference', value: account?.riskReferenceBalance || '', type: 'number', required: true });
    const hardLoss = riskField(form, { label: '最大亏损额度', name: 'hardLoss', value: account?.hardLossAmount || '', type: 'number', required: true });
    const drawdownLabel = riskEl('label', 'risk-field'); drawdownLabel.appendChild(riskEl('span', null, '回撤类型'));
    const drawdown = document.createElement('select'); drawdown.name = 'drawdown';
    [['EOD_TRAILING', 'EOD 日终跟踪回撤'], ['INTRADAY_TRAILING', '盘中实时跟踪回撤'], ['STATIC', '静态回撤'], ['NONE', '无外部回撤限制']].forEach(([value, text]) => { const option = new Option(text, value); option.selected = (account?.drawdownType || 'EOD_TRAILING') === value; drawdown.add(option); });
    drawdownLabel.appendChild(drawdown); form.appendChild(drawdownLabel);
    const floor = riskField(form, { label: 'Hard Loss Floor', name: 'floor', value: account?.defaultHardLossFloor || '', type: 'number', hint: '无外部回撤限制时留空。' });
    const initial = editing ? null : riskField(form, { label: '初始已实现余额', name: 'initial', type: 'number', required: true });
    const error = riskEl('p', 'risk-form-error'); form.appendChild(error);
    const actions = riskEl('div', 'risk-dialog-actions'); const cancel = riskButton('取消'); const save = riskButton(editing ? '保存账户' : '添加账户', 'risk-button primary'); save.type = 'submit';
    cancel.addEventListener('click', close); actions.append(cancel, save); form.appendChild(actions);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const read = field => Number(field.value);
      const floorValue = floor.value.trim() === '' ? null : Number(floor.value);
      const payload = { name: name.value, propFirm: firm.value, accountType: type.value, nominalAccountSize: read(nominal), riskReferenceBalance: read(reference), hardLossAmount: read(hardLoss), drawdownType: drawdown.value, defaultHardLossFloor: floorValue };
      try {
        if (editing) riskMutate(updateAccountMeta(riskDashboardState, account.id, payload), `已更新 ${account.name}；配置规则按既有时段规则处理。`);
        else riskMutate(createAccount(riskDashboardState, { ...payload, initialBalance: read(initial) }), `已添加 ${name.value.trim()}。`);
        close();
      } catch (errorValue) { error.textContent = errorValue.message; }
    });
  });
}

function riskBalanceForm(account) {
  riskDialog('更新余额', (form, close) => {
    form.appendChild(riskEl('p', 'risk-dialog-note', `当前余额：${fmtUSD(deriveCurrentBalance(account.currentSession))}。仅输入最新已实现余额，不包含浮盈/浮亏。`));
    const balance = riskField(form, { label: '最新已实现账户余额', name: 'balance', type: 'number', required: true });
    const error = riskEl('p', 'risk-form-error'); form.appendChild(error);
    const actions = riskEl('div', 'risk-dialog-actions'); const cancel = riskButton('取消'); const save = riskButton('确认更新', 'risk-button primary'); save.type = 'submit'; cancel.addEventListener('click', close); actions.append(cancel, save); form.appendChild(actions);
    form.addEventListener('submit', event => { event.preventDefault(); try { riskMutate(addBalanceUpdate(riskDashboardState, account.id, Number(balance.value)), '余额已更新，风险结论已重新计算。'); close(); } catch (errorValue) { error.textContent = errorValue.message; } });
  });
}

function riskConfirmUndo(account) {
  const last = account.currentSession.balanceEvents.at(-1);
  if (!last) return;
  riskDialog('撤销上一条余额更新', (form, close) => {
    form.appendChild(riskEl('p', 'risk-dialog-note', `${fmtUSD(last.previousBalance)} → ${fmtUSD(last.newBalance)} 将被移除，风险状态会从历史记录重新计算。`));
    const actions = riskEl('div', 'risk-dialog-actions'); const cancel = riskButton('取消'); const confirm = riskButton('确认撤销', 'risk-button danger'); cancel.addEventListener('click', close); confirm.addEventListener('click', () => { riskMutate(undoLastBalanceUpdate(riskDashboardState, account.id), '已撤销上一条余额更新，并已重新计算风险。'); close(); }); actions.append(cancel, confirm); form.appendChild(actions);
  });
}

function riskAllAccounts() {
  riskDialog('全部账户', (form, close) => {
    const search = riskField(form, { label: '搜索账户', name: 'search' });
    const list = riskEl('div', 'risk-account-list'); form.appendChild(list);
    const refresh = () => {
      list.textContent = ''; const query = search.value.trim().toLowerCase();
      riskDashboardState.accounts.filter(account => account.name.toLowerCase().includes(query)).forEach(account => {
        const row = riskButton(account.name, `risk-list-row${account.id === riskDashboardState.selectedAccountId ? ' selected' : ''}`);
        row.appendChild(riskEl('small', null, fmtUSD(deriveCurrentBalance(account.currentSession))));
        row.addEventListener('click', () => { riskMutate(selectAccount(riskDashboardState, account.id), `已切换至 ${account.name}。`); close(); }); list.appendChild(row);
      });
      if (!list.children.length) list.appendChild(riskEl('p', 'risk-empty', '没有匹配账户。'));
    };
    search.addEventListener('input', refresh); refresh(); const closeButton = riskButton('关闭'); closeButton.addEventListener('click', close); form.appendChild(closeButton);
  });
}

function riskRailCard(account) {
  const decision = riskDecision(account); const [label, color] = riskStatus(decision);
  const card = riskButton('', `risk-account-card${account.id === riskDashboardState.selectedAccountId ? ' selected' : ''}`);
  card.setAttribute('aria-pressed', String(account.id === riskDashboardState.selectedAccountId));
  const name = riskEl('span', 'risk-account-name'); name.append(riskEl('i', `risk-dot ${color}`), riskEl('span', null, account.name));
  card.append(name, riskEl('span', 'risk-balance', fmtUSD(deriveCurrentBalance(account.currentSession))), riskEl('span', 'risk-account-risk', decision.status === 'ALLOWED' ? `最大 1R: ${fmtUSD(decision.allowedR)}` : `${label}: ${fmtUSD(riskAllowed(decision))}`), riskEl('span', 'risk-account-type', drawdownTypeLabel(account.drawdownType)));
  card.addEventListener('click', () => riskMutate(selectAccount(riskDashboardState, account.id), `已切换至 ${account.name}。`));
  return card;
}

function renderRiskDashboard() {
  const host = riskDashboardHost; if (!host) return;
  host.textContent = '';
  const account = riskAccount(); const decision = riskDecision(account); const [statusLabel, statusColor] = riskStatus(decision);
  const panel = riskEl('section', 'risk-dashboard'); panel.setAttribute('aria-label', 'Trading Risk Manager 风险看板');
  const summary = riskEl('section', 'risk-summary');
  const status = riskEl('p', `risk-status ${statusColor}`); status.append(riskEl('i', 'risk-dot'), riskEl('span', null, statusLabel)); summary.appendChild(status);
  summary.appendChild(riskEl('p', 'risk-kicker', decision?.status === 'TAIL_RISK' ? '下一单尾部最大允许 1R' : '下一单最大允许 1R'));
  summary.appendChild(riskEl('p', `risk-amount ${statusColor}`, decision ? fmtUSD(riskAllowed(decision)) : '—'));
  summary.appendChild(riskEl('p', 'risk-base', `日初 Base R: ${decision ? fmtUSD(decision.baseR) : '—'}`));
  panel.appendChild(summary);
  const accounts = riskEl('section', 'risk-accounts');
  const titleRow = riskEl('div', 'risk-title-row'); titleRow.appendChild(riskEl('h2', null, '账户'));
  const all = riskButton('查看全部', 'risk-link'); all.addEventListener('click', riskAllAccounts); titleRow.appendChild(all);
  const entry = document.createElement('a'); entry.className = 'risk-entry'; entry.href = 'https://xhb-d.github.io/trading-risk-manager/'; entry.target = '_blank'; entry.rel = 'noopener'; entry.textContent = '进入 Trading Risk Manager →'; titleRow.appendChild(entry); accounts.appendChild(titleRow);
  const railRow = riskEl('div', 'risk-rail-row'); const previous = riskButton('‹', 'risk-arrow'); previous.setAttribute('aria-label', '向左查看更多账户'); const rail = riskEl('div', 'risk-rail'); rail.tabIndex = 0;
  previous.addEventListener('click', () => rail.scrollBy({ left: -300, behavior: 'smooth' })); railRow.append(previous, rail);
  riskDashboardState.accounts.forEach(item => rail.appendChild(riskRailCard(item)));
  const add = riskButton('+ 添加账户', 'risk-add-account'); add.addEventListener('click', () => riskAccountForm()); rail.appendChild(add);
  const next = riskButton('›', 'risk-arrow'); next.setAttribute('aria-label', '向右查看更多账户'); next.addEventListener('click', () => rail.scrollBy({ left: 300, behavior: 'smooth' })); railRow.appendChild(next); accounts.appendChild(railRow);
  const picker = document.createElement('select'); picker.className = 'risk-mobile-picker'; picker.setAttribute('aria-label', '选择账户');
  const placeholder = new Option('选择账户', '', !account, !account);
  placeholder.disabled = true;
  picker.add(placeholder);
  riskDashboardState.accounts.forEach(item => picker.add(new Option(item.name, item.id, false, item.id === riskDashboardState.selectedAccountId)));
  picker.add(new Option('+ 添加账户', '__add__'));
  picker.addEventListener('change', () => {
    if (picker.value === '__add__') {
      // Reset before opening: canceling the dialog must leave a value from
      // which selecting “+ 添加账户” is a new change event next time.
      picker.value = riskDashboardState.selectedAccountId || '';
      riskAccountForm();
    } else if (picker.value) riskMutate(selectAccount(riskDashboardState, picker.value), '已切换账户。');
  });
  accounts.appendChild(picker);
  const actions = riskEl('div', 'risk-actions'); const update = riskButton('更新余额', 'risk-button primary'); update.disabled = !account; update.addEventListener('click', () => account && riskBalanceForm(account)); const undo = riskButton('撤销上一条余额更新'); undo.disabled = !account || account.currentSession.balanceEvents.length === 0; undo.addEventListener('click', () => account && riskConfirmUndo(account)); const edit = riskButton('编辑账户'); edit.disabled = !account; edit.addEventListener('click', () => account && riskAccountForm(account)); actions.append(update, undo, edit); accounts.appendChild(actions);
  panel.appendChild(accounts); host.appendChild(panel);
  host.appendChild(riskEl('p', 'risk-feedback', '风险数据沿用 Trading Risk Manager 本地记录。'));
}

export function initRiskDashboard(host) {
  // The existing production-bundle smoke test supplies a deliberately tiny
  // DOM shim. Do not make the state-card boot path depend on dashboard DOM.
  if (!host || typeof host.appendChild !== 'function') return;
  riskDashboardHost = host;
  riskDashboardStorage = riskStorage();
  riskDashboardState = riskNormalizeState(loadAppState(riskDashboardStorage));
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    riskDashboardState = riskNormalizeState(loadAppState(riskDashboardStorage));
    renderRiskDashboard();
    riskNotice('已读取其他页面更新的风险管理器数据。');
  });
  renderRiskDashboard();
}
