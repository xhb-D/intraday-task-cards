import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createWorkspace, changeDirection, changeStructure, chooseSetup, setStage, markEntered } from '../src/model.js';
import { makeEnvelope } from '../src/persistence.js';
import { makeUnified, UNIFIED_KEY } from '../src/unified-persistence.js';

function harness(type = null, holding = false, status = 'wait') {
  const state = createWorkspace(1);
  if (type) { changeDirection(state, 'GC', 'long', 2); changeStructure(state, 'GC', 'range', 3); chooseSetup(state, 'GC', type, 4); if (status === 'signal') setStage(state, 'GC', status, 5); if (holding) markEntered(state, 'GC', 5, true); }
  const backing = new Map([[UNIFIED_KEY, JSON.stringify(makeUnified(makeEnvelope(state, 6)))]]);
  const elements = new Map(); const windowListeners = new Map();
  const element = () => {
    const children = [];
    return { hidden: true, disabled: false, inert: false, textContent: '', innerHTML: '', value: '', dataset: {}, options: children, children,
      style: { setProperty() {} }, classList: { add() {} }, listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; }, querySelector() { return element(); }, querySelectorAll() { return []; },
      setAttribute() {}, appendChild(child) { children.push(child); return child; }, append(...nodes) { children.push(...nodes); },
      replaceChildren(...nodes) { children.splice(0, children.length, ...nodes); }, focus() {}, showModal() { this.open = true; }, close() { this.open = false; }
    };
  };
  const document = {
    querySelector(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); },
    querySelectorAll() { return []; }, createElement: element
  };
  const context = {
    document, localStorage: { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, String(value)) },
    window: { addEventListener(type, listener) { windowListeners.set(type, [...(windowListeners.get(type) || []), listener]); } },
    console: { error() {} }, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} }, Blob, Intl, Date, JSON, Error, SyntaxError
  };
  vm.runInNewContext(readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8'), context);
  const cards = document.querySelector('#cards');
  const click = action => cards.listeners.click({ detail: 1, target: { closest: () => ({ disabled: false, dataset: { action, symbol: 'GC' } }) } });
  const submit = value => {
    const form = { dataset: { stopForm: 'GC' }, querySelector: () => ({ value }) };
    let prevented = false;
    cards.listeners.submit({ target: { closest: () => form }, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  return {
    cards, click, submit, document,
    saved: () => JSON.parse(backing.get(UNIFIED_KEY)).sections.intraday.state,
    confirm: () => document.querySelector('#dialog-confirm').listeners.click(),
    raw: () => backing.get(UNIFIED_KEY),
    conflict: () => windowListeners.get('storage').forEach(listener => listener({ key: UNIFIED_KEY, newValue: 'external' }))
  };
}

test('Production UI: idle and waiting have no stop input or BOF management controls', () => {
  for (const type of [null, 'htf_pb', 'mtf_pb']) {
    const h = harness(type);
    assert.doesNotMatch(h.cards.innerHTML, /data-stop-input|Initial Stop：|data-action="bof-to-pb"/);
    if (type) {
      h.click('entry'); assert.equal(h.document.querySelector('#confirm-dialog').open, true);
      h.confirm(); assert.match(h.cards.innerHTML, /Initial Stop：待记录/);
    }
  }
});

test('Production UI: BOF conversions are immediate; undo appends, preserving original type', () => {
  const h = harness('htf_pb', true);
  assert.match(h.cards.innerHTML, /当前管理：BOF/);
  h.click('bof-to-pb');
  assert.notEqual(h.document.querySelector('#confirm-dialog').open, true);
  assert.match(h.cards.innerHTML, /当前管理：PB/); assert.match(h.cards.innerHTML, /原始机会：MTF BOF/);
  assert.match(h.cards.innerHTML, /class="holding-reference"[\s\S]*?当前管理：<strong>PB/);
  assert.doesNotMatch(h.cards.innerHTML, /data-action="bof-to-pb"/);
  const original = h.saved().records[0].researchCapture.manualEvents[0];
  h.click('bof-revert');
  const record = h.saved().records[0];
  assert.equal(record.type, 'htf_pb'); assert.equal(record.researchCapture.manualEvents.length, 2);
  assert.deepEqual(record.researchCapture.manualEvents[0], original);
  assert.match(h.cards.innerHTML, /当前管理：BOF/);
  assert.match(h.cards.innerHTML, /class="holding-reference"[\s\S]*?当前管理：<strong>BOF/);
  assert.match(h.cards.innerHTML, /data-action="bof-to-pb"/);
});

test('Production UI: original PB shows Initial Stop only and no BOF conversion', () => {
  const h = harness('mtf_pb', true);
  assert.match(h.cards.innerHTML, /data-stop-input="GC"/); assert.doesNotMatch(h.cards.innerHTML, /bof-to-pb|bof-revert/);
  const capture = h.cards.innerHTML.match(/<section class="research-capture"[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(capture, /当前管理/);
});

test('Production UI: none remains unchanged without a holding reference', () => {
  const h = harness();
  assert.doesNotMatch(h.cards.innerHTML, /holding-reference|持仓参考/);
  assert.equal(h.saved().cards.GC.opportunity, null);
});

test('Production UI: planned reference precedes entry for wait PB and signal BOF', () => {
  for (const [type, status, management] of [['mtf_pb', 'wait', 'PB'], ['htf_bof', 'signal', 'BOF']]) {
    const h = harness(type, false, status);
    assert.match(h.cards.innerHTML, new RegExp(`计划管理：<strong>${management}`));
    assert.match(h.cards.innerHTML, /class="task with-summary"[\s\S]*class="holding-reference"[\s\S]*data-action="entry"/);
    assert.doesNotMatch(h.cards.innerHTML, /class="research-capture"|当前 R/);
    h.click('entry'); h.confirm();
    assert.match(h.cards.innerHTML, new RegExp(`当前管理：<strong>${management}`));
    assert.match(h.cards.innerHTML, /class="task with-summary"[\s\S]*class="holding-reference"[\s\S]*class="research-capture"[\s\S]*data-action="exit"/);
  }
});

test('Production UI: reference survives pure rerender without changing persisted task state', () => {
  const h = harness('htf_pb', true);
  h.submit('3974'); h.click('bof-to-pb');
  const before = h.raw();
  h.click('toggle-collapse'); h.click('toggle-collapse');
  assert.equal(h.raw(), before);
  const references = h.cards.innerHTML.match(/<section class="holding-reference"[\s\S]*?<\/section>/g);
  assert.equal(references.length, 1);
  assert.match(references[0], /当前管理：<strong>PB/);
  assert.doesNotMatch(references[0], /当前 R|MTF|HTF|原始机会/);
});

test('Production UI: invalid prices retain input and data; successful record and correction append', () => {
  const h = harness('htf_bof', true); const before = h.raw();
  for (const price of ['', 'NaN', 'Infinity', '0', '-1']) {
    h.submit(price); assert.equal(h.raw(), before);
    assert.match(h.cards.innerHTML, /请输入大于 0 的有限数字/);
  }
  h.submit('3974');
  assert.match(h.cards.innerHTML, /Initial Stop：3974\.0/); assert.doesNotMatch(h.cards.innerHTML, /data-stop-input/);
  h.click('stop-edit'); assert.match(h.cards.innerHTML, /value="3974"/);
  const raw = h.raw(); h.click('stop-cancel'); assert.equal(h.raw(), raw); assert.doesNotMatch(h.cards.innerHTML, /data-stop-input/);
  h.click('stop-edit'); h.submit('3973.5');
  const capture = h.saved().records[0].researchCapture;
  assert.equal(capture.manualEvents.length, 2); assert.equal(capture.manualEvents[0].payload.stopPrice, 3974);
  assert.deepEqual(capture.manualEvents[1].payload, { oldValue: 3974, newValue: 3973.5 });
  assert.match(h.cards.innerHTML, /Initial Stop：3973\.5/);
});

test('Production UI: collapse/hide preserve research capture; exit confirmation retains all events', () => {
  const h = harness('htf_pb', true); h.submit('3974'); h.click('bof-to-pb'); const raw = h.raw();
  h.click('toggle-collapse'); assert.equal(h.raw(), raw);
  assert.match(h.cards.innerHTML, /Initial Stop：3974\.0/);
  h.click('exit'); assert.equal(h.document.querySelector('#confirm-dialog').open, true);
  h.confirm(); const saved = h.saved();
  assert.equal(saved.cards.GC.opportunity, null); assert.equal(saved.records[0].reason, 'closed');
  assert.equal(saved.records[0].researchCapture.manualEvents.length, 2);
  assert.doesNotMatch(h.cards.innerHTML, /Initial Stop：|data-stop-input/);
});

test('Production UI: stop omission does not block confirmed exit', () => {
  const h = harness('htf_bof', true); h.click('exit'); h.confirm();
  assert.equal(h.saved().records[0].reason, 'closed'); assert.equal(h.saved().records[0].researchCapture.manualEvents.length, 0);
});

test('Production UI: external storage conflict blocks submit, conversion and undo, including stale exit dialog', () => {
  const h = harness('htf_pb', true); h.click('exit'); const before = h.raw();
  h.conflict();
  h.submit('3974'); h.click('bof-to-pb'); h.click('bof-revert'); h.confirm();
  assert.equal(h.raw(), before); assert.equal(h.cards.inert, true);
  assert.match(h.document.querySelector('#save-status').textContent, /当前页面只读/);
});
