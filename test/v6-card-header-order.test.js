import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v6 from '../src/intraday-v6/model.js';
import { captureUi } from '../src/capture-ui.js';

const T = 1750000000000;
for (const symbol of ['GC', 'CL', 'ES']) {
  for (const lifecycle of ['none', 'wait', 'signal', 'position']) {
    test(`V6 card header ${symbol}/${lifecycle}: HTF structure then bias then direction, exact labels and no state changes`, () => {
      const state = v6.createWorkspace(T);
      if (lifecycle !== 'none') {
        v6.changeStructure(state, symbol, 'bullish');
        v6.changeDirection(state, symbol, 'long', T + 1);
        const { opportunity } = v6.chooseSetup(state, symbol, 'mtf_pb', T + 2);
        if (lifecycle === 'signal') v6.setOpportunityStage(state, opportunity.id, 'signal', T + 3);
        if (lifecycle === 'position') v6.markEntered(state, opportunity.id, T + 4, true);
      }
      const before = structuredClone(state), html = captureUi.renderCard(state, symbol);
      const controls = html.match(/<div class="card-controls"[^]*?<\/section><\/div>/)?.[0];
      assert.ok(controls);
      assert.equal((controls.match(/class="field-label"/g) || []).length, 3);
      assert.match(controls, /structure-field[^]*?HTF结构[^]*?bias-field[^]*?当前偏见[^]*?direction-field[^]*?交易方向 /);
      assert.ok(controls.includes('field-label">HTF结构（HTF波段动能&amp; 新的未测试优质缺口）</span>'));
      assert.ok(controls.includes('field-label">当前偏见（TPO字母轨迹&amp;尾部）</span>'));
      assert.ok(controls.includes('交易方向 <span class="direction-note">HTF方向&gt;缺口方向&gt;MTF方向</span>'));
      assert.ok(controls.includes(`aria-label="${symbol} HTF结构"`));
      assert.doesNotMatch(controls, /市场结构（MTF chanlun）|MTF结构处于HTF|市场结构不明确时/);
      assert.ok(html.indexOf(controls) < html.indexOf('class="active-trades"'));
      assert.ok(html.indexOf('class="active-trades"') < html.indexOf('class="new-opportunity"'));
      assert.deepEqual(state, before);
    });
  }
}
test('V6 header bundle: updated labels are included without old production wording', () => {
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.ok(bundle.includes('field-label">HTF结构（HTF波段动能&amp; 新的未测试优质缺口）</span>'));
  assert.ok(bundle.includes('交易方向 <span class="direction-note">HTF方向&gt;缺口方向&gt;MTF方向</span>'));
  assert.doesNotMatch(bundle, /市场结构（MTF chanlun）|MTF结构处于HTF波段内部/);
});

for (const direction of ['long', 'short']) {
  for (const lifecycle of ['wait', 'position']) {
    test(`V6 header context ${direction}/${lifecycle}: direction tone, Setup and independent records preserved`, () => {
      const state = v6.createWorkspace(T);
      v6.changeStructure(state, 'GC', direction === 'long' ? 'bullish' : 'bearish');
      v6.changeDirection(state, 'GC', direction, T + 1);
      const { opportunity } = v6.chooseSetup(state, 'GC', 'htf_bof', T + 2);
      if (lifecycle === 'position') {
        v6.markEntered(state, opportunity.id, T + 3, true);
        const second = v6.chooseSetup(state, 'GC', 'htf_bof', T + 4).opportunity;
        v6.markEntered(state, second.id, T + 5, true);
      }
      const before = structuredClone(state), html = captureUi.renderCard(state, 'GC');
      assert.ok(html.includes(`class="readonly" data-tone="${direction === 'long' ? 'bullish' : 'bearish'}"`));
      assert.ok(html.includes(lifecycle === 'wait' ? '当前机会锁定' : '跟随当前持仓'));
      assert.equal((html.match(/data-action="setup"/g) || []).length, 2);
      assert.equal((html.match(/class="research-capture"/g) || []).length, lifecycle === 'position' ? 2 : 0);
      assert.deepEqual(state, before);
    });
  }
}
test('V6 header context collapsed card: new headings remain together inside hidden controls', () => {
  const state = v6.createWorkspace(T), before = structuredClone(state);
  const html = captureUi.renderCard(state, 'GC', { collapsed: true });
  assert.match(html, /class="card-controls" hidden><section class="classifier structure-field"/);
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('当前偏见（TPO字母轨迹&amp;尾部）'));
  assert.deepEqual(state, before);
});
