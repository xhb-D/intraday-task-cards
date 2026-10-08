import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v6 from '../src/intraday-v6/model.js';
import { captureUi } from '../src/capture-ui.js';

const T = 1750000000000;
for (const [direction, tone, label] of [['long', 'bullish', '做多'], ['short', 'bearish', '做空']]) {
  for (const stage of ['wait', 'signal', 'position']) {
    test(`V6 locked direction ${direction}/${stage}: semantic tone retained without editable buttons or state mutation`, () => {
      const state = v6.createWorkspace(T);
      v6.changeStructure(state, 'GC', 'trend_pullback_stronger');
      v6.changeDirection(state, 'GC', direction, T + 1);
      const { opportunity } = v6.chooseSetup(state, 'GC', 'mtf_pb', T + 2);
      if (stage !== 'wait') v6.setOpportunityStage(state, opportunity.id, 'signal', T + 3);
      if (stage === 'position') v6.markEntered(state, opportunity.id, T + 4, true);
      const before = structuredClone(state);
      const html = captureUi.renderCard(state, 'GC');
      const reason = stage === 'position' ? '跟随当前持仓' : '当前机会锁定';
      assert.ok(html.includes(`<div class="readonly" data-tone="${tone}">${label} · ${reason}</div>`));
      assert.doesNotMatch(html, /data-action="direction"/);
      assert.deepEqual(state, before);
    });
  }
}
test('V6 locked direction CSS: light/dark use red/green tokens, scoped to readonly direction only', () => {
  const css = readFileSync(new URL('../appearance.css', import.meta.url), 'utf8');
  const rule = css.match(/\.capture-card \.direction-field \.readonly\[data-tone\]\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /color:var\(--capture-direction\)/);
  assert.match(rule, /border-color:var\(--capture-direction\)/);
  assert.match(rule, /background:color-mix\(in srgb,var\(--capture-direction\) 14%,var\(--bg-surface\)\)/);
  assert.doesNotMatch(rule, /text-tertiary|opacity/);
  for (const tone of ['bullish', 'bearish']) {
    assert.ok(css.includes(`.capture-card .direction-field .readonly[data-tone="${tone}"]{--capture-direction:var(--semantic-${tone})}`));
  }
  for (const theme of ['light', 'dark']) assert.ok(css.includes(`:root[data-theme="${theme}"]`));
});
