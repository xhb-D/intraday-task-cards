import { ORDER, BIASES, STRUCTURES_3M, DIRECTIONS, SETUPS, STAGES, ATTENTION, RESULTS, createWorkspace, stateOf, hasRecord, isDirectionAllowed, instruction, registrationStatus, changeBias, changeStructure, chooseSetup, changeDirection, updateDraft, confirmPosition, setStage, markEntered, markExited, endOpportunity, deleteRecord, recordProgress, assertState, copy } from './model.js';
import { STORE_KEY, deserialize, makeEnvelope, validateEnvelope, exportMarkdown, dateKey, timeText, fullTime } from './persistence.js';
import { loadInitialWorkspace, saveWorkspace } from './startup.js';
import { renderBannerVisibility, renderTextBanner } from './banner.js';
import { reportDiagnostic } from './diagnostics.js';
import { externalConflictPolicy } from './conflict.js';

const cardsEl = document.querySelector('#cards');
const historyBody = document.querySelector('#history-body');
const dialog = document.querySelector('#confirm-dialog');
const dataDialog = document.querySelector('#data-dialog');
const live = document.querySelector('#announcer');
let state = createWorkspace();
let pending = null;
let lastRaw = null;
let saveError = '';
let corruption = false;
let externalConflict = false;
let restoredNotice = '';
let historyScope = 'today';
let currentDay = '';
let storage = null;
try { storage = globalThis.localStorage; } catch (_) { storage = null; }

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const now = () => Date.now();
const duration = card => {
  if (!card.opportunity) return '—';
  const minutes = Math.max(0, Math.floor((now() - card.opportunity.stageSince) / 60000));
  return minutes < 1 ? '持续不足 1 分钟' : minutes < 60 ? `持续 ${minutes} 分钟` : `持续 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
};
const announce = text => { live.textContent = text; };
const directionShort = direction => direction === 'long' ? '多' : direction === 'short' ? '空' : '—';

function storageStatus() {
  const label = document.querySelector('#save-status');
  const banner = document.querySelector('#storage-banner');
  const message = document.querySelector('#storage-message');
  const retry = document.querySelector('#storage-retry');
  const startFresh = document.querySelector('#start-fresh');
  const importJson = document.querySelector('#import-json');
  const importFile = document.querySelector('#import-file');
  const confirm = document.querySelector('#dialog-confirm');
  const policy = externalConflictPolicy(externalConflict);
  document.querySelector('#restore-note').textContent = restoredNotice;
  document.querySelector('#restore-note').hidden = !restoredNotice;
  document.querySelector('#export-raw').hidden = !corruption;
  document.querySelector('#export-json').disabled = corruption;
  document.querySelector('#export-today').disabled = corruption;
  document.querySelector('#export-all').disabled = corruption;
  importJson.disabled = policy.disableDangerousDataActions;
  importFile.disabled = policy.disableDangerousDataActions;
  startFresh.disabled = policy.disableDangerousDataActions;
  confirm.disabled = policy.disableDangerousDataActions;
  historyBody.inert = policy.historyInert;
  document.querySelectorAll('[data-delete]').forEach(button => { button.disabled = policy.historyInert; });
  if (corruption) {
    label.textContent = '存档异常 · 未覆盖'; message.textContent = '本地存档未通过校验。GC / CL / ES 已显示，但原存档未被清空或覆盖；请导出原始存档、恢复有效备份，或明确开始空白工作区。'; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = false; cardsEl.inert = true; return;
  }
  if (externalConflict) {
    label.textContent = '检测到外部修改 · 当前页面只读'; message.textContent = policy.message; renderBannerVisibility(banner, message.textContent); retry.hidden = true; startFresh.hidden = true; cardsEl.inert = policy.cardsInert; return;
  }
  startFresh.hidden = true;
  cardsEl.inert = false;
  if (saveError) { label.textContent = '尚未保存 · 请勿刷新'; message.textContent = saveError === 'Conflict' ? '其他页面修改了存档；本页请先导出 JSON，再刷新读取最新状态。' : '当前浏览器的本地文件模式无法可靠保存。页面仍可使用，当前内容保留在内存；请导出 JSON 备份，或用 localhost 模式获得更稳定持久化。'; renderBannerVisibility(banner, message.textContent); retry.hidden = false; return; }
  label.textContent = state.lastSavedAt ? `已本地保存 ${timeText(state.lastSavedAt)}` : '本地保存就绪'; message.textContent = ''; renderBannerVisibility(banner, message.textContent); retry.hidden = true;
}
function persist() {
  if (corruption) return false;
  const policy = externalConflictPolicy(externalConflict);
  const saved = saveWorkspace(storage, state, now(), { allowWrite: policy.allowPersist });
  if (saved.ok) { state.lastSavedAt = saved.savedAt; lastRaw = saved.raw; saveError = ''; storageStatus(); return true; }
  const failure = Object.assign(new Error(saved.diagnostic?.message || saved.error), {
    code: saved.diagnostic?.errorCode,
    path: saved.diagnostic?.validationPath
  });
  reportDiagnostic(failure, saved.diagnostic || { phase: 'storage_write' }); saveError = saved.error; storageStatus(); return false;
}
function load() {
  const startup = loadInitialWorkspace(storage, now());
  state = startup.state; lastRaw = startup.lastRaw;
  if (startup.diagnostic) {
    const failure = Object.assign(new Error(startup.diagnostic.message), {
      code: startup.diagnostic.errorCode,
      path: startup.diagnostic.validationPath
    });
    reportDiagnostic(failure, startup.diagnostic);
  }
  if (startup.mode === 'blank') persist();
  if (startup.mode === 'storage-unavailable') saveError = startup.error;
  if (startup.mode === 'recovery-required') corruption = true;
  if (startup.mode === 'restored') restoredNotice = `恢复 ${dateKey(startup.savedAt).slice(5)} ${timeText(startup.savedAt)} 的手动状态 · 离开期间未核验行情`;
}
function mutate(message, symbol, focus = '.state-title') {
  assertState(state); persist(); renderAll();
  if (symbol && focus) document.querySelector(`article[data-symbol="${symbol}"] ${focus}`)?.focus({ preventScroll: true });
  announce(message);
}
function option(symbol, action, value, text, selected, disabled = false) {
  return `<button type="button" class="option ${action}${selected ? ' selected' : ''}" data-action="${action}" data-symbol="${symbol}" data-value="${value}" aria-pressed="${selected}"${disabled ? ' disabled aria-disabled="true"' : ''}>${text}</button>`;
}
function renderCard(symbol) {
  const card = state.cards[symbol]; const opportunity = card.opportunity; const status = stateOf(card); const holding = status === 'position';
  const [action, prohibition] = instruction(card); const registration = registrationStatus(state, symbol);
  const bias = `<section class="classifier bias-field"><span class="field-label">当前偏见</span><div class="segment" role="group" aria-label="${symbol} 当前偏见">${Object.entries(BIASES).map(([key,label]) => option(symbol, 'bias', key, label, key === card.bias)).join('')}</div></section>`;
  const structure = `<section class="classifier structure-field"><span class="field-label">当前 3M 市场结构</span><div class="segment structure-segment" role="group" aria-label="${symbol} 当前 3M 市场结构">${Object.entries(STRUCTURES_3M).map(([key,label]) => option(symbol, 'structure', key, label, key === card.structure3m)).join('')}</div>${card.needsStructureReview ? '<p class="migration-note">旧版本机会：请先确认当前 3M 结构</p>' : ''}</section>`;
  const direction = holding ? `<div class="readonly">本笔${directionShort(card.direction)}头 <small>只读</small></div>` : `<div class="segment" role="group" aria-label="${symbol} 交易方向">${Object.entries(DIRECTIONS).map(([key,label]) => option(symbol, 'direction', key, label, key === card.direction, card.needsStructureReview || !isDirectionAllowed(card.structure3m, key))).join('')}</div>`;
  const setups = holding ? `<div class="readonly">${SETUPS[opportunity.type]} <small>只读</small></div>` : `<div class="segment" role="group" aria-label="${symbol} 当前机会">${Object.entries(SETUPS).map(([key,label]) => option(symbol, 'setup', key, label, opportunity?.type === key, card.needsStructureReview || card.direction === 'none' || !isDirectionAllowed(card.structure3m, card.direction))).join('')}</div>`;
  const position = `<div class="zone"><label for="zone-${symbol}">关键位置</label><input id="zone-${symbol}" data-zone="${symbol}" maxlength="100" autocomplete="off" spellcheck="false" value="${escapeHtml(opportunity?.zoneDraft || '')}" placeholder="${opportunity ? '输入后点确认' : '先建立机会'}"${!opportunity ? ' disabled' : holding ? ' readonly' : ''}><button class="zone-confirm" data-action="confirm-zone" data-symbol="${symbol}" type="button"${registration.enabled ? '' : ' disabled'}>${registration.label}</button></div><p class="zone-note ${registration.kind}">${registration.text}</p>`;
  let stages = '<div class="empty" aria-hidden="true"></div>', entry = '<div class="empty" aria-hidden="true"></div>', ending = '<div class="empty" aria-hidden="true"></div>';
  if (opportunity && !holding) {
    stages = `<div class="stage-row" role="group" aria-label="${symbol} 注意力阶段">${ATTENTION.map(stage => `<button class="stage${stage === status ? ' selected' : ''}" data-action="stage" data-symbol="${symbol}" data-value="${stage}" type="button" aria-pressed="${stage === status}">${STAGES[stage]}</button>`).join('')}</div>`;
    entry = `<button class="entry${status === 'signal' ? ' hot' : ''}" data-action="entry" data-symbol="${symbol}" type="button">${symbol} 已入场</button>`;
    ending = `<div class="lifecycle"><button class="ending" data-action="end" data-symbol="${symbol}" data-value="invalid" type="button">机会失效</button><button class="ending" data-action="end" data-symbol="${symbol}" data-value="canceled" type="button">放弃机会</button></div>`;
  } else if (holding) ending = `<button class="exit" data-action="exit" data-symbol="${symbol}" type="button">${symbol} 已平仓</button>`;
  return `<article class="card state-${status}" data-symbol="${symbol}"><header class="card-head"><h2 class="symbol">${symbol}</h2><span class="tf">3M</span></header>${bias}${structure}<section class="direction-field"><span class="field-label">${holding ? '本笔交易方向' : '交易方向'}</span>${direction}</section><section class="opportunity-field"><span class="field-label">${holding ? '本笔机会' : '当前机会'}</span>${setups}${position}</section><section class="task"><div class="task-meta"><span>当前状态</span><span class="duration">${duration(card)}</span></div><p class="state-title" tabindex="-1">${STAGES[status]}</p><p class="instruction">${action}<span>${prohibition}</span></p></section>${stages}${entry}${ending}</article>`;
}
function recordsForScope() {
  const day = dateKey(now()); return state.records.filter(record => historyScope === 'all' || record.endedAt === null || dateKey(record.registeredAt) === day || dateKey(record.endedAt) === day).sort((a,b) => b.registeredAt - a.registeredAt);
}
function renderHistory() {
  const records = recordsForScope(); currentDay = dateKey(now());
  document.querySelector('#history-count').textContent = `${records.length} 条 · ${historyScope === 'all' ? '全部保留' : '今日及未结束'}`;
  document.querySelector('#history-empty').hidden = Boolean(records.length); document.querySelector('#history-table').hidden = !records.length;
  document.querySelectorAll('[data-scope]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scope === historyScope)));
  historyBody.innerHTML = records.map(record => `<tr><td>${escapeHtml(fullTime(record.registeredAt))}</td><td><b>${record.symbol}</b></td><td>${directionShort(record.direction)}</td><td>${SETUPS[record.type]}</td><td class="position">${escapeHtml(record.zone)}</td><td>${recordProgress(record)}</td><td><button class="delete" data-delete="${escapeHtml(record.id)}" type="button">删除</button></td></tr>`).join('');
}
function renderAll() { try { cardsEl.innerHTML = ORDER.map(renderCard).join(''); renderHistory(); storageStatus(); } catch (error) { if (!error.code) error.code = 'RENDER_STATE_ERROR'; throw error; } }
function recordWarning(opportunity) {
  if (!hasRecord(state, opportunity)) return opportunity.registeredAt === null ? '关键位置尚未确认登记：这次操作不会自动新增机会记录。' : '本条记录已删除：这次操作不会把它自动恢复。';
  return opportunity.zoneDraft.trim() !== opportunity.zone ? `位置修改待确认：记录继续保留「${opportunity.zone}」。` : '';
}
function openConfirmation(action, title, message, confirm, warning = '') {
  if (pending) return;
  pending = { ...action, revision: state.revision }; document.querySelector('#dialog-title').textContent = title; document.querySelector('#dialog-message').textContent = message; document.querySelector('#dialog-confirm').textContent = confirm;
  const warningEl = document.querySelector('#dialog-warning'); warningEl.textContent = warning; warningEl.hidden = !warning; dialog.showModal(); document.querySelector('#dialog-cancel').focus();
}
function finishConfirmation(confirmed) {
  const action = pending; pending = null; dialog.close();
  if (!confirmed) { announce('已取消；任务、计时和机会记录保持不变'); return; }
  if (externalConflict) { announce('检测到其他页面修改；当前页面已锁定，本次确认未应用'); return; }
  if (action.revision !== state.revision) { reportDiagnostic(Object.assign(new Error('确认操作版本已过期'), { code: 'REVISION_CONFLICT' }), { phase: 'confirmation', relevantSymbol: action.symbol || null }); announce('任务已变化，本次确认未应用'); return; }
  if (action.kind === 'restore') { state = copy(action.envelope.state); state.lastSavedAt = action.envelope.savedAt; corruption = false; saveError = ''; restoredNotice = '已恢复所选备份。仍须对照交易平台核对当前任务与持仓。'; mutate('备份已恢复；旧记录未合并，不发送任何订单'); return; }
  if (action.kind === 'fresh') { state = createWorkspace(now()); corruption = false; saveError = ''; restoredNotice = '已明确开始空白工作区；原异常存档将由这次新保存替换。'; mutate('已开始空白工作区；请按实际交易状态重新建立任务', null, null); return; }
  const card = state.cards[action.symbol]; if (!card || card.opportunity?.id !== action.opportunityId && !['direction', 'structure'].includes(action.kind)) return;
  if (action.kind === 'direction') { const result = changeDirection(state, action.symbol, action.direction, now(), true); if (result.changed) mutate(`${action.symbol} 旧机会因方向改变结束；当前无机会`, action.symbol); }
  if (action.kind === 'structure') { const result = changeStructure(state, action.symbol, action.structure3m, now(), true); if (result.changed) mutate(`${action.symbol} 3M 市场结构已更新；当前不兼容机会已失效`, action.symbol); }
  if (action.kind === 'entry') { const result = markEntered(state, action.symbol, now(), true); if (result.changed) mutate(`${action.symbol} 已确认入场；本卡进入持仓`, action.symbol); }
  if (action.kind === 'exit') { const result = markExited(state, action.symbol, now(), true); if (result.changed) mutate(`${action.symbol} 已确认全部平仓；保留方向，回到无机会`, action.symbol); }
}
function handleAction(button) {
  if (pending || corruption || externalConflict || button.disabled) return;
  const { action, symbol, value } = button.dataset; if (!ORDER.includes(symbol)) return;
  const card = state.cards[symbol];
  if (action === 'bias') { if (changeBias(state, symbol, value)) mutate(`${symbol} 当前偏见：${BIASES[value]}`, symbol); return; }
  if (action === 'structure') {
    const result = changeStructure(state, symbol, value, now(), false);
    if (result.needsConfirmation) openConfirmation({ kind: 'structure', symbol, structure3m: value, opportunityId: card.opportunity.id }, `改变 ${symbol} 当前 3M 市场结构？`, `${symbol} 当前仍有${directionShort(card.direction)}头交易机会「${SETUPS[card.opportunity.type]}」。\n\n${STRUCTURES_3M[card.structure3m]} → ${STRUCTURES_3M[value]} 后，交易方向「${DIRECTIONS[card.direction]}」将不再合法，当前机会将结束为失效。`, '确认改变');
    else if (result.changed) mutate(`${symbol} 当前 3M 市场结构：${STRUCTURES_3M[value]}`, symbol); return;
  }
  if (action === 'direction') {
    const result = changeDirection(state, symbol, value, now(), false);
    if (result.needsConfirmation) openConfirmation({ kind: 'direction', symbol, direction: value, opportunityId: card.opportunity.id }, `改变 ${symbol} 当前方向？`, `${DIRECTIONS[card.direction]} → ${DIRECTIONS[value]}\n改变方向将结束该机会并清空关键位置。其他品种保持不变。`, '确认改变', recordWarning(card.opportunity));
    else if (result.changed) mutate(`${symbol} 当前${DIRECTIONS[value]}`, symbol); return;
  }
  if (action === 'setup') { const result = chooseSetup(state, symbol, value, now()); if (result.changed) mutate(`${symbol} ${SETUPS[value]}进入等待；填写位置后点击确认才会登记`, symbol, `input[data-zone="${symbol}"]`); return; }
  if (action === 'confirm-zone') { if (confirmPosition(state, symbol, now())) mutate(`${symbol} 关键位置已确认；已登记或更新原记录`, symbol); return; }
  if (action === 'stage') { if (setStage(state, symbol, value, now())) mutate(`${symbol} 已切换到${STAGES[value]}`, symbol); return; }
  if (action === 'entry') { if (card.opportunity && ATTENTION.includes(stateOf(card))) openConfirmation({ kind: 'entry', symbol, opportunityId: card.opportunity.id }, `确认 ${symbol} 已实际入场？`, `${symbol} · ${DIRECTIONS[card.direction]} · ${SETUPS[card.opportunity.type]}\n已确认关键位置：${card.opportunity.zone || '尚未确认'}\n\n仅记录已经实际成交的事实，不发送订单。`, '确认已入场', recordWarning(card.opportunity)); return; }
  if (action === 'exit') { if (stateOf(card) === 'position') openConfirmation({ kind: 'exit', symbol, opportunityId: card.opportunity.id }, `确认 ${symbol} 已全部平仓？`, `${symbol} · ${SETUPS[card.opportunity.type]}\n关键位置：${card.opportunity.zone || '尚未确认'}\n\n仅在本笔已经实际全部平仓后确认。部分减仓不属于已平仓。`, '确认已平仓', recordWarning(card.opportunity)); return; }
  if (action === 'end') { if (endOpportunity(state, symbol, value, now())) mutate(`${symbol} 机会${RESULTS[value]}；方向保留，当前无机会`, symbol); }
}
function download(text, filename, type) { const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }

cardsEl.addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (button && event.detail <= 1) safe(() => handleAction(button), { phase: 'interaction', relevantSymbol: button.dataset.symbol }); });
cardsEl.addEventListener('input', event => { const input = event.target.closest('input[data-zone]'); if (!input || pending || corruption || externalConflict) return; safe(() => { if (updateDraft(state, input.dataset.zone, input.value)) { persist(); const card = state.cards[input.dataset.zone]; const status = registrationStatus(state, card.symbol); const article = input.closest('article'); article.querySelector('.zone-note').className = `zone-note ${status.kind}`; article.querySelector('.zone-note').textContent = status.text; const button = article.querySelector('.zone-confirm'); button.textContent = status.label; button.disabled = !status.enabled; } }, { phase: 'interaction', relevantSymbol: input.dataset.zone }); });
cardsEl.addEventListener('keydown', event => { if (event.target.matches('input[data-zone]') && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.target.closest('article').querySelector('.zone-confirm:not(:disabled)')?.focus(); } });
historyBody.addEventListener('click', event => { const button = event.target.closest('[data-delete]'); if (!button || externalConflict || event.detail > 1) return; safe(() => { if (deleteRecord(state, button.dataset.delete)) { persist(); renderAll(); announce('已删除本条机会记录；任务和持仓不变，后续状态变化不会自动恢复该记录'); } }, { phase: 'interaction' }); });
document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => { historyScope = button.dataset.scope; renderHistory(); }));
document.querySelector('#dialog-cancel').addEventListener('click', () => finishConfirmation(false)); document.querySelector('#dialog-confirm').addEventListener('click', () => finishConfirmation(true)); dialog.addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
document.querySelector('#data-tools').addEventListener('click', () => { document.querySelector('#data-feedback').textContent = ''; dataDialog.showModal(); }); document.querySelector('#data-close').addEventListener('click', () => dataDialog.close());
document.querySelector('#export-today').addEventListener('click', () => { download(exportMarkdown(state, 'today'), `日内机会_${dateKey(now())}.md`, 'text/markdown;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成 Markdown 下载；当前任务未修改。'; });
document.querySelector('#export-all').addEventListener('click', () => { download(exportMarkdown(state, 'all'), '日内机会_全部.md', 'text/markdown;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成 Markdown 下载；当前任务未修改。'; });
document.querySelector('#export-json').addEventListener('click', () => { download(JSON.stringify(makeEnvelope(state), null, 2), `日内状态卡_完整备份_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已生成完整备份下载。'; });
document.querySelector('#export-raw').addEventListener('click', () => { download(lastRaw || '', `日内状态卡_原始存档_${dateKey(now())}.json`, 'application/json;charset=utf-8'); document.querySelector('#data-feedback').textContent = '已导出未经解析的原始存档；原数据未修改。'; });
document.querySelector('#import-json').addEventListener('click', () => { if (externalConflict) return; document.querySelector('#import-file').value = ''; document.querySelector('#import-file').click(); });
document.querySelector('#import-file').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; try { if (externalConflict) { document.querySelector('#data-feedback').textContent = '检测到其他页面修改；请刷新读取最新状态后再恢复备份。'; return; } const raw = await file.text(); const envelope = deserialize(raw); validateEnvelope(envelope); if (externalConflict) { document.querySelector('#data-feedback').textContent = '检测到其他页面修改；恢复未应用。'; return; } dataDialog.close(); openConfirmation({ kind: 'restore', envelope }, '确认恢复并替换当前本地数据？', `备份保存时间：${fullTime(envelope.savedAt)}\n将整体替换三张卡、草稿和全部记录，不合并。\n恢复不会产生订单，也不代表交易平台持仓已变化。`, '确认替换并恢复', '请先导出当前 JSON 备份。恢复后必须对照交易平台核对。'); } catch (error) { document.querySelector('#data-feedback').textContent = `未导入：${error.message}。原数据未改变。`; } finally { event.target.value = ''; } });
document.querySelector('#storage-retry').addEventListener('click', () => { if (!externalConflict) persist(); });
document.querySelector('#start-fresh').addEventListener('click', () => { if (!externalConflict) openConfirmation({ kind: 'fresh' }, '开始空白工作区？', '将以空白三卡开始，并在下一次保存时替换当前无法读取的本地存档。请先导出原始存档（如需保留）。', '确认开始空白', '恢复有效 JSON 备份不会覆盖原存档；开始空白工作区会在下次保存时替换它。'); });
window.addEventListener('storage', event => { if (event.key === STORE_KEY && event.newValue !== lastRaw) { reportDiagnostic(Object.assign(new Error('检测到外部页面写入'), { code: 'EXTERNAL_WRITE_CONFLICT' }), { phase: 'external_write' }); externalConflict = true; saveError = 'Conflict'; storageStatus(); } });
window.addEventListener('focus', () => renderAll()); setInterval(() => { ORDER.forEach(symbol => { const element = document.querySelector(`article[data-symbol="${symbol}"] .duration`); if (element) element.textContent = duration(state.cards[symbol]); }); if (currentDay !== dateKey(now())) renderHistory(); }, 15000);
function safe(fn, context = { phase: 'runtime' }) { try { fn(); } catch (error) { reportDiagnostic(error, context); const banner = document.querySelector('#error-banner'); const message = '页面数据发生异常，已停止编辑；未主动清空存档。请导出 JSON 备份后排查。'; renderTextBanner(banner, message); cardsEl.inert = true; } }

load(); renderAll(); storageStatus();
