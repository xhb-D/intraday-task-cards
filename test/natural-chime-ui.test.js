import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initChimeView } from '../src/natural-chime/view.js';
import { defaultChime, updateSlot } from '../src/natural-chime/model.js';

const css = readFileSync(new URL('../natural-chime.css', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/natural-chime/view.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

function rule(selector, source = css) {
  const start = source.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `CSS rule ${selector} must exist`);
  const end = source.indexOf('}', start);
  assert.notEqual(end, -1, `CSS rule ${selector} must close`);
  return source.slice(start, end + 1);
}

test('Five compact chime tags stay in one row and scroll inside their panel when space runs out', () => {
  const tags = rule('.chime-tags');
  assert.match(tags, /grid-template-columns:repeat\(var\(--tag-count\),minmax\(68px,1fr\)\)/);
  assert.match(tags, /width:100%/);
  assert.match(tags, /max-width:100%/);
  assert.match(tags, /min-width:0/);
  assert.match(tags, /overflow-x:auto/);
  assert.doesNotMatch(tags, /min-width:max|calc\(var\(--tag-count\)/);

  const mobile = css.slice(css.indexOf('@media(max-width:620px){'));
  assert.doesNotMatch(mobile, /\.chime-tags\{grid-template-columns/);
  assert.match(rule('.chime-tag'), /grid-template-columns:minmax\(0,1fr\) 20px/);
  assert.match(rule('.chime-tag-label'), /white-space:nowrap/);
  assert.match(rule('.chime-custom-minutes[hidden]'), /display:none/);
});

test('Homepage keeps only Chime at full width while Risk retains its separate dashboard layout', () => {
  const responsiveCss = css.slice(css.indexOf('@media'));
  assert.doesNotMatch(responsiveCss, /grid-template-areas:"summary" "chime" "accounts"/);
  assert.doesNotMatch(responsiveCss, /#home-top-region\{[^}]*grid-template-columns/);
  assert.match(rule('#home-top-region'), /grid-template-columns:minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /#risk-dashboard-host|grid-template-areas/);
  assert.doesNotMatch(rule('#chime-summary-host'), /border-left|grid-area/);
  assert.match(rule('.chime-home-preferences'), /min-width:0/);
  assert.match(rule('.chime-home-preferences .chime-field select'), /min-width:0/);
  assert.match(rule('.chime-home-preferences .chime-field select'), /max-width:100%/);
  assert.match(css, /@media\(max-width:620px\)\{[^}]*\.chime-clock\{font-size:clamp/);
});

test('Chime pause/resume control remains a compact outlined circle with focus styling', () => {
  const toggle = rule('.chime-tag-toggle');
  assert.match(toggle, /width:18px/); assert.match(toggle, /height:18px/);
  assert.match(toggle, /border:1px solid var\(--border-primary\)/);
  assert.match(toggle, /border-radius:50%/);
  assert.match(rule('.chime-tag-toggle.is-paused'), /color:var\(--success\)/);
  assert.match(css, /\.chime-tag-toggle:focus-visible[^\{]*\{outline:2px solid var\(--theme-accent\)/);
  assert.match(viewSource, /makeButton\(slot\.paused \? '▶' : 'Ⅱ', 'slot-pause', 'chime-tag-toggle'\)/);
  assert.match(viewSource, /control\.setAttribute\('aria-label', accessible\); control\.title = accessible/);
});

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.children = []; this.listeners = new Map(); this.dataset = {};
    this.className = ''; this.disabled = false; this.hidden = false; this.value = ''; this.checked = false;
    this.style = { setProperty() {} }; this._text = '';
    this.classList = { add: token => { if (!this.className.split(/\s+/).includes(token)) this.className = `${this.className} ${token}`.trim(); } };
  }
  get options() { return this.tagName === 'select' ? this.children : []; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  addEventListener(type, listener) { const handlers = this.listeners.get(type) || []; handlers.push(listener); this.listeners.set(type, handlers); }
  click() { if (!this.disabled) for (const listener of this.listeners.get('click') || []) listener({ target: this }); }
  change() { if (!this.disabled) for (const listener of this.listeners.get('change') || []) listener({ target: this }); }
  setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = element => { for (const child of element.children) { if (selector === 'button' && child.tagName === 'button') found.push(child); visit(child); } };
    visit(this); return found;
  }
}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) { const match = find(child, predicate); if (match) return match; }
  return null;
}

test('Custom minutes row is visible/editable only for custom, and preset switches preserve its value', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    const view = initChimeView({ summaryHost, settingsHost });
    const controlsForSlot = () => {
      const fieldset = find(settingsHost, element => element.dataset.slotId === 'slot-1');
      return {
        row: find(fieldset, element => element.className.includes('chime-custom-minutes')),
        minutes: find(fieldset, element => element.dataset.slotField === 'minutes')
      };
    };

    const initial = defaultChime(); view.render(initial, {});
    assert.equal(controlsForSlot().row.hidden, true);
    assert.equal(controlsForSlot().minutes.disabled, true);
    const custom = updateSlot(initial, 'slot-1', { preset: 'custom', minutes: 17 }); view.render(custom, {});
    assert.equal(controlsForSlot().row.hidden, false);
    assert.equal(controlsForSlot().minutes.disabled, false);
    assert.equal(controlsForSlot().minutes.value, '17');
    const preset = updateSlot(custom, 'slot-1', { preset: '15' }); view.render(preset, {});
    assert.equal(controlsForSlot().row.hidden, true);
    assert.equal(controlsForSlot().minutes.disabled, true);
    assert.equal(controlsForSlot().minutes.value, '17');
    const restored = updateSlot(preset, 'slot-1', { preset: 'custom' }); view.render(restored, {});
    assert.equal(controlsForSlot().row.hidden, false);
    assert.equal(controlsForSlot().minutes.value, '17');
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('Homepage controls invoke the real callbacks; settings has no duplicate global controls or preferences', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    const calls = { start: 0, pause: 0, preview: 0 };
    const view = initChimeView({ summaryHost, settingsHost, onStart: () => { calls.start += 1; }, onPause: () => { calls.pause += 1; }, onPreview: () => { calls.preview += 1; } });
    view.render(defaultChime(), { visible: true, runIntent: 'running', leader: true, enabledSlots: 1, eligibleSlots: 1 });
    const homeButton = action => find(summaryHost, element => element.tagName === 'button' && element.dataset.chimeAction === action);
    for (const action of ['start', 'pause', 'preview']) assert.ok(homeButton(action), `${action} is rendered on home`);
    homeButton('start').click(); homeButton('pause').click(); homeButton('preview').click();
    assert.deepEqual(calls, { start: 1, pause: 1, preview: 1 });
    assert.equal(find(settingsHost, element => element.dataset.chimeAction === 'start'), null);
    assert.equal(find(settingsHost, element => element.dataset.chimeAction === 'pause'), null);
    assert.equal(find(settingsHost, element => element.dataset.chimeAction === 'preview'), null);
    assert.equal(find(settingsHost, element => element.dataset.chimePreference !== undefined), null);
    assert.equal(find(settingsHost, element => element.dataset.chimeRuntime !== undefined), null);
    assert.equal(find(summaryHost, element => element.dataset.chimeRuntime === 'true').textContent, '当前页面负责报时');
    view.render(defaultChime(), { visible: true, runIntent: 'paused', coordinationError: '租约无法确认' });
    assert.equal(find(summaryHost, element => element.dataset.chimeRuntime === 'true').textContent, '租约无法确认', 'coordination error keeps precedence over paused intent');
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('Homepage preference changes are persisted through callbacks and failed saves restore controls with visible errors', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    let view; let persisted = defaultChime(); let rejectNext = false; const saved = [];
    view = initChimeView({ summaryHost, settingsHost, onPreferenceChange: (key, next) => {
      saved.push({ key, value: next[key] });
      if (rejectNext) return false;
      persisted = next; view.render(persisted, { visible: true, runIntent: 'paused' }); return true;
    } });
    view.render(persisted, { visible: true, runIntent: 'paused' });
    const preference = key => find(summaryHost, element => element.dataset.chimePreference === key);
    const voice = preference('voiceEnabled'); voice.checked = false; voice.change();
    assert.deepEqual(saved.at(-1), { key: 'voiceEnabled', value: false });
    assert.equal(persisted.voiceEnabled, false);
    const selector = preference('selectedVoiceURI'); selector.value = 'local-zh-voice'; selector.change();
    assert.deepEqual(saved.at(-1), { key: 'selectedVoiceURI', value: 'local-zh-voice' });
    assert.equal(persisted.selectedVoiceURI, 'local-zh-voice');
    const notification = preference('notifyEnabled'); notification.checked = true; notification.change();
    assert.deepEqual(saved.at(-1), { key: 'notifyEnabled', value: true });
    assert.equal(persisted.notifyEnabled, true);

    rejectNext = true;
    const currentVoice = preference('voiceEnabled'); currentVoice.checked = true; currentVoice.change();
    assert.equal(preference('voiceEnabled').checked, false, 'rejected save echoes the last persisted value');
    assert.match(find(summaryHost, element => element.dataset.preferenceError === 'true').textContent, /设置尚未保存/);
    assert.match(summaryHost.textContent, /设置尚未保存/);
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('Home preference controls follow lock and unlock transitions when the chime state reference is unchanged', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement(); const chime = defaultChime();
    const view = initChimeView({ summaryHost, settingsHost });
    const preferences = () => ['voiceEnabled', 'selectedVoiceURI', 'notifyEnabled'].map(key => find(summaryHost, element => element.dataset.chimePreference === key));
    view.render(chime, { visible: true, runIntent: 'paused' }, { locked: false });
    assert.ok(preferences().every(control => control.disabled === false));
    view.render(chime, { visible: true, runIntent: 'paused' }, { locked: true });
    assert.ok(preferences().every(control => control.disabled === true), 'all preference controls lock even when settings identity is stable');
    view.render(chime, { visible: true, runIntent: 'paused' }, { locked: false });
    assert.ok(preferences().every(control => control.disabled === false), 'all preference controls unlock with the same canonical object');
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('All five home single-cycle buttons call persistence for their own slot and retain pause state', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    let view; let persisted = defaultChime(); persisted.slots.forEach(slot => { slot.enabled = true; });
    const changed = [];
    view = initChimeView({ summaryHost, settingsHost, onSlotChange: (slotId, next) => { changed.push(slotId); persisted = next; view.render(persisted, { visible: true, runIntent: 'paused' }); return true; } });
    view.render(persisted, { visible: true, runIntent: 'paused' });
    let tags = find(summaryHost, element => element.dataset.chimeTags === 'true');
    assert.equal(tags.children.length, 5);
    for (const tag of [...tags.children]) tag.children[1].click();
    assert.deepEqual(changed, ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5']);
    assert.deepEqual(persisted.slots.map(slot => slot.paused), [true, true, true, true, true]);
    tags = find(summaryHost, element => element.dataset.chimeTags === 'true');
    for (const tag of [...tags.children]) tag.children[1].click();
    assert.deepEqual(persisted.slots.map(slot => slot.paused), [false, false, false, false, false]);
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('App shell owns exactly one coordinator/scheduler/view across hash-route changes', () => {
  assert.equal((appSource.match(/createCoordinator\(/g) || []).length, 1);
  assert.equal((appSource.match(/createScheduler\(/g) || []).length, 1);
  assert.equal((appSource.match(/initChimeView\(/g) || []).length, 1);
  const route = appSource.match(/function route\(\)\s*\{[^}]*\}/)?.[0] || '';
  assert.match(route, /applyRoute/);
  assert.doesNotMatch(route, /createCoordinator|createScheduler|\.destroy\(/);
});

test('One- and five-slot summaries render only full period labels with accessible circle controls', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    const view = initChimeView({ summaryHost, settingsHost });
    const one = defaultChime(); view.render(one, {});
    let tags = find(summaryHost, element => element.dataset.chimeTags === 'true');
    assert.equal(tags.children.length, 1);
    const five = defaultChime();
    five.slots.forEach((slot, index) => { slot.enabled = true; slot.preset = ['3', '5', '15', '30', '60'][index]; });
    view.render(five, {});
    tags = find(summaryHost, element => element.dataset.chimeTags === 'true');
    assert.deepEqual(tags.children.map(tag => tag.children[0].textContent), ['3 分钟', '5 分钟', '15 分钟', '30 分钟', '60 分钟']);
    assert.equal(tags.children.length, 5);
    for (const tag of tags.children) {
      const button = tag.children[1];
      assert.equal(button.textContent, 'Ⅱ');
      assert.match(button.getAttribute('aria-label'), /^暂停第 \d 个周期/);
      assert.equal(button.title, button.getAttribute('aria-label'));
    }
    const paused = defaultChime(); paused.slots[0].paused = true; view.render(paused, {});
    const pausedButton = find(summaryHost, element => element.tagName === 'button' && element.dataset.chimeAction === 'slot-pause');
    assert.equal(pausedButton.textContent, '▶');
    assert.ok(pausedButton.className.includes('is-paused'));
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});

test('Homepage owns the live status and settings contains only cycle configuration', () => {
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const summaryHost = new FakeElement(); const settingsHost = new FakeElement();
    const view = initChimeView({ summaryHost, settingsHost });
    view.render(defaultChime(), { runIntent: 'running', leader: true }, { clockText: '13:34:41' });

    assert.match(summaryHost.textContent, /北京时间 13:34:41/);
    assert.match(summaryHost.textContent, /当前页面负责报时/);
    assert.match(summaryHost.textContent, /已设置报时 1\/5/);
    assert.doesNotMatch(summaryHost.textContent, /浏览器后台或设备休眠期间错过的报时不会补播/);
    assert.match(settingsHost.textContent, /自然周期报时设置/);
    assert.match(settingsHost.textContent, /不补播错过的报时/);
    assert.doesNotMatch(settingsHost.textContent, /当前页面负责报时|全局已暂停|启用语音播报|系统通知|试听提示音|开始报时/);
    view.destroy();
  } finally { globalThis.document = priorDocument; }
});
