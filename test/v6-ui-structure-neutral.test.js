import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v6 from '../src/intraday-v6/model.js';
import { captureUi } from '../src/capture-ui.js';
const T=1750000000000;
const choices=(html,action)=>[...html.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]).filter(a=>a.includes(`data-action="${action}"`));
for(const structure of ['bullish','range','bearish'])test(`V6 structure ${structure}: all choices neutral, only current selected`,()=>{
  const state=v6.createWorkspace(T);v6.changeStructure(state,'GC',structure);
  const before=structuredClone(state),buttons=choices(captureUi.renderCard(state,'GC'),'structure');
  assert.equal(buttons.length,3);
  for(const b of buttons){assert.match(b,/data-tone="neutral"/);assert.doesNotMatch(b,/data-tone="(?:bullish|bearish)"|class="[^"]*(?:green|red)/);const selected=b.includes(`data-value="${structure}"`);assert.equal(/class="[^"]*\bselected\b/.test(b),selected);assert.ok(b.includes(`aria-pressed="${selected}"`));}
  assert.deepEqual(state,before);
});
for(const [direction,tone] of [['long','bullish'],['short','bearish']])test(`V6 direction ${direction}: action color semantic retained`,()=>{
  const state=v6.createWorkspace(T);v6.changeDirection(state,'GC',direction,T+1);
  const selected=choices(captureUi.renderCard(state,'GC'),'direction').find(b=>b.includes(`data-value="${direction}"`));
  assert.match(selected,/class="[^"]*\bselected\b/);assert.ok(selected.includes(`data-tone="${tone}"`));
});
test('V6 structure CSS: shared neutral theme tokens for light/dark; direction semantic tokens retained',()=>{
  const css=readFileSync(new URL('../appearance.css',import.meta.url),'utf8');
  const rule=css.match(/\.capture-card \.structure-field \.option\.selected\{([^}]+)\}/)?.[1];
  assert.ok(rule);assert.match(rule,/background:var\(--text-secondary\)/);assert.doesNotMatch(rule,/semantic-bullish|semantic-bearish/);
  for(const theme of ['light','dark'])assert.ok(css.includes(`:root[data-theme="${theme}"]`));
  assert.match(css,/\.capture-card \.direction-field \.option\[data-tone="bullish"\]\{--capture-selection:var\(--semantic-bullish\)\}/);
  assert.match(css,/\.capture-card \.direction-field \.option\[data-tone="bearish"\]\{--capture-selection:var\(--semantic-bearish\)\}/);
});
