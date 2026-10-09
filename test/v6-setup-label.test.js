import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureUi } from '../src/capture-ui.js';
import * as v6 from '../src/intraday-v6/model.js';
import { SETUP_LABELS, CREATABLE_SETUPS } from '../src/model.js';
import { serialize, exportMarkdown } from '../src/capture-persistence.js';
import { T, ready } from './fixtures/intraday-v6.js';

const labels = {
  mtf_pb: 'MTF PB（仓位合适看5M，不合适1M+rsi）',
  mtf_bof: 'MTF BOF（做多等收敛 做空等扫高）'
};
const buttons = html => [...html.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)]
  .filter(([,attrs]) => attrs.includes('data-action="setup"'));

for (const symbol of ['GC','CL','ES']) test(`Setup reminders ${symbol}: exact labels and unchanged keys on two buttons`, () => {
  const state = ready(symbol), html = captureUi.renderCard(state,symbol), list = buttons(html);
  assert.equal(list.length,2);
  assert.deepEqual(list.map(b => b[2]),Object.values(labels));
  assert.deepEqual(list.map(b => b[1].match(/data-value="([^"]+)"/)[1]),Object.keys(labels));
  assert.ok(list.every(b => !b[1].includes('disabled')));
});

for (const type of Object.keys(labels)) for (const stage of ['wait','signal','position']) {
  test(`Setup reminder ${type} ${stage}: matching heading without changing records or exports`, () => {
    const state = ready(), record = v6.chooseSetup(state,'GC',type,T+3).opportunity;
    if (stage === 'signal') v6.setOpportunityStage(state,record.id,'signal',T+4);
    if (stage === 'position') v6.markEntered(state,record.id,T+4,true);
    const before = structuredClone(state), json = serialize(state,T+100), markdown = exportMarkdown(state,'all',T+100);
    const html = captureUi.renderCard(state,'GC');
    const heading = html.match(stage === 'position' ? /<div class="trade-heading">([^]*?)<\/div>/ : /<div class="pending-heading">([^]*?)<\/div>/)[1];
    assert.ok(heading.includes(labels[type]));
    if (stage !== 'position') {
      const selected = buttons(html).find(b => b[1].includes(`data-value="${type}"`));
      assert.match(selected[1],/class="option setup selected"/);
      assert.match(selected[1],/aria-pressed="true"/);
    }
    assert.deepEqual(state,before);
    assert.equal(serialize(state,T+100),json);
    assert.equal(exportMarkdown(state,'all',T+100),markdown);
    v6.assertV6State(state);
  });
}

test('Setup reminders are presentation only: canonical and legacy names stay unchanged', () => {
  assert.deepEqual(Object.keys(CREATABLE_SETUPS),['mtf_pb','mtf_bof']);
  assert.equal(SETUP_LABELS.mtf_pb,'MTF PB');
  assert.equal(SETUP_LABELS.mtf_bof,labels.mtf_bof);
  assert.equal(SETUP_LABELS.htf_bof,'HTF BOF（恐慌或走弱 1次）');
  assert.equal(SETUP_LABELS.htf_pb,'MTF BOF（趋势走弱 1次）');
  const state = v6.createWorkspace(T), html = captureUi.renderCard(state,'GC');
  assert.ok(buttons(html).every(b => b[1].includes('disabled aria-disabled="true"')));
});

test('Setup wrapping is card-scoped, equal-height and visible in both appearance modes', () => {
  const css = readFileSync(new URL('../refinement.css',import.meta.url),'utf8');
  const grid = css.match(/\.capture-card \.setup-segment\{([^}]+)\}/)[1];
  const option = css.match(/\.capture-card \.setup-segment \.option\{([^}]+)\}/)[1];
  assert.match(grid,/grid-template-columns:minmax\(0,9fr\) minmax\(0,11fr\)/);
  assert.match(grid,/align-items:stretch/);
  assert.match(option,/height:auto/);
  assert.match(option,/white-space:normal/);
  assert.match(option,/overflow-wrap:break-word/);
  assert.doesNotMatch(option,/overflow:hidden|text-overflow|line-clamp|max-height|color:|background:/);
});
