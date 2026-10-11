import { intradayV6 } from './intraday-v6/index.js';
import { SETUP_LABELS, DIRECTIONS } from './model.js';
import { fullTime } from './capture-persistence.js';

export const EXPECTATION_PANEL_POSITION_KEY = 'intraday-task-cards:expectation-panel-ui:v1';
export function clampExpectationPosition(position, viewport, size) {
  const margin = 8, maxX = Math.max(margin, viewport.width - size.width - margin), maxY = Math.max(margin, viewport.height - size.height - margin);
  return { x: Math.min(maxX, Math.max(margin, Number.isFinite(position?.x) ? position.x : maxX)),
    y: Math.min(maxY, Math.max(margin, Number.isFinite(position?.y) ? position.y : 80)) };
}
export function loadExpectationPosition(storage) {
  try {
    const p = JSON.parse(storage?.getItem(EXPECTATION_PANEL_POSITION_KEY) || 'null');
    return p?.version === 1 && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  } catch { return null; }
}
export function saveExpectationPosition(storage, position) {
  try { storage?.setItem(EXPECTATION_PANEL_POSITION_KEY, JSON.stringify({ version: 1, ...position })); return true; } catch { return false; }
}

export function initExpectationPanel({ host, getRecord, save, storage, isLocked, viewport = globalThis }) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fields = [['path','预期路径','预计价格接下来如何发展？'],['keyLevels','关键位置','主要目标在哪里？途中需要警惕什么位置？'],['focus','观察重点','希望看到什么 MTF 价格行为支持原预期？']];
  const empty = () => ({ path: '', keyLevels: '', focus: '' });
  let target = null, mode = 'entry', initial = null, draft = empty(), entryVersion = null, submissionId = null, busy = false;
  let waitingAction = null, drag = null, position = loadExpectationPosition(storage), opener = null;
  const mobile = () => (viewport.innerWidth || 1200) <= 629;
  const editing = () => ['record','correct','update'].includes(mode);
  const dirty = () => target !== null && editing() && JSON.stringify(draft) !== JSON.stringify(initial);
  const token = () => viewport.crypto?.randomUUID?.() || `expectation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const current = () => target === null ? null : getRecord(target);
  const button = (action, label) => `<button type="button" data-expectation-action="${action}">${label}</button>`;

  function geometry(persist = false) {
    if (target === null) return;
    const vv = viewport.visualViewport, height = vv?.height || viewport.innerHeight || 800;
    const box = host.getBoundingClientRect();
    const scale = host.offsetWidth ? box.width / host.offsetWidth : 1;
    host.style.setProperty('--expectation-viewport-height', `${height / scale}px`);
    host.style.setProperty('--expectation-viewport-top', `${vv?.offsetTop || 0}px`);
    if (mobile()) return;
    position = clampExpectationPosition(position, { width: (vv?.width || viewport.innerWidth || 1200) / scale, height: height / scale }, { width: box.width / scale || 480, height: box.height / scale || 500 });
    host.style.left = `${position.x}px`; host.style.top = `${position.y}px`;
    if (persist) showPositionStatus(saveExpectationPosition(storage, position));
  }
  function showPositionStatus(ok) {
    const status = host.querySelector('[data-position-status]');
    if (status) status.textContent = ok ? '' : '位置暂未保存，当前窗口仍可使用';
  }
  function feedback(message) { const el = host.querySelector('[data-expectation-feedback]'); if (el) el.textContent = message; }
  function historyHtml(record) {
    const events = record.researchCapture.manualEvents;
    const labels = { ENTRY_EXPECTATION_RECORDED:'首次入场预期', ENTRY_EXPECTATION_CORRECTED:'更正预期', HOLDING_EXPECTATION_UPDATED:'持仓预期', INITIAL_STOP_RECORDED:'Initial Stop', INITIAL_STOP_LATE_RECORDED:'Initial Stop 补录', INITIAL_STOP_CORRECTED:'Initial Stop 更正', BOF_TO_PB_RECORDED:'BOF → PB', BOF_TO_PB_REVERTED:'撤销 BOF → PB' };
    const facts = [{ id:'html-entry', recordedAt:record.enteredAt, label:'HTML 入场确认' }, { id:'html-exit', recordedAt:record.endedAt, label:'HTML 退出／结束确认' }].filter(e => e.recordedAt !== null);
    const timeline = [...events, ...facts].sort((a,b) => a.recordedAt - b.recordedAt);
    return `<p class="expectation-note">以下为人工记录与 HTML 确认。时间接近不表示因果，券商成交须另行核对。</p><ol class="expectation-timeline">${timeline.map(e => `<li><time>${esc(fullTime(e.recordedAt))}</time><strong>${esc(e.label || labels[e.type])}</strong>${e.payload?.timing ? `<small>${esc(e.type === 'HOLDING_EXPECTATION_UPDATED' ? '持仓期间记录（依据 HTML 确认）' : intradayV6.expectationTimingLabel(e.payload.timing))}</small>` : ''}${e.payload?.content ? fields.map(([k,label]) => e.payload.content[k] ? `<p><b>${label}：</b>${esc(e.payload.content[k])}</p>` : '').join('') : ''}${e.type === 'HOLDING_EXPECTATION_UPDATED' ? `<p>${intradayV6.HOLDING_EXPECTATION_STATES[e.payload.status]}${e.payload.reason ? ' · ' + esc(e.payload.reason) : ''}</p>` : ''}${e.type === 'ENTRY_EXPECTATION_CORRECTED' ? `<small>原始事件：${esc(e.payload.originalEventId)}<br>更正自：${esc(e.payload.previousEventId)}</small>` : ''}${e.payload && !e.payload.timing ? `<small>${esc(JSON.stringify(e.payload))}</small>` : ''}</li>`).join('') || '<li>尚未记录</li>'}</ol>`;
  }
  function entryHtml(record) {
    const entry = intradayV6.entryExpectation(record);
    if (!entry) return '<p>入场预期：尚未记录</p>';
    return `<p class="expectation-note">首次记录：${esc(fullTime(entry.original.recordedAt))}<br>${esc(intradayV6.expectationTimingLabel(entry.original.payload.timing))}。仅依据 HTML 确认时间。</p>${entry.versions.length > 1 ? `<p>当前有效版本 · ${esc(fullTime(entry.current.recordedAt))} · ${esc(intradayV6.expectationTimingLabel(entry.current.payload.timing))}</p>` : ''}<dl class="expectation-content">${fields.map(([k,label]) => `<dt>${label}</dt><dd>${esc(entry.current.payload.content[k] || '—')}</dd>`).join('')}</dl>${button('correct','更正预期')}`;
  }
  function render() {
    const record = current(); if (!record) return;
    const entry = intradayV6.entryExpectation(record), isForm = editing();
    const titles = { record:'入场预期', entry:'入场预期', correct:'更正预期', update:'持仓预期更新', history:'完整历史' };
    const timing = record.endedAt !== null ? '本次保存为复盘补写，不能作为事前预期。' : record.enteredAt !== null ? '本次保存时间晚于 HTML 入场确认；不代表已核对券商成交时间。' : '保存真实记录时间，以 HTML 入场确认时间区分补录。';
    host.innerHTML = `<header class="expectation-panel-header" data-expectation-drag><div><h2 id="expectation-panel-title">交易预期与跟踪</h2><p>${esc(record.symbol)} · ${esc(record.type.toUpperCase())} · ${esc(DIRECTIONS[record.direction])}</p></div><div class="expectation-window-actions">${button('reset','重置位置')}${button('close','关闭')}</div></header><div class="expectation-panel-scroll"><p class="expectation-record-label">${esc(SETUP_LABELS[record.type])}<br><small>交易 ID：${esc(record.id)}</small></p><nav class="expectation-tabs" aria-label="交易预期分区">${button('entry','入场预期')}${record.enteredAt !== null && record.endedAt === null ? button('update','持仓跟踪') : ''}${button('history','完整历史')}</nav><div data-expectation-discard hidden class="expectation-discard" role="alert">有未保存的草稿。${button('keep','保留当前草稿')}${button('discard','放弃草稿并继续')}</div><h3>${titles[mode]}</h3><p data-expectation-lifecycle class="expectation-note">${esc(timing)}</p>${mode === 'history' ? historyHtml(record) : mode === 'entry' ? entryHtml(record) : ''}${isForm ? `<form data-expectation-form>${mode === 'update' ? `<fieldset><legend>本次判断</legend>${Object.entries(intradayV6.HOLDING_EXPECTATION_STATES).map(([k,v]) => `<label class="expectation-status"><input type="radio" name="status" value="${k}"${draft.status===k?' checked':''} required>${v}</label>`).join('')}</fieldset><label>简短原因（选填）<textarea name="reason" rows="2" maxlength="400" placeholder="一句话记录当前观察">${esc(draft.reason)}</textarea></label><p class="expectation-note" data-reason-hint>不及预期时建议记录原因；可留空。</p>` : fields.map(([k,label,hint]) => `<label>${label}<textarea name="${k}" rows="2" maxlength="400" placeholder="${hint}">${esc(draft[k])}</textarea></label>`).join('')}<p class="expectation-note">${mode === 'update' ? '原因' : '每项'}最多 200 字符。${mode === 'update' ? '每次保存新增记录，不自动改变交易。' : '至少填写一项；首次内容和每次更正都会保留。'}</p><div class="expectation-form-actions"><button type="submit">${mode==='update'?'保存本次判断':mode==='correct'?'保存更正':'保存预期'}</button>${button('cancel','取消')}</div></form>` : ''}<p class="expectation-feedback" data-expectation-feedback role="status"></p><p class="expectation-note" data-position-status></p>${mode !== 'history' && entry ? `<details><summary>查看完整历史 · ${record.researchCapture.manualEvents.length}条人工事件</summary>${historyHtml(record)}</details>` : ''}</div>`;
    host.hidden = false;
    geometry(); sync();
  }
  function activate(id, requested, source = null) {
    const record = getRecord(id); if (!record) return;
    target = id; opener = source || opener; mode = requested;
    const entry = intradayV6.entryExpectation(record); entryVersion = entry?.current.id || null;
    if (mode === 'entry' && !entry) mode = 'record';
    if (mode === 'update' && (record.enteredAt === null || record.endedAt !== null)) mode = 'history';
    draft = mode === 'update' ? { status:'', reason:'' } : mode === 'correct' ? structuredClone(entry.current.payload.content) : empty();
    initial = structuredClone(draft); submissionId = token(); waitingAction = null;
    render(); host.querySelector(isFormSelector())?.focus({ preventScroll:true });
  }
  const isFormSelector = () => editing() ? 'textarea, input' : '[data-expectation-action="close"]';
  function request(action) {
    if (!dirty()) { action(); return; }
    waitingAction = action; const warning = host.querySelector('[data-expectation-discard]'); warning.hidden = false; warning.scrollIntoView?.({ block:'nearest' });
  }
  function close() {
    target = null; waitingAction = null; mode = 'entry'; draft = empty(); initial = structuredClone(draft); host.hidden = true;
    opener?.isConnected && opener.focus({ preventScroll:true });
  }
  function sync() {
    if (target === null) return;
    const record = current(), stale = !record || (intradayV6.entryExpectation(record)?.current.id || null) !== entryVersion;
    const stopped = mode === 'update' && record && (record.endedAt !== null || record.enteredAt === null);
    const submit = host.querySelector('[type="submit"]');
    if (submit) submit.disabled = busy || isLocked() || stale || stopped;
    if (stale) feedback('交易记录已改变或被移除。草稿仍保留，请核对后重新打开。');
    else if (stopped) feedback('该笔交易已结束，不能继续保存普通持仓判断。草稿仍保留，可取消后查看历史。');
    else if (isLocked()) feedback('存档冲突或保存保护已锁定写入；草稿仍保留。');
    const lifecycle = host.querySelector('[data-expectation-lifecycle]');
    if (lifecycle && record) lifecycle.textContent = record.endedAt !== null ? '本次保存为复盘补写，不能作为事前预期。' : record.enteredAt !== null ? '依据 HTML 入场确认区分补录；不代表已核对券商成交时序。' : '记录真实保存时间；以 HTML 确认时间区分补录。';
  }
  host.setAttribute('role','dialog'); host.setAttribute('aria-modal','false'); host.setAttribute('aria-labelledby','expectation-panel-title'); host.className = 'expectation-panel'; host.hidden = true;
  host.addEventListener('input', event => {
    const input = event.target;
    if (!Object.hasOwn(draft, input.name)) return;
    draft[input.name] = input.value;
  });
  host.addEventListener('submit', event => {
    if (!event.target.matches('[data-expectation-form]')) return;
    event.preventDefault(); if (busy) return;
    sync(); if (host.querySelector('[type="submit"]').disabled) return;
    busy = true; sync();
    try {
      const result = save({ id:target, mode, draft:structuredClone(draft), submissionId, expectedEntryEventId:entryVersion });
      if (!result.ok) { feedback(result.message || '保存未完成，草稿仍保留。'); return; }
      const id = target; activate(id, mode === 'update' ? 'history' : 'entry'); feedback('已保存本次记录。');
    } catch (error) { feedback(error.code === 'V6_EXPECTATION_INVALID' ? '请检查内容：每项最多 200 字符，入场预期至少填写一项，持仓判断需选择状态。' : '保存未完成，草稿仍保留。请检查存档或交易状态。'); }
    finally { busy = false; sync(); }
  });
  host.addEventListener('click', event => {
    const el = event.target.closest('[data-expectation-action]'); if (!el || event.detail > 1) return;
    const action = el.dataset.expectationAction;
    if (action === 'keep') { waitingAction = null; host.querySelector('[data-expectation-discard]').hidden = true; return; }
    if (action === 'discard') { const next = waitingAction; waitingAction = null; next?.(); return; }
    if (action === 'reset') { position = null; geometry(true); return; }
    if (action === 'close') request(close);
    else if (action === 'cancel') request(() => activate(target, 'entry'));
    else if (['entry','correct','update','history'].includes(action)) request(() => activate(target, action));
  });
  host.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); request(close); } });
  host.addEventListener('pointerdown', event => {
    const header = event.target.closest('[data-expectation-drag]');
    if (!header || event.target.closest('button') || mobile() || event.button !== 0) return;
    event.preventDefault(); geometry();
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, scale:host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1, start:{ ...position } };
    header.setPointerCapture(event.pointerId); host.classList.add('is-dragging');
  });
  host.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); position = { x:drag.start.x + (event.clientX - drag.x) / drag.scale, y:drag.start.y + (event.clientY - drag.y) / drag.scale }; geometry();
  });
  const endDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault(); drag = null; host.classList.remove('is-dragging'); geometry(true);
  };
  host.addEventListener('pointerup', endDrag); host.addEventListener('pointercancel', endDrag); host.addEventListener('lostpointercapture', endDrag);
  viewport.addEventListener?.('resize', () => geometry());
  viewport.visualViewport?.addEventListener('resize', () => { geometry(); const active = host.ownerDocument?.activeElement; if (mobile() && host.contains(active)) active.scrollIntoView({ block:'nearest' }); });
  viewport.visualViewport?.addEventListener('scroll', () => geometry());
  viewport.addEventListener?.('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
  return { open(id, requested = 'entry', source = null) { request(() => activate(id, requested, source)); }, sync,
    routeChanged(home) { if (target !== null) host.hidden = !home; }, hasDraft:dirty };
}
