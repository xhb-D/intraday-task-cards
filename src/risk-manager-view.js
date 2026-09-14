import { createAccount, deleteAccount, selectAccount, updateAccountMeta } from './risk-manager/account-service.js';
import { addBalanceUpdate, deriveCurrentBalance, deriveDecision, preflightRollover, rolloverAllAccounts, undoLastBalanceUpdate, updateHardLossFloor } from './risk-manager/session-service.js';
import { drawdownTypeLabel, fmtDelta, fmtUSD } from './risk-manager/utils.js';
import { preserveScrollPosition } from './ui-preferences.js';

// Both routes mount this component separately. It never owns business state:
// the injected controller is the sole read/write authority.
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (text, className = 'risk-button') => { const node = el('button', className, text); node.type = 'button'; return node; };
const status = decision => decision?.status === 'ALLOWED' ? ['可以交易', 'green'] : decision?.status === 'TAIL_RISK' ? ['尾部风险', 'yellow'] : decision?.status === 'BLOCKED' ? ['禁止开仓', 'red'] : ['需要配置', 'muted'];
function field(form, { label, name, value = '', type = 'text', required = false, hint = '' }) { const wrap = el('label', 'risk-field'); wrap.appendChild(el('span', null, label)); const input = document.createElement(type === 'select' ? 'select' : 'input'); input.name = name; if (type !== 'select') { input.type = type; input.value = value ?? ''; } if (type === 'number') { input.inputMode = 'decimal'; input.step = '0.01'; input.min = '0.01'; } input.required = required; wrap.appendChild(input); if (hint) wrap.appendChild(el('small', null, hint)); form.appendChild(wrap); return input; }
let activeRiskDialog = null;
function riskDialog(title, build) { if (activeRiskDialog) return; const node = el('dialog', 'risk-dialog'); activeRiskDialog = node; const form = el('form', 'risk-dialog-body'); form.method = 'dialog'; form.appendChild(el('h2', null, title)); const close = () => { node.close(); node.remove(); if (activeRiskDialog === node) activeRiskDialog = null; }; build(form, close); node.appendChild(form); document.body.appendChild(node); node.showModal(); }

export function mountRiskManager(host, controller, { compact = false } = {}) {
  if (!host || typeof host.appendChild !== 'function') return { render() {}, destroy() {} };
  let disposed = false;
  let rolloverCommitting = false;
  const current = () => controller.getState();
  const selected = () => current().accounts.find(item => item.id === current().selectedAccountId) || null;
  const locked = () => controller.isLocked?.() === true;
  const notice = (message, kind = 'info') => { const region = host.querySelector?.('.risk-feedback'); if (region) { region.textContent = message; region.dataset.kind = kind; } };
  const mutate = (next, message) => { if (locked()) { notice('检测到其他标签页更新；风险修改已锁定。', 'error'); return false; } try { controller.commit(next); render(); notice(message || '已保存。', 'success'); return true; } catch (error) { notice(`未保存：${error.message || '本地存储不可用'}。请勿刷新。`, 'error'); return false; } };
  function accountForm(existing = null) {
    riskDialog(existing ? '编辑账户' : '添加账户', (form, close) => {
      form.appendChild(el('p', 'risk-dialog-note', existing ? '风险参考余额和最大亏损额度将在下一交易时段生效；当前时段的 Base R 保持冻结。' : '只记录已实现余额；不读取行情，也不下单。'));
      const name = field(form, { label: '账户名称', name: 'name', value: existing?.name, required: true }); const firm = field(form, { label: 'Prop Firm（可选）', name: 'firm', value: existing?.propFirm }); const type = field(form, { label: '账户类型（可选）', name: 'type', value: existing?.accountType }); const nominal = field(form, { label: '名义账户规模', name: 'nominal', type: 'number', value: existing?.nominalAccountSize, required: true }); const reference = field(form, { label: '风险参考余额', name: 'reference', type: 'number', value: existing?.riskReferenceBalance, required: true }); const loss = field(form, { label: '最大亏损额度', name: 'hardLoss', type: 'number', value: existing?.hardLossAmount, required: !existing });
      const drawdown = field(form, { label: '回撤类型', name: 'drawdown', type: 'select' }); [['EOD_TRAILING','EOD 日终跟踪回撤'], ['INTRADAY_TRAILING','盘中实时跟踪回撤'], ['STATIC','静态回撤'], ['NONE','无外部回撤限制']].forEach(([value, label]) => { const option = new Option(label, value); option.selected = (existing?.drawdownType || 'EOD_TRAILING') === value; drawdown.add(option); });
      const floor = field(form, { label: '默认 Hard Loss Floor', name: 'floor', type: 'number', value: existing?.defaultHardLossFloor, hint: '无外部回撤限制时留空。' }); const initial = existing ? null : field(form, { label: '初始已实现余额', name: 'initial', type: 'number', required: true }); const error = el('p', 'risk-form-error'); form.appendChild(error);
      const actions = el('div', 'risk-dialog-actions'); const cancel = button('取消'); const save = button(existing ? '保存账户' : '添加账户', 'risk-button primary'); save.type = 'submit'; cancel.addEventListener('click', close); actions.append(cancel, save); if (existing) { const remove = button('删除账户', 'risk-button danger'); remove.addEventListener('click', () => deleteConfirm(existing, close)); actions.appendChild(remove); } form.appendChild(actions);
      form.addEventListener('submit', event => { event.preventDefault(); const money = item => Number(item.value); const floorValue = floor.value.trim() ? Number(floor.value) : null; const payload = { name: name.value, propFirm: firm.value, accountType: type.value, nominalAccountSize: money(nominal), riskReferenceBalance: money(reference), hardLossAmount: existing && loss.value.trim() === '' ? null : money(loss), drawdownType: drawdown.value, defaultHardLossFloor: floorValue }; try { const next = existing ? updateAccountMeta(current(), existing.id, payload) : createAccount(current(), { ...payload, initialBalance: money(initial) }); if (mutate(next, existing ? '账户已更新；新配置按既有时段规则生效。' : '账户已添加。')) close(); } catch (failure) { error.textContent = failure.message; } });
    });
  }
  function deleteConfirm(item, closeParent) { riskDialog('删除账户', (form, close) => { form.appendChild(el('p', 'risk-dialog-note', `确定删除「${item.name}」吗？此操作会移除此账户的本地余额历史。`)); const actions = el('div', 'risk-dialog-actions'); const cancel = button('取消'); const confirm = button('确认删除', 'risk-button danger'); cancel.addEventListener('click', close); confirm.addEventListener('click', () => { if (mutate(deleteAccount(current(), item.id), '账户已删除。')) { close(); closeParent(); } }); actions.append(cancel, confirm); form.appendChild(actions); }); }
  function balanceForm(item) { riskDialog('更新余额', (form, close) => { form.appendChild(el('p', 'risk-dialog-note', `当前余额：${fmtUSD(deriveCurrentBalance(item.currentSession))}。仅输入最新已实现余额。`)); const balance = field(form, { label: '最新已实现账户余额', name: 'balance', type: 'number', required: true }); const error = el('p', 'risk-form-error'); form.appendChild(error); const actions = el('div', 'risk-dialog-actions'); const cancel = button('取消'); const save = button('确认更新', 'risk-button primary'); save.type = 'submit'; cancel.addEventListener('click', close); actions.append(cancel, save); form.appendChild(actions); form.addEventListener('submit', event => { event.preventDefault(); try { if (mutate(addBalanceUpdate(current(), item.id, Number(balance.value)), '余额已更新，风险结论已重新计算。')) close(); } catch (failure) { error.textContent = failure.message; } }); }); }
  function floorForm(item) { riskDialog('Hard Loss Floor', (form, close) => { form.appendChild(el('p', 'risk-dialog-note', '该余额线按既有回撤类型规则立即生效；EOD Trailing 在当前时段内冻结。')); const floor = field(form, { label: 'Hard Loss Floor', name: 'floor', type: 'number', value: item.currentSession.hardLossFloor }); const error = el('p', 'risk-form-error'); form.appendChild(error); const actions = el('div', 'risk-dialog-actions'); const cancel = button('取消'); const save = button('保存 Floor', 'risk-button primary'); save.type = 'submit'; cancel.addEventListener('click', close); actions.append(cancel, save); form.appendChild(actions); form.addEventListener('submit', event => { event.preventDefault(); try { if (mutate(updateHardLossFloor(current(), item.id, floor.value.trim() ? Number(floor.value) : null), 'Hard Loss Floor 已更新。')) close(); } catch (failure) { error.textContent = failure.message; } }); }); }
  function undoConfirm(item) { const event = item.currentSession.balanceEvents.at(-1); if (!event) return; riskDialog('撤销上一条余额更新', (form, close) => { form.appendChild(el('p', 'risk-dialog-note', `${fmtUSD(event.previousBalance)} → ${fmtUSD(event.newBalance)} 将被移除，风险状态会重新计算。`)); const actions = el('div', 'risk-dialog-actions'); const cancel = button('取消'); const confirm = button('确认撤销', 'risk-button danger'); cancel.addEventListener('click', close); confirm.addEventListener('click', () => { if (mutate(undoLastBalanceUpdate(current(), item.id), '已撤销上一条余额更新。')) close(); }); actions.append(cancel, confirm); form.appendChild(actions); }); }
  function rolloverConfirm() {
    const check = preflightRollover(current());
    riskDialog('开始新交易日', (form, close) => {
      form.appendChild(el('p', 'risk-dialog-note', check.ok
        ? `将同时结束并重新开始 ${check.preview.length} 个账户的交易时段。该操作不可按账户拆分。`
        : `以下账户尚未满足条件：${check.issues.map(item => `${item.name}（${item.reason}）`).join('；')}`));
      const actions = el('div', 'risk-dialog-actions');
      const cancel = button('取消');
      cancel.addEventListener('click', close);
      actions.appendChild(cancel);
      if (check.ok) {
        const confirm = button('确认开始新交易日', 'risk-button primary');
        confirm.addEventListener('click', () => {
          if (rolloverCommitting) return;
          rolloverCommitting = true;
          confirm.disabled = true;
          try {
            if (mutate(rolloverAllAccounts(current()), '全部账户已开始新交易日。')) {
              close();
              return;
            }
            rolloverCommitting = false;
            confirm.disabled = false;
          } catch (failure) {
            notice(failure.message, 'error');
            rolloverCommitting = false;
            close();
          }
        });
        actions.appendChild(confirm);
      }
      form.appendChild(actions);
    });
  }
  function cards(state) { const row = el('div','risk-rail-row'); const previous = button('‹','risk-arrow'); previous.setAttribute('aria-label','向左查看更多账户'); const rail = el('div', 'risk-rail'); const next = button('›','risk-arrow'); next.setAttribute('aria-label','向右查看更多账户'); previous.addEventListener('click',()=>rail.scrollBy?.({left:-300,behavior:'smooth'})); next.addEventListener('click',()=>rail.scrollBy?.({left:300,behavior:'smooth'})); state.accounts.forEach(item => { const decision = deriveDecision(item); const [label, color] = status(decision); const card = button('', `risk-account-card${item.id === state.selectedAccountId ? ' selected' : ''}`); card.setAttribute('aria-pressed', String(item.id === state.selectedAccountId)); card.append(el('span','risk-account-name',item.name), el('span','risk-balance',fmtUSD(deriveCurrentBalance(item.currentSession))), el('span',`risk-account-risk ${color}`, `${label} · ${fmtUSD(decision.finalRisk ?? decision.allowedR)}`), el('span','risk-account-type',drawdownTypeLabel(item.drawdownType))); card.addEventListener('click', () => mutate(selectAccount(current(), item.id), '已切换账户。')); rail.appendChild(card); }); const add = button('+ 添加账户','risk-add-account'); add.addEventListener('click',()=>accountForm()); rail.appendChild(add); row.append(previous,rail,next); return row; }
  function details(item) {
    const detail = el('section', 'risk-manager-detail');
    if (!item) {
      const empty = el('div', 'decision-card');
      empty.append(el('div', 'status-badge', '尚未选择账户'), el('p', null, '创建或选择一个账户以查看风险决策。'));
      detail.appendChild(empty);
      return detail;
    }
    const d = deriveDecision(item);
    const snap = item.currentSession.riskSnapshot;
    const [label, color] = status(d);
    const reasonMap = {
      TRADE_ALLOWED: '风险空间充足，可按当前允许额度执行。',
      RISK_REDUCED: '风险空间限制了标准档位，已自动降至可用档位。',
      FINAL_RISK: '剩余风险低于 Low R，下一单仅可使用剩余可用风险。',
      HARD_LOSS_FLOOR_REACHED: '当前余额已触及外部 Hard Loss Floor，禁止开新仓。',
      PROTECTION_LINE_BREACHED: '当前余额已触及有效保护线，禁止开新仓。',
    };
    const floorMap = {
      DAILY_CAPITAL_FLOOR: '当日本金保护线',
      PROFIT_PROTECTION_LINE: '50% 盈利保护线',
      HARD_LOSS_FLOOR: '外部 Hard Loss Floor',
    };
    const decision = el('section', 'decision-card');
    decision.append(
      el('span', `status-badge ${color}`, label),
      el('div', 'next-r-label', d.status === 'BLOCKED' ? '最大允许风险' : d.status === 'TAIL_RISK' ? '尾部最大允许风险' : '下一单最大允许 1R'),
      el('div', `next-r-value ${color}`, fmtUSD(d.status === 'BLOCKED' ? 0 : (d.finalRisk ?? d.allowedR))),
      el('div', 'next-r-sub', `日初 Base R: ${fmtUSD(d.baseR)}`),
      el('div', 'decision-reason', reasonMap[d.reason] || '风险条件不允许新开仓。')
    );
    if (d.status === 'TAIL_RISK') {
      const warning = el('div', 'tail-warning');
      warning.append(
        el('strong', null, '注意：当前可用风险低于 Low R。'),
        el('span', null, `完整止损不得超过 ${fmtUSD(d.finalRisk)}；不可按标准 R 加仓或放宽止损。`)
      );
      detail.appendChild(decision);
      detail.appendChild(warning);
    } else {
      if (d.status === 'BLOCKED') {
        decision.appendChild(el('div', 'blocked-reason', `绑定保护线：${floorMap[d.bindingFloor] || '当前有效保护线'}`));
      }
      detail.appendChild(decision);
    }
    const grid = el('dl', 'risk-diagnostics diagnostics');
    [
      ['当前已实现余额', fmtUSD(d.currentRealizedBalance)],
      ['本时段起始余额', fmtUSD(item.currentSession.sessionStartBalance)],
      ['上一交易日 EOD 余额', fmtUSD(item.currentSession.previousEodBalance)],
      ['本时段最高已实现余额', fmtUSD(d.peakRealizedBalance)],
      ['本时段最高已实现盈利', fmtDelta(d.peakRealizedProfit)],
      ['名义账户规模', fmtUSD(item.nominalAccountSize, 0)],
      ['本时段风险参考余额', snap?.version === 2 ? fmtUSD(snap.sessionRiskReferenceBalance, 0) : '—'],
      ['本时段最大亏损额度', snap?.version === 2 ? fmtUSD(snap.sessionHardLossAmount, 0) : '—（V1 快照）'],
      ['低 / 中 / 高 R 档位', `${fmtUSD(d.lowR)} / ${fmtUSD(d.midR)} / ${fmtUSD(d.highR)}`],
      ['Base 升级门槛', fmtUSD(d.baseUpgradeThreshold)],
      ['日初 Base R', fmtUSD(d.baseR)],
      ['盈利保护触发值', fmtUSD(d.profitLockTrigger)],
      ['盈利保护状态', d.profitLockActive ? '已启用' : '未启用'],
      ['当日本金保护线', fmtUSD(d.dailyCapitalFloor)],
      ['50% 盈利保护线', d.profitProtectionLine === null ? '—' : fmtUSD(d.profitProtectionLine)],
      ['外部账户失败线', d.hardLossFloor === null ? '无' : fmtUSD(d.hardLossFloor)],
      ['当前有效保护线', fmtUSD(d.effectiveProtectionLine)],
      ['当前可用风险空间', fmtUSD(d.availableRisk)],
      ['已配置风险参考余额（下一时段）', fmtUSD(item.riskReferenceBalance, 0)],
      ['已配置最大亏损额度（下一时段）', item.hardLossAmount === null ? '未设置' : fmtUSD(item.hardLossAmount, 0)],
      ['回撤类型', drawdownTypeLabel(item.drawdownType)],
    ].forEach(([key, value]) => {
      const row = el('div', 'diag-item');
      row.append(el('dt', 'label', key), el('dd', 'value', value));
      grid.appendChild(row);
    });
    detail.appendChild(grid);
    const pending = snap?.sessionRiskReferenceBalance !== item.riskReferenceBalance || snap?.sessionHardLossAmount !== item.hardLossAmount;
    if (pending) detail.appendChild(el('p', 'pending-badge', '下一时段生效：风险参考余额或最大亏损额度已修改；当前 Base R 保持冻结。'));
    const history = el('details', 'history-panel');
    history.appendChild(el('summary', null, `余额历史（${item.currentSession.balanceEvents.length}）`));
    const list = el('ul', 'history-list');
    item.currentSession.balanceEvents.forEach(event => list.appendChild(el('li', event.delta >= 0 ? 'pos' : 'neg', `${event.timestamp} · ${fmtUSD(event.previousBalance)} → ${fmtUSD(event.newBalance)}（${fmtDelta(event.delta)}）`)));
    if (!item.currentSession.balanceEvents.length) list.appendChild(el('li', 'empty-note', '本时段暂无余额更新。'));
    history.appendChild(list);
    detail.appendChild(history);
    return detail;
  }
  function render() { if (disposed) return; return preserveScrollPosition(() => { const state = current(); const item = selected(); host.textContent = ''; const decision = item ? deriveDecision(item) : null; const [label,color] = status(decision); const section = el('section', compact ? 'risk-dashboard' : 'risk-manager'); if (compact) { const summary = el('section','risk-summary'); summary.append(el('p',`risk-status ${color}`,label),el('p','risk-kicker',decision?.status === 'TAIL_RISK' ? '下一单尾部最大允许 1R' : '下一单最大允许 1R'),el('p',`risk-amount ${color}`,decision ? fmtUSD(decision.finalRisk ?? decision.allowedR) : '—'),el('p','risk-base',`日初 Base R: ${decision ? fmtUSD(decision.baseR) : '—'}`)); section.appendChild(summary); } const accounts = el('section','risk-accounts'); const title = el('div','risk-title-row'); title.appendChild(el('h2',null,compact ? '账户' : '账户与交易时段')); if (compact) { const entry = document.createElement('a'); entry.className = 'risk-entry'; entry.href = '#/risk'; entry.textContent = '进入 Trading Risk Manager →'; title.appendChild(entry); } accounts.append(title,cards(state)); const picker = document.createElement('select'); picker.className='risk-mobile-picker'; picker.setAttribute('aria-label','选择账户'); const placeholder=new Option('选择账户','',!item,!item); placeholder.disabled=true; picker.add(placeholder); state.accounts.forEach(account=>picker.add(new Option(account.name,account.id,false,account.id===state.selectedAccountId))); picker.add(new Option('+ 添加账户','__add__')); picker.addEventListener('change',()=>picker.value==='__add__'?accountForm():picker.value&&mutate(selectAccount(current(),picker.value),'已切换账户。')); accounts.appendChild(picker); const actions = el('div','risk-actions'); const add = button('添加账户'); add.addEventListener('click',() => accountForm()); const balance = button('更新余额','risk-button primary'); balance.disabled = !item; balance.addEventListener('click',() => item && balanceForm(item)); const undo = button('撤销上一条余额更新'); undo.disabled = !item || !item.currentSession.balanceEvents.length; undo.addEventListener('click',() => item && undoConfirm(item)); const edit = button('编辑账户'); edit.disabled = !item; edit.addEventListener('click',() => item && accountForm(item)); actions.append(add,balance,undo,edit); if (!compact) { if (item && ['INTRADAY_TRAILING','STATIC'].includes(item.drawdownType)) { const floor = button('Hard Loss Floor'); floor.addEventListener('click',() => floorForm(item)); actions.appendChild(floor); } const rollover = button('结束当前并开始新交易日'); rollover.addEventListener('click',rolloverConfirm); actions.appendChild(rollover); } accounts.appendChild(actions); section.appendChild(accounts); host.appendChild(section); if (!compact) host.appendChild(details(item)); host.appendChild(el('p','risk-feedback',locked() ? '检测到外部修改：风险写入已锁定，仍可导出。' : '风险数据由统一交易控制中心保存。')); }); }
  render(); return { render, destroy() { disposed = true; host.textContent = ''; } };
}

export function initRiskManagerView(host, controller) { return mountRiskManager(host, controller, { compact: false }); }
