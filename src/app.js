import { initExitResearchWorkbench } from './exit-research/ui/controller.js';
import { ORDER, BIASES, STRUCTURES_3M, VISIBLE_STRUCTURES_3M, DIRECTIONS, SETUPS, SETUP_LABELS, STAGES, ATTENTION, RESULTS, createWorkspace, stateOf, isDirectionAllowed, isSetupAllowed, holdingConflictWarning, instruction, changeBias, changeStructure, chooseSetup, changeDirection, setStage, markEntered, markExited, endOpportunity, deleteRecord, recordProgress, assertState, copy, researchSetupClass, effectiveInitialStop, effectiveBofToPbEvent, derivedManagementState, formatStopPrice, recordInitialStop, correctInitialStop, recordBofToPb, revertBofToPb } from './model.js';
import { renderHoldingReference } from './holding-reference.js';
import { makeEnvelope, exportMarkdown, dateKey, timeText, fullTime } from './persistence.js';
import { renderBannerVisibility, renderTextBanner } from './banner.js';
import { reportDiagnostic } from './diagnostics.js';
import { externalConflictPolicy } from './conflict.js';
import { loadCommodityPreferences, preserveScrollPosition, saveCommodityPreferences, setCommodityHidden, setCommodityManagerExpanded, toggleCardCollapsed, visibleCommoditySymbols } from './ui-preferences.js';
import { initRiskDashboard } from './risk-dashboard.js';
import { initRiskManagerView } from './risk-manager-view.js';
import { initAppearance } from './appearance.js';
import { applyRoute, normalizeRoute } from './router.js';
import { UNIFIED_KEY, CHIME_LEGACY_RECOVERY_MESSAGE, commitUnified, continueLegacyChimeRecovery, importSummary, loadUnified, makeUnified, normalizeImport, parseBackupRaw } from './unified-persistence.js';
import { clockLabel } from './natural-chime/time.js';
import { createOutputAdapter } from './natural-chime/output.js';
import { createCoordinator } from './natural-chime/coordinator.js';
import { createScheduler } from './natural-chime/scheduler.js';
import { initChimeView } from './natural-chime/view.js';

const cardsEl = document.querySelector('#cards');
const commodityDashboardEl = document.querySelector('#commodity-dashboard');
const historyBody = document.querySelector('#history-body');
const dialog = document.querySelector('#confirm-dialog');
const dataDialog = document.querySelector('#data-dialog');
const live = document.querySelector('#announcer');
let state = createWorkspace();
let pending = null;
const stopEditors = new Map();
let lastRaw = null;
let saveError = '';
let corruption = false;
let externalConflict = false;
let storageUnsafe = false;
let legacyChimeRecovery = false;
let recoveryCanonicalRaw = null;
let recoveryLegacyRaw = null;
let restoredNotice = '';
let historyScope = 'today';
let currentDay = '';
let collapsedCards = new Set();
let storage = null;
let commodityPreferences = null;
let unified = null;
let researchWorkbench = null;
let dashboardView = null;
let fullRiskView = null;
let appearanceView = null;
let chimeView = null;
let chimeOutput = null;
let chimeCoordinator = null;
let chimeScheduler = null;
let chimeStatusMessage = '';
let audioStateListenerAttached = false;
try { storage = globalThis.localStorage; } catch (_) { storage = null; }
commodityPreferences = loadCommodityPreferences(storage, ORDER);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const now = () => Date.now();
const duration = card => {
  if (!card.opportunity) return '—';
  const minutes = Math.max(0, Math.floor((now() - card.opportunity.stageSince) / 60000));
  return minutes < 1 ? '持续不足 1 分钟' : minutes < 60 ? `持续 ${minutes} 分钟` : `持续 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};
const announce = text => { live.textContent = text; };
const directionShort = direction => direction === 'long' ? '多' : direction === 'short' ? '空' : '—';
const semanticTone = value => ['bullish', 'long'].includes(value) ? 'bullish' : ['bearish', 'short'].includes(value) ? 'bearish' : 'neutral';
const writeLocked = () => externalConflict || storageUnsafe || legacyChimeRecovery;
function chimeDataCurrent() {
  if (!unified || writeLocked() || corruption || !storage?.getItem || typeof lastRaw !== 'string') return false;
  try { return storage.getItem(UNIFIED_KEY) === lastRaw; } catch { return false; }
}
function saveUnified(candidate, options = {}, phase = 'unified_storage_write') {
  try { return commitUnified(storage, candidate, options); }
  catch (error) {
    if (error.code === 'POST_WRITE_MISMATCH') storageUnsafe = true;
    reportDiagnostic(error, { phase });
    storageStatus();
    throw error;
  }
}

function storageStatus() {
  const label = document.querySelector('#save-status');
  const banner = document.querySelector('#storage-banner');
  const message = document.querySelector('#storage-message');
  const retry = document.querySelector('#storage-retry');
  const startFresh = document.querySelector('#start-fresh');
  const importJson = document.querySelector('#import-json');
  const importFile = document.querySelector('#import-file');
  const confirm = document.querySelector('#dialog-confirm');
  const policy = externalConflictPolicy(writeLocked());
  const safeReadOnly = policy.cardsInert || corruption;
  document.querySelector('#restore-note').textContent = restoredNotice;
  document.querySelector('#restore-note').hidden = !restoredNotice;
  document.querySelector('#export-raw').hidden = !corruption && !legacyChimeRecovery;
  document.querySelector('#export-chime-raw').hidden = !legacyChimeRecovery;
  document.querySelector('#export-json').disabled = legacyChimeRecovery || (corruption && !lastRaw);
  document.querySelector('#export-today').disabled = corruption;
  document.querySelector('#export-all').disabled = corruption;
  importJson.disabled = policy.disableDangerousDataActions;
  importFile.disabled = policy.disableDangerousDataActions;
  startFresh.disabled = policy.disableDangerousDataActions;
  confirm.disabled = policy.disableDangerousDataActions && pending?.kind !== 'ignore-legacy-chime';
  document.querySelector('#appearance-select').disabled = policy.disableDangerousDataActions;
  historyBody.inert = policy.historyInert || corruption;
  document.querySelector('#risk-dashboard-host').inert = safeReadOnly;
  document.querySelector('#chime-summary-host').inert = safeReadOnly;
  document.querySelector('#chime-settings-host').inert = safeReadOnly;
  document.querySelector('#risk-manager-host').inert = safeReadOnly;
  document.querySelectorAll('[data-delete]').forEach(button => { button.disabled = policy.historyInert || corruption; });
  if (corruption) {
    document.querySelector('#ignore-legacy-chime').hidden = true;
    label.textContent = '存档异常 · 未覆盖'; message.textContent = '本地存档未通过校验。GC / CL / ES 已显示，但原存档未被清空或覆盖；请导出原始存档、恢复有效备份，或明确开始空白工作区。'; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = false; cardsEl.inert = true; return;
  }
  if (legacyChimeRecovery) {
    label.textContent = '旧版报时设置需确认 · 当前页面只读'; message.textContent = CHIME_LEGACY_RECOVERY_MESSAGE; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = true; document.querySelector('#ignore-legacy-chime').hidden = false; cardsEl.inert = true; return;
  }
  document.querySelector('#ignore-legacy-chime').hidden = true;
  if (externalConflict) {
    label.textContent = '检测到外部修改 · 当前页面只读'; message.textContent = policy.message; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = true; cardsEl.inert = policy.cardsInert; return;
  }
  if (storageUnsafe) {
    label.textContent = '存档回读不一致 · 当前页面只读'; message.textContent = '统一存档写入后无法确认内容一致。为避免继续覆盖，编辑与导入已停止；请先导出 JSON 备份后刷新。'; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = true; cardsEl.inert = true; return;
  }
  startFresh.hidden = true;
  cardsEl.inert = false;
  if (saveError) { label.textContent = '尚未保存 · 请勿刷新'; message.textContent = saveError === 'Conflict' ? '其他页面修改了存档；本页请先导出 JSON，再刷新读取最新状态。' : '当前浏览器的本地文件模式无法可靠保存。页面仍可使用，当前内容保留在内存；请导出 JSON 备份，或用 localhost 模式获得更稳定持久化。'; renderBannerVisibility(banner, message.textContent); retry.hidden = false; return; }
  label.textContent = state.lastSavedAt ? `已本地保存 ${timeText(state.lastSavedAt)}` : '本地保存就绪'; message.textContent = ''; renderBannerVisibility(banner, message.textContent); retry.hidden = true;
}
function persist() {
  if (corruption) return false;
  const policy = externalConflictPolicy(writeLocked());
  if (unified) {
    if (!policy.allowPersist) { saveError = 'Conflict'; storageStatus(); return false; }
    try {
      const candidate = copy(unified); candidate.sections.intraday = makeEnvelope(state, now());
      const saved = saveUnified(candidate);
      unified = saved; state = copy(saved.sections.intraday.state); state.lastSavedAt = saved.savedAt; lastRaw = JSON.stringify(saved); saveError = ''; storageStatus(); dashboardView?.render(); fullRiskView?.render(); return true;
    } catch (error) { saveError = error.code || 'StorageUnavailable'; storageStatus(); return false; }
  }
  saveError = 'StorageUnavailable'; storageStatus(); return false;
}
function load() {
  try {
    const boot = loadUnified(storage);
    if (boot.source === 'recovery-required') { corruption = true; saveError = 'RecoveryRequired'; lastRaw = boot.raw || ''; return; }
    unified = boot.state;
    state = copy(unified.sections.intraday.state); state.lastSavedAt = unified.sections.intraday.savedAt; restoredNotice = boot.notice || '';
    if (boot.source === 'chime-recovery') { legacyChimeRecovery = true; recoveryCanonicalRaw = boot.raw; recoveryLegacyRaw = boot.legacyRaw; lastRaw = boot.raw; }
    if (boot.source === 'canonical-migrated') restoredNotice = '已安全升级统一存档；日内数据已迁移为 V5，原有历史和交易事实按对应迁移规则保留。';
    if (boot.source === 'legacy' || boot.source === 'blank') {
      try { unified = saveUnified(unified, {}, 'unified_first_write'); state.lastSavedAt = unified.savedAt; }
      catch (error) { reportDiagnostic(error, { phase: 'unified_first_write' }); saveError = 'StorageUnavailable'; }
    }
    if (!legacyChimeRecovery) lastRaw = boot.raw ?? JSON.stringify(unified); if (boot.source === 'storage-unavailable') saveError = 'StorageUnavailable'; return;
  } catch (error) { reportDiagnostic(error, { phase: 'unified_startup' }); corruption = true; return; }
}
function mutate(message, symbol, focus = '.state-title') {
  assertState(state); persist(); renderAll();
  if (symbol && focus) document.querySelector(`article[data-symbol="${symbol}"] ${focus}`)?.focus({ preventScroll: true });
  announce(message);
}
function option(symbol, action, value, text, selected, disabled = false) {
  return `<button type="button" class="option ${action}${selected ? ' selected' : ''}" data-action="${action}" data-symbol="${symbol}" data-value="${value}" data-tone="${semanticTone(value)}" aria-pressed="${selected}"${disabled ? ' disabled aria-disabled="true"' : ''}>${text}</button>`;
}
function renderResearchCapture(symbol, opportunity) {
  const stop = effectiveInitialStop(opportunity);
  const editor = stopEditors.get(opportunity.id);
  const editing = stop === null || Boolean(editor);
  const priceInput = editing ? `<form class="research-stop-form" data-stop-form="${symbol}"><label class="sr-only" for="stop-${symbol}">${symbol} Initial Stop 价格</label><input id="stop-${symbol}" data-stop-input="${symbol}" type="number" step="any" min="0" required inputmode="decimal" value="${escapeHtml(editor?.draft ?? '')}" aria-describedby="stop-error-${symbol}" placeholder="止损价格"><button type="submit">${stop === null ? '记录' : '保存修正'}</button>${stop !== null ? `<button type="button" data-action="stop-cancel" data-symbol="${symbol}">取消</button>` : ''}</form>` : `<button type="button" data-action="stop-edit" data-symbol="${symbol}">修正</button>`;
  const conversion = effectiveBofToPbEvent(opportunity);
  const management = `<div class="research-management"><span>当前管理：${derivedManagementState(opportunity)}</span>${researchSetupClass(opportunity.type) === 'BOF' ? (conversion ? `<span>BOF → PB：${timeText(conversion.effectiveAt).slice(0, 5)}</span><button type="button" data-action="bof-revert" data-symbol="${symbol}">撤销</button>` : `<button type="button" data-action="bof-to-pb" data-symbol="${symbol}">BOF → PB</button>`) : ''}</div>${conversion ? `<small>原始机会：${escapeHtml(SETUP_LABELS[opportunity.type])}</small>` : ''}`;
  return `<section class="research-capture" aria-label="${symbol} Research Capture"><div class="research-stop"><span>Initial Stop：${stop === null ? '待记录' : formatStopPrice(stop)}</span>${priceInput}</div><p class="research-error" id="stop-error-${symbol}" role="status"${editor?.error ? '' : ' hidden'}>${escapeHtml(editor?.error || '')}</p>${management}</section>`;
}
function renderHoldingManagementPanel(symbol, opportunity, status) {
  const reference = renderHoldingReference(opportunity, status);
  if (!reference) return '';
  const capture = status === 'position' ? renderResearchCapture(symbol, opportunity) : `<section class="research-capture research-placeholder" aria-label="${symbol} 管理信息占位"><div class="research-stop">Initial Stop：—</div><div class="research-management">当前管理：—</div></section>`;
  return `<aside class="holding-management" aria-label="${symbol} 管理信息"><div class="management-reference-slot">${reference}</div><div class="management-actions-slot">${capture}</div></aside>`;
}
function submitInitialStop(form) {
  if (pending || corruption || writeLocked()) return;
  const symbol = form.dataset.stopForm; if (!ORDER.includes(symbol)) return;
  const opportunity = state.cards[symbol].opportunity;
  if (stateOf(state.cards[symbol]) !== 'position') return;
  const input = form.querySelector('[data-stop-input]');
  const price = input.value.trim() === '' ? NaN : Number(input.value);
  if (!Number.isFinite(price) || price <= 0) {
    stopEditors.set(opportunity.id, { draft: input.value, error: '请输入大于 0 的有限数字' });
    renderAll(); document.querySelector(`#stop-${symbol}`)?.focus({ preventScroll: true }); return;
  }
  const result = effectiveInitialStop(opportunity) === null ? recordInitialStop(state, symbol, price, now()) : correctInitialStop(state, symbol, price, now());
  stopEditors.delete(opportunity.id);
  if (result.changed) mutate(`${symbol} Initial Stop 已记录`, symbol);
  else renderAll();
}
function renderCard(symbol) {
  const card = state.cards[symbol]; const opportunity = card.opportunity; const status = stateOf(card); const holding = status === 'position';
  const collapsed = collapsedCards.has(symbol);
  const [action, prohibition] = instruction(card);
  const bias = `<section class="classifier bias-field"><span class="field-label">当前偏见</span><div class="segment" role="group" aria-label="${symbol} 当前偏见">${Object.entries(BIASES).map(([key,label]) => option(symbol, 'bias', key, label, key === card.bias)).join('')}</div></section>`;
  const direction = holding ? `<div class="readonly" data-tone="${semanticTone(card.direction)}">本笔${DIRECTIONS[card.direction]} <small>只读</small></div>` : `<div class="segment" role="group" aria-label="${symbol} 交易方向">${Object.entries(DIRECTIONS).map(([key,label]) => option(symbol, 'direction', key, label, key === card.direction, card.needsStructureReview || !isDirectionAllowed(card.bias, key))).join('')}</div>`;
  const structure = `<section class="classifier structure-field"><span class="field-label">市场结构（MTF chanlun）</span><div class="segment structure-segment" role="group" aria-label="${symbol} 市场结构">${Object.entries(VISIBLE_STRUCTURES_3M).map(([key,label]) => option(symbol, 'structure', key, label, key === card.structure3m)).join('')}</div>${card.needsStructureReview ? '<p class="migration-note">旧版本机会：请先确认市场结构</p>' : ''}</section>`;
  const setups = holding ? `<div class="readonly">${SETUP_LABELS[opportunity.type]} <small>只读</small></div>` : `<div class="segment" role="group" aria-label="${symbol} 当前机会">${Object.entries(SETUPS).map(([key,label]) => option(symbol, 'setup', key, label, opportunity?.type === key, card.needsStructureReview || !isSetupAllowed(card.direction, card.structure3m, key))).join('')}</div>`;
  const entrySignal = '<div class="entry-signal readonly" aria-label="入场信号"><span class="entry-signal-label">入场信号</span><span class="entry-signal-lines"><span>均线一侧·BB收窄·气泡攻击&amp;吸收·流动性·信号K</span><span>原方向拒绝+新方向位移（COC）+价格接受（震荡）</span></span></div>';
  let stages = '<div class="empty" aria-hidden="true"></div>', entry = '<div class="empty" aria-hidden="true"></div>', ending = '<div class="empty" aria-hidden="true"></div>';
  if (opportunity && !holding) {
    stages = `<div class="stage-row" role="group" aria-label="${symbol} 注意力阶段">${ATTENTION.map(stage => `<button class="stage${stage === status ? ' selected' : ''}" data-action="stage" data-symbol="${symbol}" data-value="${stage}" type="button" aria-pressed="${stage === status}">${STAGES[stage]}</button>`).join('')}</div>`;
    entry = `<button class="entry${status === 'signal' ? ' hot' : ''}" data-action="entry" data-symbol="${symbol}" type="button">${symbol} 已入场</button>`;
    ending = `<div class="lifecycle"><button class="ending" data-action="end" data-symbol="${symbol}" data-value="invalid" type="button">机会失效</button><button class="ending" data-action="end" data-symbol="${symbol}" data-value="canceled" type="button">放弃机会</button></div>`;
  } else if (holding) ending = `<button class="exit" data-action="exit" data-symbol="${symbol}" type="button">${symbol} 已平仓</button>`;
  const managementPanel = renderHoldingManagementPanel(symbol, opportunity, status);
  const summary = opportunity ? `<dl class="task-summary" aria-label="${symbol} 当前任务摘要"><div><dt class="sr-only">当前偏见</dt><dd data-tone="${semanticTone(card.bias)}">${BIASES[card.bias]}</dd></div><div><dt class="sr-only">交易方向</dt><dd data-tone="${semanticTone(card.direction)}">${['long', 'short'].includes(card.direction) ? `<span class="summary-direction-active" data-tone="${semanticTone(card.direction)}">${DIRECTIONS[card.direction]}</span>` : DIRECTIONS[card.direction]}</dd></div><div><dt class="sr-only">市场结构</dt><dd data-tone="${semanticTone(card.structure3m)}">${STRUCTURES_3M[card.structure3m]}</dd></div><div><dt class="sr-only">当前机会</dt><dd data-tone="neutral">${SETUP_LABELS[opportunity.type]}</dd></div></dl>` : '';
  const controls = `<div class="card-controls"${collapsed ? ' hidden' : ''}>${bias}${structure}<section class="direction-field"><span class="field-label">${holding ? '本笔交易方向' : '交易方向（市场结构不明确时看HTF缺口）'}</span>${direction}</section><section class="opportunity-field"><span class="field-label">${holding ? '本笔机会' : '当前机会'}</span>${setups}${entrySignal}</section>${stages}</div>`;
  const toggleLabel = `${collapsed ? '展开' : '收起'} ${symbol} 卡片`;
  const conflictWarning = holdingConflictWarning(card);
  const hideLabel = `隐藏 ${symbol} 卡片`;
  const taskMain = `<div class="task-meta"><span>当前状态</span><span class="duration">${duration(card)}</span></div><div class="task-content"><div class="task-copy"><p class="state-title" tabindex="-1">${STAGES[status]}</p><p class="instruction">${action}<span>${prohibition}</span>${conflictWarning ? `<strong class="holding-warning">${conflictWarning}</strong>` : ''}</p></div>${summary}</div>`;
  const task = `<section class="task${summary ? ' with-summary' : ''}${managementPanel ? ' with-reference' : ''}">${managementPanel ? `<div class="task-main">${taskMain}</div>${managementPanel}` : taskMain}</section>`;
  return `<article class="card state-${status}${collapsed ? ' is-collapsed' : ''}" data-symbol="${symbol}"><header class="card-head"><h2 class="symbol">${symbol}</h2><div class="card-head-actions"><button class="card-hide" data-action="hide-card" data-symbol="${symbol}" type="button" title="${hideLabel}" aria-label="${hideLabel}">隐藏</button><span class="tf">3M</span><button class="card-toggle" data-action="toggle-collapse" data-symbol="${symbol}" type="button" aria-expanded="${!collapsed}" aria-label="${toggleLabel}"><span class="card-chevron" aria-hidden="true"></span></button></div></header>${controls}${task}${entry}${ending}</article>`;
}
function renderCommodityDashboard() {
  const hiddenSymbols = commodityPreferences.hiddenSymbols;
  const expanded = hiddenSymbols.length > 0 && commodityPreferences.managerExpanded;
  const managerLabel = expanded ? '收起隐藏商品列表' : '展开隐藏商品列表';
  const hiddenRows = expanded ? `<div class="commodity-dashboard-list">${hiddenSymbols.map(symbol => `<div class="commodity-dashboard-row"><strong>${symbol}</strong><span>已隐藏，状态仍保留</span><button type="button" data-action="restore-card" data-symbol="${symbol}">恢复显示</button></div>`).join('')}</div>` : '';
  commodityDashboardEl.innerHTML = `<div class="commodity-dashboard-summary"><h2 id="commodity-dashboard-title">商品看板</h2><div class="commodity-dashboard-actions"><span>已隐藏商品 ${hiddenSymbols.length}</span>${hiddenSymbols.length ? `<button type="button" data-action="toggle-commodity-manager" aria-expanded="${expanded}" aria-label="${managerLabel}">${expanded ? '收起' : '展开'}</button>` : ''}</div></div>${hiddenRows}`;
}
function recordsForScope() {
  const day = dateKey(now()); return state.records.filter(record => historyScope === 'all' || record.endedAt === null || dateKey(record.registeredAt) === day || dateKey(record.endedAt) === day).sort((a,b) => b.registeredAt - a.registeredAt);
}
function renderHistory() {
  const records = recordsForScope(); currentDay = dateKey(now());
  document.querySelector('#history-count').textContent = `${records.length} 条 · ${historyScope === 'all' ? '全部保留' : '今日及未结束'}`;
  document.querySelector('#history-empty').hidden = Boolean(records.length); document.querySelector('#history-table').hidden = !records.length;
  document.querySelectorAll('[data-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === historyScope)));
  historyBody.innerHTML = records.map(record => `<tr><td>${escapeHtml(fullTime(record.registeredAt))}</td><td><b>${record.symbol}</b></td><td>${directionShort(record.direction)}</td><td>${SETUP_LABELS[record.type]}</td><td class="position">${escapeHtml(record.zone ?? '—')}</td><td>${recordProgress(record)}</td><td><button class="delete" data-delete="${escapeHtml(record.id)}" type="button">删除</button></td></tr>`).join('');
}
function renderChime() {
  const chime = unified?.sections?.chime; if (!chime || !chimeView) return;
  const enabledSlots = chime.slots.filter(slot => slot.enabled).length;
  const eligibleSlots = chime.slots.filter(slot => slot.enabled && !slot.paused).length;
  chimeView.render(chime, { ...(chimeCoordinator?.getStatus() || {}), enabledSlots, eligibleSlots }, { locked: writeLocked() || corruption, clockText: clockLabel(now()), messageText: chimeStatusMessage });
}
function persistChime(next, changedSlotId = null) {
  if (!unified || writeLocked() || corruption) return false;
  try {
    const candidate = copy(unified); candidate.sections.chime = copy(next);
    unified = saveUnified(candidate, {}, 'chime_settings_commit');
    state.lastSavedAt = unified.savedAt; lastRaw = JSON.stringify(unified); saveError = ''; chimeStatusMessage = '';
    chimeCoordinator?.settingsChanged(); chimeScheduler?.update(changedSlotId); storageStatus(); renderChime(); return true;
  } catch (error) { saveError = error.code || 'StorageUnavailable'; storageStatus(); renderChime(); return false; }
}
function renderAll() { return preserveScrollPosition(() => { try { const visibleSymbols = visibleCommoditySymbols(ORDER, commodityPreferences); renderCommodityDashboard(); cardsEl.className = `cards cards--count-${visibleSymbols.length}`; cardsEl.innerHTML = visibleSymbols.map(renderCard).join(''); renderHistory(); storageStatus(); renderChime(); if (globalThis.location?.hash === '#/exit-research') researchWorkbench?.refresh(); } catch (error) { if (!error.code) error.code = 'RENDER_STATE_ERROR'; throw error; } }); }
function openConfirmation(action, title, message, confirm, warning = '') {
  if (pending) return;
  pending = { ...action, revision: state.revision, storageRaw: lastRaw }; document.querySelector('#dialog-title').textContent = title; document.querySelector('#dialog-message').textContent = message; document.querySelector('#dialog-confirm').textContent = confirm; document.querySelector('#dialog-confirm').disabled = writeLocked() && action.kind !== 'ignore-legacy-chime';
  const warningEl = document.querySelector('#dialog-warning'); warningEl.textContent = warning; warningEl.hidden = !warning; dialog.showModal(); document.querySelector('#dialog-cancel').focus();
}
function finishConfirmation(confirmed) {
  const action = pending; pending = null; dialog.close();
  if (!confirmed) { announce('已取消；任务、计时和机会记录保持不变'); return; }
  if (action.kind === 'ignore-legacy-chime') {
    if (!legacyChimeRecovery) return;
    try {
      const result = continueLegacyChimeRecovery(storage, { expectedRaw: recoveryCanonicalRaw, expectedLegacyRaw: recoveryLegacyRaw });
      unified = result.state; state = copy(unified.sections.intraday.state); state.lastSavedAt = unified.savedAt; lastRaw = result.raw;
      legacyChimeRecovery = false; recoveryCanonicalRaw = null; recoveryLegacyRaw = null; saveError = ''; restoredNotice = '已按明确确认忽略无法识别的旧报时设置；原旧键保持不变，当前使用默认报时设置。';
      appearanceView?.render(unified.preferences.appearance); dashboardView?.render(); fullRiskView?.render(); chimeCoordinator?.settingsChanged(); chimeScheduler?.update(); renderAll(); announce('旧报时设置已忽略；统一存档已安全升级，原始旧键保持不变');
    } catch (error) { reportDiagnostic(error, { phase: 'chime_legacy_recovery' }); saveError = error.code || 'StorageUnavailable'; storageStatus(); announce('旧报时设置未忽略；原始数据保持不变，请重新检查存档'); }
    return;
  }
  if (writeLocked()) { announce('检测到存档冲突或回读不一致；当前页面已锁定，本次确认未应用'); return; }
  if (action.revision !== state.revision) { reportDiagnostic(Object.assign(new Error('确认操作版本已过期'), { code: 'REVISION_CONFLICT' }), { phase: 'confirmation', relevantSymbol: action.symbol || null }); announce('任务已变化，本次确认未应用'); return; }
  if (action.kind === 'restore') { try { if (writeLocked()) return; const saved = saveUnified(action.unified, { preImport: true, expectedRaw: action.storageRaw }, 'unified_import_commit'); unified = saved; state = copy(saved.sections.intraday.state); state.lastSavedAt = saved.savedAt; lastRaw = JSON.stringify(saved); corruption = false; saveError = ''; chimeCoordinator?.settingsChanged(); chimeScheduler?.update(); appearanceView?.render(unified.preferences.appearance); restoredNotice = `已恢复${action.importKind === 'unified' ? '完整备份' : '风险管理器备份'}。${action.migrated ? '其中日内数据已迁移为 V5。' : ''}仍须对照交易平台核对当前任务与持仓。`; dashboardView?.render(); fullRiskView?.render(); renderAll(); announce('备份已恢复；旧记录未合并，不发送任何订单'); } catch (error) { saveError = error.code || 'StorageUnavailable'; storageStatus(); announce('导入前快照或统一存档写入失败；当前内存未改变'); } return; }
  if (action.kind === 'fresh') { try { const fresh = makeEnvelope(createWorkspace(now()), now()); const candidate = makeUnified(fresh); const saved = saveUnified(candidate); unified = saved; state = copy(saved.sections.intraday.state); state.lastSavedAt = saved.savedAt; lastRaw = JSON.stringify(saved); corruption = false; saveError = ''; chimeCoordinator?.settingsChanged(); chimeScheduler?.update(); restoredNotice = '已明确开始空白工作区；原异常存档已保留在原始导出中。'; dashboardView?.render(); fullRiskView?.render(); renderAll(); announce('已开始空白工作区；请按实际交易状态重新建立任务'); } catch (error) { saveError = error.code || 'StorageUnavailable'; storageStatus(); } return; }
  const card = state.cards[action.symbol]; if (!card || card.opportunity?.id !== action.opportunityId && !['bias', 'direction', 'structure'].includes(action.kind)) return;
  if (action.kind === 'bias') { const result = changeBias(state, action.symbol, action.bias, now()); if (result.changed) mutate(`${action.symbol} 当前偏见：${BIASES[action.bias]}`, action.symbol); }
  if (action.kind === 'direction') { const result = changeDirection(state, action.symbol, action.direction, now(), true); if (result.changed) mutate(`${action.symbol} 旧机会因方向改变结束；当前无机会`, action.symbol); }
  if (action.kind === 'structure') { const result = changeStructure(state, action.symbol, action.structure3m, now()); if (result.changed) mutate(`${action.symbol} 市场结构：${STRUCTURES_3M[action.structure3m]}`, action.symbol); }
  if (action.kind === 'entry') { const result = markEntered(state, action.symbol, now(), true); if (result.changed) mutate(`${action.symbol} 已确认入场；本卡进入持仓`, action.symbol); }
  if (action.kind === 'exit') { const result = markExited(state, action.symbol, now(), true); if (result.changed) mutate(`${action.symbol} 已确认全部平仓；保留方向，回到无机会`, action.symbol); }
}
function handleAction(button) {
  const { action, symbol, value } = button.dataset; if (!ORDER.includes(symbol)) return;
  if (action === 'hide-card') {
    commodityPreferences = setCommodityManagerExpanded(setCommodityHidden(commodityPreferences, symbol, true, ORDER), true, ORDER); saveCommodityPreferences(storage, commodityPreferences, ORDER); renderAll();
    commodityDashboardEl.querySelector('[data-action="toggle-commodity-manager"]')?.focus({ preventScroll: true }); announce(`${symbol} 已隐藏；状态与记录保持不变`); return;
  }
  if (action === 'toggle-collapse') {
    if (pending || corruption || writeLocked() || button.disabled) return;
    collapsedCards = toggleCardCollapsed(collapsedCards, symbol); renderAll();
    document.querySelector(`article[data-symbol="${symbol}"] .card-toggle`)?.focus({ preventScroll: true }); announce(`${symbol} 卡片已${collapsedCards.has(symbol) ? '收起' : '展开'}`); return;
  }
  if (pending || corruption || writeLocked() || button.disabled) return;
  const card = state.cards[symbol];
  if (action === 'stop-edit' && stateOf(card) === 'position') {
    stopEditors.set(card.opportunity.id, { draft: String(effectiveInitialStop(card.opportunity)), error: '' }); renderAll();
    document.querySelector(`#stop-${symbol}`)?.focus({ preventScroll: true }); return;
  }
  if (action === 'stop-cancel') { if (card.opportunity) stopEditors.delete(card.opportunity.id); renderAll(); return; }
  if (action === 'bof-to-pb') { if (recordBofToPb(state, symbol, now()).changed) mutate(`${symbol} 当前管理：PB`, symbol); return; }
  if (action === 'bof-revert') { if (revertBofToPb(state, symbol, now()).changed) mutate(`${symbol} 已撤销 BOF → PB；当前管理：BOF`, symbol); return; }
  if (action === 'bias') {
    const result = changeBias(state, symbol, value, now());
    if (result.changed) mutate(`${symbol} 当前偏见：${BIASES[value]}`, symbol);
    return;
  }
  if (action === 'structure') {
    const result = changeStructure(state, symbol, value, now());
    if (result.changed) mutate(`${symbol} 市场结构：${STRUCTURES_3M[value]}`, symbol); return;
  }
  if (action === 'direction') {
    const result = changeDirection(state, symbol, value, now(), false);
    if (result.needsConfirmation) openConfirmation({ kind: 'direction', symbol, direction: value, opportunityId: card.opportunity.id }, `改变 ${symbol} 当前方向？`, `${DIRECTIONS[card.direction]} → ${DIRECTIONS[value]}\n改变方向将结束该机会。其他品种保持不变。`, '确认改变');
    else if (result.changed) mutate(`${symbol} 当前${DIRECTIONS[value]}`, symbol); return;
  }
  if (action === 'setup') { const result = chooseSetup(state, symbol, value, now()); if (result.changed) mutate(`${symbol} ${SETUPS[value]}进入等待；已立即登记`, symbol); return; }
  if (action === 'stage') { if (setStage(state, symbol, value, now())) mutate(`${symbol} 已切换到${STAGES[value]}`, symbol); return; }
  if (action === 'entry') { if (card.opportunity && ATTENTION.includes(stateOf(card))) openConfirmation({ kind: 'entry', symbol, opportunityId: card.opportunity.id }, `确认 ${symbol} 已实际入场？`, `${symbol} · ${DIRECTIONS[card.direction]} · ${SETUP_LABELS[card.opportunity.type]}\n\n仅记录已经实际成交的事实，不发送订单。`, '确认已入场'); return; }
  if (action === 'exit') { if (stateOf(card) === 'position') openConfirmation({ kind: 'exit', symbol, opportunityId: card.opportunity.id }, `确认 ${symbol} 已全部平仓？`, `${symbol} · ${SETUP_LABELS[card.opportunity.type]}\n\n仅在本笔已经实际全部平仓后确认。部分减仓不属于已平仓。`, '确认已平仓'); return; }
  if (action === 'end') { if (endOpportunity(state, symbol, value, now())) mutate(`${symbol} 机会${RESULTS[value]}；方向保留，当前无机会`, symbol); }
}
function handleCommodityDashboardAction(button) {
  const { action, symbol } = button.dataset;
  if (action === 'toggle-commodity-manager') {
    commodityPreferences = setCommodityManagerExpanded(commodityPreferences, !commodityPreferences.managerExpanded, ORDER); saveCommodityPreferences(storage, commodityPreferences, ORDER); renderAll();
    commodityDashboardEl.querySelector('[data-action="toggle-commodity-manager"]')?.focus({ preventScroll: true }); announce(`隐藏商品列表已${commodityPreferences.managerExpanded ? '展开' : '收起'}`); return;
  }
  if (action === 'restore-card' && ORDER.includes(symbol)) {
    commodityPreferences = setCommodityHidden(commodityPreferences, symbol, false, ORDER); saveCommodityPreferences(storage, commodityPreferences, ORDER); renderAll();
    document.querySelector(`article[data-symbol="${symbol}"] .card-hide`)?.focus({ preventScroll: true }); announce(`${symbol} 已恢复显示；状态与记录保持不变`);
  }
}
function download(text, filename, type) { const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }

function attachAudioStateListener() {
  if (audioStateListenerAttached) return;
  const context = chimeOutput?.context;
  if (!context) return;
  const update = () => chimeCoordinator?.setAudioUnlocked(chimeOutput.audioUnlocked);
  if (context.addEventListener) context.addEventListener('statechange', update);
  else context.onstatechange = update;
  audioStateListenerAttached = true;
}
async function startChime() {
  if (writeLocked() || corruption || !unified) return;
  const unlocked = await chimeOutput.unlock();
  attachAudioStateListener();
  chimeCoordinator.setAudioUnlocked(unlocked.ok && chimeOutput.audioUnlocked);
  if (!unlocked.ok) { chimeStatusMessage = unlocked.reason; renderChime(); announce(unlocked.reason); return; }
  const permission = await chimeOutput.requestNotificationPermission(unified.sections.chime);
  const result = await chimeCoordinator.start();
  chimeStatusMessage = result.ok ? (permission.message || '') : result.message;
  if (result.ok) announce(permission.message || '自然周期报时已启动'); else announce(result.message);
  renderChime();
}
function pauseChime() {
  chimeOutput?.stop();
  const result = chimeCoordinator?.pause();
  chimeStatusMessage = result?.ok ? '' : result?.message || '无法安全暂停报时。';
  announce(chimeStatusMessage || '自然周期报时已暂停'); renderChime();
}
async function previewChime() {
  if (writeLocked() || corruption || !unified) return;
  const unlocked = await chimeOutput.unlock();
  attachAudioStateListener();
  chimeCoordinator.setAudioUnlocked(unlocked.ok && chimeOutput.audioUnlocked);
  if (!unlocked.ok) { chimeStatusMessage = unlocked.reason; renderChime(); return; }
  const result = await chimeCoordinator.runPreview(() => chimeOutput.preview(unified.sections.chime, () => chimeCoordinator.canOutput()));
  chimeStatusMessage = result?.message || [result?.sound?.reason, result?.speech?.message].filter(Boolean).join(' ');
  if (chimeStatusMessage) announce(chimeStatusMessage);
  renderChime();
}

cardsEl.addEventListener('submit', event => { const form = event.target.closest('[data-stop-form]'); if (!form) return; event.preventDefault(); safe(() => submitInitialStop(form), { phase: 'research_capture', relevantSymbol: form.dataset.stopForm }); });
cardsEl.addEventListener('input', event => { const input = event.target.closest('[data-stop-input]'); if (!input) return; const opportunity = state.cards[input.dataset.stopInput]?.opportunity; if (opportunity && !writeLocked() && !corruption) stopEditors.set(opportunity.id, { draft: input.value, error: '' }); });
cardsEl.addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button && event.detail <= 1) safe(() => handleAction(button), { phase: 'interaction', relevantSymbol: button.dataset.symbol }); });
commodityDashboardEl.addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button && event.detail <= 1) safe(() => handleCommodityDashboardAction(button), { phase: 'commodity_dashboard_interaction', relevantSymbol: button.dataset.symbol }); });
historyBody.addEventListener('click', event => { const button = event.target.closest('[data-delete]'); if (!button || writeLocked() || event.detail > 1) return; safe(() => { if (deleteRecord(state, button.dataset.delete)) { persist(); renderAll(); announce('已删除本条机会记录；任务和持仓不变，后续状态变化不会自动恢复该记录'); } }, { phase: 'interaction' }); });
document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => { historyScope = button.dataset.scope; renderHistory(); }));
document.querySelector('#dialog-cancel').addEventListener('click', () => finishConfirmation(false)); document.querySelector('#dialog-confirm').addEventListener('click', () => finishConfirmation(true)); dialog.addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
document.querySelector('#data-tools').addEventListener('click', () => { document.querySelector('#data-feedback').textContent = ''; dataDialog.showModal(); }); document.querySelector('#data-close').addEventListener('click', () => dataDialog.close());
document.querySelector('#export-today').addEventListener('click', () => { download(exportMarkdown(state, 'today'), `日内机会_${dateKey(now())}.md`, 'text/markdown;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成 Markdown 下载；当前任务未修改。'; });
document.querySelector('#export-all').addEventListener('click', () => { download(exportMarkdown(state, 'all'), '日内机会_全部.md', 'text/markdown;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成 Markdown 下载；当前任务未修改。'; });
document.querySelector('#export-json').addEventListener('click', () => { const payload = unified ? copy(unified) : makeEnvelope(state); download(JSON.stringify(payload, null, 2), `交易控制中心_完整备份_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成完整备份下载（状态卡、风险管理器与外观）。'; });
document.querySelector('#export-risk-json').addEventListener('click', () => { download(JSON.stringify(unified?.sections.riskManager || { schemaVersion: 2, selectedAccountId: null, accounts: [] }, null, 2), `Trading_Risk_Manager_备份_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成风险管理器分项 JSON。'; });
document.querySelector('#export-raw').addEventListener('click', () => { download(lastRaw || '', `日内状态卡_原始存档_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已导出未经解析的原始存档；原数据未修改。'; });
document.querySelector('#export-chime-raw').addEventListener('click', () => { download(recoveryLegacyRaw ?? '', `自然周期报时_原始旧设置_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已导出未经解析的原始旧报时设置；本地原数据未修改。'; });
document.querySelector('#ignore-legacy-chime').addEventListener('click', () => { if (!legacyChimeRecovery) return; openConfirmation({ kind: 'ignore-legacy-chime' }, '忽略无法识别的旧报时设置？', '将保留旧报时键原始内容，并以默认报时设置升级统一存档。状态卡、风险管理器及外观保持原值；此选择不会删除或改写旧键。', '忽略并使用默认值', '只有确认不再迁移旧报时设置时继续。'); });
document.querySelector('#import-json').addEventListener('click', () => { if (writeLocked()) return; document.querySelector('#import-file').value = ''; document.querySelector('#import-file').click(); });
document.querySelector('#import-file').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; try { if (writeLocked()) { document.querySelector('#data-feedback').textContent = '检测到存档冲突或回读不一致；请刷新读取最新状态后再恢复备份。'; return; } if (file.size > 8 * 1024 * 1024) throw new Error('文件超过 8 MB 限制'); const raw = await file.text(); const parsed = parseBackupRaw(raw); const preview = normalizeImport(parsed, unified); if (writeLocked()) { document.querySelector('#data-feedback').textContent = '检测到其他标签页写入；恢复未应用。'; return; } dataDialog.close(); openConfirmation({ kind: 'restore', unified: preview.state, importKind: preview.kind, migrated: preview.migration?.migrated === true }, '确认导入备份？', `${importSummary(preview.kind, preview.state, preview.migration)}\n\n导入前会先保存当前完整存档快照；导入不会产生订单。`, '确认导入', '请先导出当前完整 JSON 备份。确认前若检测到其他标签页写入，本次导入将取消。'); } catch (error) { document.querySelector('#data-feedback').textContent = `未导入：${error.message}。原数据未改变。`; } finally { event.target.value = ''; } });
document.querySelector('#storage-retry').addEventListener('click', () => { if (!writeLocked()) persist(); });
document.querySelector('#start-fresh').addEventListener('click', () => { if (!writeLocked()) openConfirmation({ kind: 'fresh' }, '开始空白工作区？', '将以空白三卡开始，并在下一次保存时替换当前无法读取的本地存档。请先导出原始存档（如需保留）。', '确认开始空白', '恢复有效 JSON 备份不会覆盖原存档；开始空白工作区会在下次保存时替换它。'); });
window.addEventListener('storage', event => { if (event.key === UNIFIED_KEY && event.newValue !== lastRaw) { reportDiagnostic(Object.assign(new Error('检测到其他标签页写入'), { code: 'EXTERNAL_WRITE_CONFLICT' }), { phase: 'external_write' }); externalConflict = true; saveError = 'Conflict'; chimeCoordinator?.invalidate('检测到统一存档外部修改；本页报时已停止。'); storageStatus(); renderChime(); } });
window.addEventListener('focus', () => renderAll()); setInterval(() => { ORDER.forEach(symbol => { const element = document.querySelector(`article[data-symbol="${symbol}"] .duration`); if (element) element.textContent = duration(state.cards[symbol]); }); if (currentDay !== dateKey(now())) renderHistory(); }, 15000);
setInterval(renderChime, 1000);
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => chimeView?.refreshVoices());
function safe(fn, context = { phase: 'runtime' }) { try { fn(); } catch (error) { reportDiagnostic(error, context); const banner = document.querySelector('#error-banner'); const message = '页面数据发生异常，已停止编辑；未主动清空存档。请导出 JSON 备份后排查。'; renderTextBanner(banner, message); cardsEl.inert = true; } }

load();
chimeOutput = createOutputAdapter();
let hadChimeLeadership = false;
chimeCoordinator = createCoordinator({
  isDataCurrent: chimeDataCurrent,
  isAudioUnlocked: () => chimeOutput.audioUnlocked,
  onChange: status => { if (hadChimeLeadership && !status.leader) chimeOutput.stop(); hadChimeLeadership = status.leader; chimeScheduler?.update(); renderChime(); }
});
chimeScheduler = createScheduler({ coordinator: chimeCoordinator, output: chimeOutput, getChime: () => unified?.sections?.chime, onStatus: message => { chimeStatusMessage = message; renderChime(); } });
chimeView = initChimeView({
  summaryHost: document.querySelector('#chime-summary-host'), settingsHost: document.querySelector('#chime-settings-host'),
  onSlotChange: (slotId, next) => persistChime(next, slotId),
  onPreferenceChange: (_key, next) => persistChime(next),
  onStart: () => { void startChime(); }, onPause: pauseChime, onPreview: () => { void previewChime(); }
});
appearanceView = initAppearance(document.querySelector('#appearance-select'), { getItem: () => unified?.preferences?.appearance }, document.documentElement, nextAppearance => {
  if (!unified || writeLocked() || corruption) return false;
  const candidate = copy(unified); candidate.preferences.appearance = nextAppearance;
  try { unified = saveUnified(candidate, {}, 'appearance_update'); lastRaw = JSON.stringify(unified); state.lastSavedAt = unified.savedAt; dashboardView?.render(); fullRiskView?.render(); storageStatus(); return true; } catch (error) { saveError = error.code || 'StorageUnavailable'; storageStatus(); return false; }
});
try { researchWorkbench = initExitResearchWorkbench(document.querySelector('#exit-research-host'), { getIntraday: () => state, storage }); }
catch (error) { const host = document.querySelector('#exit-research-host'); if (host) host.textContent = 'Exit Research 暂不可用；首页状态卡仍可正常使用。'; reportDiagnostic(error, { phase: 'exit_research_init' }); }
function route() { const currentHash = globalThis.location?.hash || ''; const normalized = normalizeRoute(currentHash); if (globalThis.location && currentHash !== normalized) globalThis.location.hash = normalized; else { const result = applyRoute(document, normalized); if (result.route === 'exit-research') researchWorkbench?.refresh(); else researchWorkbench?.hide(); } }
window.addEventListener('hashchange', route); route();
try { dashboardView = initRiskDashboard(document.querySelector('#risk-dashboard-host'), {
  getState: () => unified?.sections.riskManager,
  isLocked: () => writeLocked(),
  commit: nextRisk => { const candidate = copy(unified); candidate.sections.riskManager = copy(nextRisk); const saved = saveUnified(candidate, {}, 'risk_dashboard_commit'); unified = saved; lastRaw = JSON.stringify(saved); state.lastSavedAt = saved.savedAt; fullRiskView?.render(); storageStatus(); }
}); } catch (error) {
  reportDiagnostic(error, { phase: 'risk_dashboard_init' });
  const riskHost = document.querySelector('#risk-dashboard-host');
  if (riskHost) riskHost.textContent = 'Trading Risk Manager 风险看板暂不可用；GC / CL / ES 状态卡仍可正常使用。';
}
try { fullRiskView = initRiskManagerView(document.querySelector('#risk-manager-host'), {
  getState: () => unified?.sections.riskManager,
  isLocked: () => writeLocked(),
  navigateHome: () => { globalThis.location.hash = '#/home'; },
  commit: nextRisk => { const candidate = copy(unified); candidate.sections.riskManager = copy(nextRisk); const saved = saveUnified(candidate, {}, 'risk_view_commit'); unified = saved; lastRaw = JSON.stringify(saved); state.lastSavedAt = saved.savedAt; dashboardView?.render(); storageStatus(); }
}); } catch (error) { reportDiagnostic(error, { phase: 'risk_view_init' }); }
renderAll(); storageStatus(); renderChime();
