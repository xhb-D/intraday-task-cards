import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureUi } from '../src/capture-ui.js';
import * as v6 from '../src/intraday-v6/model.js';
import { ready, T } from './fixtures/intraday-v6.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../refinement.css',import.meta.url),'utf8');
const chimeCss=readFileSync(new URL('../natural-chime.css',import.meta.url),'utf8');
const big='<span class="field-label context-heading"><strong class="context-title">大偏见</strong><span class="context-note">HTF波段动能&amp;新的未测试优质缺口</span></span>';
const small='<span class="field-label context-heading"><strong class="context-title">小偏见</strong><span class="context-note">价格拒绝（尾部/单打印）&amp;价格接受（弱端点/震荡）</span></span>';
for(const symbol of ['GC','CL','ES'])for(const lifecycle of ['none','wait','signal','position'])test(`Home layout ${symbol}/${lifecycle}: exact two-level big/small bias headings, direction order, no canonical mutation`,()=>{
  const state=ready(symbol),beforeSetup=state.cards[symbol].structure3m;
  if(lifecycle!=='none'){
    const r=v6.chooseSetup(state,symbol,'mtf_bof',T+2).opportunity;
    if(lifecycle==='signal')v6.setOpportunityStage(state,r.id,'signal',T+3);
    if(lifecycle==='position')v6.markEntered(state,r.id,T+4,true);
  }
  const before=structuredClone(state),output=captureUi.renderCard(state,symbol);
  assert.ok(output.includes(big));assert.ok(output.includes(small));
  assert.ok(output.indexOf(big)<output.indexOf(small));assert.ok(output.indexOf(small)<output.indexOf('交易方向 <span'));
  assert.ok(output.includes('偏见方向&gt;HTF方向&gt;MTF方向'));assert.ok(output.includes(`aria-label="${symbol} 大偏见"`));assert.ok(output.includes(`aria-label="${symbol} 小偏见"`));
  assert.equal((output.match(/data-action="structure"/g)||[]).length,3);assert.equal((output.match(/data-action="bias"/g)||[]).length,3);assert.equal((output.match(/data-action="setup"/g)||[]).length,2);
  assert.equal(state.cards[symbol].structure3m,beforeSetup);assert.deepEqual(state,before);
});
test('Home layout DOM: unique Risk mount follows history inside home; Chime alone retains the top mount',()=>{
  assert.equal((html.match(/id="risk-dashboard-host"/g)||[]).length,1);assert.equal((html.match(/id="chime-summary-host"/g)||[]).length,1);
  const home=html.match(/<section data-route-view="home">([^]*?)<section data-route-view="exit-research"/)[1];
  assert.match(home,/<div id="home-top-region" class="home-top-region"><div id="chime-summary-host"><\/div><\/div>/);
  assert.match(home,/<\/details>\s*<div id="risk-dashboard-host"><\/div><\/section>\s*$/);
  const positions=['chime-summary-host','commodity-dashboard','id="cards"','id="history"','risk-dashboard-host'].map(id=>home.indexOf(id));
  assert.ok(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])));
  assert.match(html,/<section data-route-view="risk" hidden><div id="risk-full-host">[^]*?<div id="risk-manager-host"><\/div>/);
});
test('Home layout CSS: shared title hierarchy and natural wrapping; standalone Chime and original Risk grid retained',()=>{
  assert.match(css,/\.capture-card \.context-heading\{display:grid;gap:3px\}/);
  assert.match(css,/\.context-title\{font-size:13px;line-height:18px;font-weight:650;color:var\(--text-primary\)\}/);
  assert.match(css,/\.context-note\{font-size:11px;line-height:16px;font-weight:400;color:var\(--text-secondary\);white-space:normal;overflow-wrap:break-word\}/);
  assert.doesNotMatch(css.match(/\.context-note\{[^}]+\}/)[0],/ellipsis|overflow:hidden|nowrap/);
  assert.match(chimeCss,/#home-top-region\{display:grid;grid-template-columns:minmax\(0,1fr\)/);assert.doesNotMatch(chimeCss,/#risk-dashboard-host/);
  const riskCss=readFileSync(new URL('../risk-dashboard.css',import.meta.url),'utf8');
  assert.match(riskCss,/\.risk-dashboard\{display:grid;grid-template-columns:minmax\(260px,\.92fr\) minmax\(0,2\.08fr\)/);
  assert.match(riskCss,/\.risk-rail\{[^}]*overflow-x:auto/);assert.match(riskCss,/@media\(max-width:820px\)[^]*?\.risk-mobile-account\{display:grid/);
});
