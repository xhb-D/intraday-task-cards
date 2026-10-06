import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v6 from '../src/intraday-v6/model.js';
import { captureUi } from '../src/capture-ui.js';

const T = 1750000000000;
for (const symbol of ['GC', 'CL', 'ES']) {
  for (const lifecycle of ['none', 'wait', 'signal', 'position']) {
    test(`V6 card header ${symbol}/${lifecycle}: bias then HTF structure then direction, exact labels and no state changes`, () => {
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
      assert.match(controls, /bias-field[^]*?当前偏见[^]*?structure-field[^]*?HTF结构[^]*?direction-field[^]*?交易方向 /);
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
  assert.ok(bundle.includes('field-label">HTF结构</span>'));
  assert.ok(bundle.includes('交易方向 <span class="direction-note">HTF方向&gt;缺口方向&gt;MTF方向</span>'));
  assert.doesNotMatch(bundle, /市场结构（MTF chanlun）|MTF结构处于HTF波段内部/);
});
