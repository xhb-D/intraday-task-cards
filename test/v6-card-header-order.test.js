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
        v6.changeStructure(state, symbol, 'breakout_strong_pullback_weak');
        v6.changeDirection(state, symbol, 'long', T + 1);
        const { opportunity } = v6.chooseSetup(state, symbol, 'spb', T + 2);
        if (lifecycle === 'signal') v6.setOpportunityStage(state, opportunity.id, 'signal', T + 3);
        if (lifecycle === 'position') v6.markEntered(state, opportunity.id, T + 4, true);
      }
      const before = structuredClone(state), html = captureUi.renderCard(state, symbol);
      const controls = html.match(/<div class="card-controls"[^]*?<\/section><\/div>/)?.[0];
      assert.ok(controls);
      assert.equal((controls.match(/class="field-label(?: context-heading)?"/g) || []).length, 3);
      assert.match(controls, /structure-field[^]*?大偏见[^]*?bias-field[^]*?小偏见[^]*?direction-field[^]*?交易方向 /);
      assert.ok(controls.includes('context-note">确定持仓预期（关注波段动能&amp;未测试优质缺口）</span>'));
      assert.ok(controls.includes('context-note">结合价格走势和VP分析TPO 确认价格拒绝和接受（尾部&amp;单打印&amp;弱端点）</span>'));
      assert.ok(controls.includes('交易方向 <span class="direction-note">小偏见方向&gt;大偏见方向</span>'));
      assert.ok(controls.includes(`aria-label="${symbol} 大偏见"`));
      assert.doesNotMatch(controls, /市场结构（MTF chanlun）|MTF结构处于HTF|市场结构不明确时|HTF方向&gt;缺口方向&gt;MTF方向/);
      assert.ok(html.indexOf(controls) < html.indexOf('class="active-trades"'));
      assert.ok(html.indexOf('class="active-trades"') < html.indexOf('class="new-opportunity"'));
      assert.deepEqual(state, before);
    });
  }
}
test('V6 header bundle: updated labels are included without old production wording', () => {
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.ok(bundle.includes('context-note">确定持仓预期（关注波段动能&amp;未测试优质缺口）</span>'));
  assert.ok(bundle.includes('交易方向 <span class="direction-note">小偏见方向&gt;大偏见方向</span>'));
  assert.doesNotMatch(bundle, /市场结构（MTF chanlun）|MTF结构处于HTF波段内部|HTF方向&gt;缺口方向&gt;MTF方向/);
});

for (const direction of ['long', 'short']) {
  for (const lifecycle of ['wait', 'position']) {
    test(`V6 header context ${direction}/${lifecycle}: direction tone, Setup and independent records preserved`, () => {
      const state = v6.createWorkspace(T);
      v6.changeStructure(state, 'GC', 'breakout_strong_pullback_weak');
      v6.changeDirection(state, 'GC', direction, T + 1);
      const { opportunity } = v6.chooseSetup(state, 'GC', 'cpb', T + 2);
      if (lifecycle === 'position') {
        v6.markEntered(state, opportunity.id, T + 3, true);
        const second = v6.chooseSetup(state, 'GC', 'cpb', T + 4).opportunity;
        v6.markEntered(state, second.id, T + 5, true);
      }
      const before = structuredClone(state), html = captureUi.renderCard(state, 'GC');
      assert.ok(html.includes(`class="readonly" data-tone="${direction === 'long' ? 'bullish' : 'bearish'}"`));
      assert.ok(html.includes(lifecycle === 'wait' ? '当前机会锁定' : '跟随当前持仓'));
      assert.equal((html.match(/data-action="setup"/g) || []).length, 3);
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
  assert.ok(html.includes('结合价格走势和VP分析TPO 确认价格拒绝和接受（尾部&amp;单打印&amp;弱端点）'));
  assert.deepEqual(state, before);
});
