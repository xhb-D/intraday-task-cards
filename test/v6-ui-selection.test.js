import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v6 from '../src/intraday-v6/model.js';
import { captureUi } from '../src/capture-ui.js';

const T = 1_750_000_000_000;
const note = '偏见方向&gt;HTF方向&gt;MTF方向';
function buttons(html, action) {
  return [...html.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)]
    .map(([, attributes, label]) => ({ attributes, label, selected: /class="[^"]*\bselected\b/.test(attributes) }))
    .filter(button => button.attributes.includes(`data-action="${action}"`));
}
function render(state) {
  const before = structuredClone(state);
  const html = captureUi.renderCard(state, 'GC');
  assert.deepEqual(state, before, 'UI rendering must not mutate records or card preferences');
  return html;
}
function assertSelection(html, action, value, count) {
  const choices = buttons(html, action);
  assert.equal(choices.length, count);
  assert.equal(choices.filter(choice => choice.selected).length, 1);
  for (const choice of choices) {
    const expected = choice.attributes.includes(`data-value="${value}"`);
    assert.equal(choice.selected, expected);
    assert.ok(choice.attributes.includes(`aria-pressed="${expected}"`));
    assert.doesNotMatch(choice.attributes, /disabled/);
  }
}
for (const stage of ['wait', 'signal']) {
  test(`V6 home selection: ${stage} alone has selected class and pressed state`, () => {
    const state = v6.createWorkspace(T);
    v6.changeStructure(state, 'GC', 'trend_pullback_stronger');
    v6.changeDirection(state, 'GC', 'long', T + 1);
    const { opportunity } = v6.chooseSetup(state, 'GC', 'mtf_pb', T + 2);
    if (stage === 'signal') v6.setOpportunityStage(state, opportunity.id, stage, T + 3);
    assertSelection(render(state), 'stage', stage, 2);
  });
}
for (const direction of ['long', 'short', 'none']) {
  test(`V6 home direction: ${direction} alone has selected class and pressed state`, () => {
    const state = v6.createWorkspace(T);
    v6.changeDirection(state, 'GC', direction, T + 1);
    assertSelection(render(state), 'direction', direction, 3);
  });
}
test('V6 home title: exact replacement note remains inline within direction label', () => {
  const html = render(v6.createWorkspace(T));
  assert.ok(html.includes(`<span class="field-label">交易方向 <span class="direction-note">${note}</span></span>`));
  assert.doesNotMatch(html, /市场结构不明确时看HTF缺口/);
});
test('V6 home readonly direction: title note preserved without restoring editable choices', () => {
  const state = v6.createWorkspace(T);
  v6.changeStructure(state, 'GC', 'trend_pullback_stronger');
  v6.changeDirection(state, 'GC', 'long', T + 1);
  v6.chooseSetup(state, 'GC', 'mtf_pb', T + 2);
  const html = render(state);
  assert.ok(html.includes(note));
  assert.equal(buttons(html, 'direction').length, 0);
  assert.match(html, /class="readonly"[^>]*>做多 · 当前机会锁定/);
});
test('V6 production bundle: renders updated direction explanation', () => {
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.ok(bundle.includes(`交易方向 <span class="direction-note">${note}</span>`));
});
