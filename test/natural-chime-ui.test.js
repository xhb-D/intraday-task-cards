import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initChimeView } from '../src/natural-chime/view.js';
import { defaultChime, updateSlot } from '../src/natural-chime/model.js';

const css = readFileSync(new URL('../natural-chime.css', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/natural-chime/view.js', import.meta.url), 'utf8');

function rule(selector, source = css) {
  const start = source.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `CSS rule ${selector} must exist`);
  const end = source.indexOf('}', start);
  assert.notEqual(end, -1, `CSS rule ${selector} must close`);
  return source.slice(start, end + 1);
}

test('Chime tags use equal tracks without forcing their container wider than its panel', () => {
  const tags = rule('.chime-tags');
  assert.match(tags, /grid-template-columns:repeat\(var\(--tag-count\),minmax\(0,1fr\)\)/);
  assert.match(tags, /width:100%/);
  assert.match(tags, /max-width:100%/);
  assert.match(tags, /min-width:0/);
  assert.match(tags, /overflow-x:auto/);
  assert.doesNotMatch(tags, /min-width:max|calc\(var\(--tag-count\)/);

  const mobile = css.slice(css.indexOf('@media(max-width:620px){'));
  assert.match(mobile, /\.chime-tags\{grid-template-columns:repeat\(var\(--tag-count\),minmax\(132px,1fr\)\)\}/);
  assert.match(rule('.chime-tag'), /grid-template-columns:minmax\(0,1fr\) 24px/);
  assert.match(rule('.chime-tag-label'), /white-space:nowrap/);
  assert.match(rule('.chime-custom-minutes[hidden]'), /display:none/);
});

test('Chime pause/resume control remains a compact outlined circle with focus styling', () => {
  const toggle = rule('.chime-tag-toggle');
  assert.match(toggle, /width:22px/); assert.match(toggle, /height:22px/);
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
    this.className = ''; this.disabled = false; this.hidden = false; this.value = '';
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
    assert.deepEqual(tags.children.map(tag => tag.children[0].textContent), ['每 3 分钟', '每 5 分钟', '每 15 分钟', '每 30 分钟', '每 1 小时']);
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
