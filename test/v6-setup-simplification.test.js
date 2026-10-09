import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as old from '../src/model.js';
import * as v6 from '../src/intraday-v6/model.js';
import { migrateV5ToV6 } from '../src/intraday-v6/migration.js';
import { captureUi } from '../src/capture-ui.js';
import { serialize, deserialize, exportMarkdown } from '../src/capture-persistence.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { SETUP_LABELS as researchLabels } from '../src/exit-research/ui/labels.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { T, ready } from './fixtures/intraday-v6.js';

const setupButtons = html => [...html.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)]
  .filter(([,attrs]) => attrs.includes('data-action="setup"'));
function legacy(stage='closed') {
  // Author a frozen V5 fixture, never invoke the V6 production creation API.
  const s=old.createWorkspace(T);
  old.changeStructure(s,'GC','range',T+1); old.changeDirection(s,'GC','long',T+2);
  old.chooseSetup(s,'GC','htf_pb',T+3);
  if(stage==='signal')old.setStage(s,'GC','signal',T+4);
  if(['position','closed'].includes(stage)){
    old.markEntered(s,'GC',T+4,true);old.recordInitialStop(s,'GC',90,T+5);
    old.recordBofToPb(s,'GC',T+6);old.revertBofToPb(s,'GC',T+7);
  }
  if(stage==='closed')old.markExited(s,'GC',T+8,true);
  old.assertState(s);return s;
}
test('V6 Setup creation UI: exactly two buttons, legacy choice absent, exact new BOF label',()=>{
  const s=ready(), before=structuredClone(s), buttons=setupButtons(captureUi.renderCard(s,'GC'));
  assert.deepEqual(Object.keys(old.CREATABLE_SETUPS),['mtf_pb','mtf_bof']);
  assert.equal(buttons.length,2);assert.deepEqual(buttons.map(b=>b[2]),['MTF PB（仓位合适看5M，不合适1M+rsi）','MTF BOF（做多等收敛 做空等扫高）']);
  assert.ok(buttons.every(b=>!b[1].includes('htf_pb')));assert.deepEqual(s,before);
});
for(const type of ['mtf_pb','mtf_bof'])test(`V6 Setup ${type}: normal production creation and entry`,()=>{
  const s=ready(), r=v6.chooseSetup(s,'GC',type,T+3).opportunity;
  assert.equal(r.type,type);assert.equal(s.records.length,1);v6.markEntered(s,r.id,T+4,true);v6.assertV6State(s);
});
for(const context of ['empty','pending','position'])test(`V6 legacy htf_pb creation rejected atomically with ${context}`,()=>{
  const s=ready();
  if(context!=='empty'){const r=v6.chooseSetup(s,'GC','mtf_pb',T+3).opportunity;if(context==='position')v6.markEntered(s,r.id,T+4,true);}
  const before=structuredClone(s);
  assert.throws(()=>v6.chooseSetup(s,'GC','htf_pb',T+10),{code:'V6_SETUP_INVALID',path:'type'});
  assert.deepEqual(s,before);v6.assertV6State(s);
});
test('Setup labels: unchanged historical HTF BOF and MTF BOF names',()=>{
  assert.equal(old.SETUP_LABELS.htf_bof,'HTF BOF（恐慌或走弱 1次）');
  assert.equal(researchLabels.htf_bof,old.SETUP_LABELS.htf_bof);
  assert.equal(old.SETUP_LABELS.htf_pb,'MTF BOF（趋势走弱 1次）');
  assert.equal(old.researchSetupClass('htf_pb'),'BOF');assert.equal(old.researchSetupClass('htf_bof'),'BOF');
});
for(const stage of ['wait','signal','position','closed'])test(`Legacy htf_pb ${stage}: V5/V6 validators and migration preserve facts`,()=>{
  const input=legacy(stage), before=structuredClone(input), result=migrateV5ToV6(input,{migratedAt:T+100});
  v6.assertV6State(result.state);assert.deepEqual(input,before);
  assert.deepEqual(result.state.records,[{...before.records[0],exitCapture:stage==='closed'?{kind:'UNKNOWN',groupId:null}:null}]);
  const html=captureUi.renderCard(result.state,'GC');
  if(stage!=='closed')assert.ok(html.includes(old.SETUP_LABELS.htf_pb));
  assert.ok(setupButtons(html).every(b=>!b[1].includes('htf_pb')));
});
test('Legacy htf_pb: production JSON reload and Markdown retain type, old name and manual events',()=>{
  const s=migrateV5ToV6(legacy(),{migratedAt:T+100}).state;
  const reloaded=deserialize(serialize(s,T+101)).state;
  assert.deepEqual(reloaded,s);assert.equal(reloaded.records[0].type,'htf_pb');
  assert.ok(exportMarkdown(reloaded,'all',T+101).includes('MTF BOF（趋势走弱 1次）'));
});
test('Legacy htf_pb: existing Exit Research fixture still matches, computes metrics and replays as BOF',()=>{
  const f=workbenchFixture(), state=structuredClone(f.state);
  state.records.find(r=>r.id===f.ids.ES1).type='htf_pb';old.assertState(state);
  const outputs=[];
  for(const input of [f.state,state]){
    const before=structuredClone(input), data=new Map();
    const c=createWorkbenchController({getIntraday:()=>input,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
    for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));
    c.select(f.ids.ES1);c.setReplaySettings(f.ids.ES1,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});
    const selected=c.snapshot().selected;
    assert.equal(selected.researchSetupClass,'BOF');assert.equal(selected.matchingStatus,'MATCHED');
    assert.equal(selected.replayStatus,'EXECUTED');assert.ok(selected.replays.length>0);
    outputs.push({metrics:selected.metrics,realizedR:selected.realizedR,policies:selected.replays.map(r=>r.policyId)});
    assert.deepEqual(input,before);
  }
  assert.deepEqual(outputs[0],outputs[1]);
});
test('V6 two Setup layout: two stretched columns with natural wrapping without third slot',()=>{
  const css=readFileSync(new URL('../refinement.css',import.meta.url),'utf8');
  assert.match(css,/\.capture-card \.setup-segment\{grid-template-columns:minmax\(0,9fr\) minmax\(0,11fr\)/);
  assert.match(css,/\.capture-card \.setup-segment \.option\{[^}]*white-space:normal/);
});
test('Setup assets: CSS and bundle use the same new version to avoid a cached three-column layout',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const cssVersion=html.match(/refinement\.css\?v=([^"\s]+)/)?.[1];
  const bundleVersion=html.match(/dist\/app\.bundle\.js\?v=([^"\s]+)/)?.[1];
  assert.equal(cssVersion,'v6-setup-label-hotfix-20261009');assert.equal(bundleVersion,cssVersion);
  assert.doesNotMatch(html,/选择 MTF PB、MTF BOF/);
  assert.ok(html.includes('选择 MTF PB 或 MTF BOF（做多等收敛 做空等扫高）后'));
  assert.doesNotMatch(html,/选择 MTF PB 或 HTF BOF/);
});
