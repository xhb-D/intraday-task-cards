import test from 'node:test';
import assert from 'node:assert/strict';
import * as v5 from '../src/model.js';
import * as v6 from '../src/intraday-v6/model.js';
import { singleRecordV5View } from '../src/intraday-v6/validation.js';
import { migrateV5ToV6 } from '../src/intraday-v6/migration.js';
import { captureUi } from '../src/capture-ui.js';
import { serialize, deserialize, exportMarkdown } from '../src/capture-persistence.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { SETUP_LABELS as researchLabels } from '../src/exit-research/ui/labels.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { ready, T } from './fixtures/intraday-v6.js';

const NEW_LABEL='MTF BOF（做多等收敛 做空等扫高）';
function historical(type, stage='position') {
  const s=v5.createWorkspace(T);
  v5.changeStructure(s,'GC','range',T+1);v5.changeDirection(s,'GC','long',T+2);
  v5.chooseSetup(s,'GC',type,T+3);
  if(stage==='signal')v5.setStage(s,'GC','signal',T+4);
  if(['position','closed'].includes(stage)){
    v5.markEntered(s,'GC',T+4,true);v5.recordInitialStop(s,'GC',90,T+5);
    v5.correctInitialStop(s,'GC',89,T+6);v5.recordBofToPb(s,'GC',T+7);v5.revertBofToPb(s,'GC',T+8);
  }
  if(stage==='closed')v5.markExited(s,'GC',T+9,true);
  v5.assertState(s);return s;
}
test('MTF BOF identity: exactly two creatable types, distinct unchanged legacy labels and BOF classification',()=>{
  assert.deepEqual(Object.keys(v5.CREATABLE_SETUPS),['mtf_pb','mtf_bof']);
  assert.equal(v5.SETUP_LABELS.mtf_bof,NEW_LABEL);assert.equal(researchLabels.mtf_bof,NEW_LABEL);
  assert.equal(v5.SETUP_LABELS.htf_bof,'HTF BOF（恐慌或走弱 1次）');
  assert.equal(v5.SETUP_LABELS.htf_pb,'MTF BOF（趋势走弱 1次）');
  for(const type of ['mtf_bof','htf_bof','htf_pb'])assert.equal(v5.researchSetupClass(type),'BOF');
});
for(const type of ['htf_bof','htf_pb'])for(const context of ['empty','pending','holding'])test(`MTF BOF creation gate: ${type} rejected atomically in ${context}`,()=>{
  const s=ready();if(context!=='empty'){
    const r=v6.chooseSetup(s,'GC','mtf_bof',T+3).opportunity;if(context==='holding')v6.markEntered(s,r.id,T+4,true);
  }
  const before=structuredClone(s);assert.throws(()=>v6.chooseSetup(s,'GC',type,T+20),{code:'V6_SETUP_INVALID'});
  assert.deepEqual(s,before);v6.assertV6State(s);
});
for(const type of ['htf_bof','htf_pb'])for(const stage of ['wait','signal','position','closed'])test(`MTF BOF legacy compatibility: ${type} ${stage} migration, reload and export preserve original identity and facts`,()=>{
  const input=historical(type,stage),before=structuredClone(input),s=migrateV5ToV6(input,{migratedAt:T+100}).state;
  assert.deepEqual(input,before);assert.deepEqual(s.records,[{...before.records[0],exitCapture:stage==='closed'?{kind:'UNKNOWN',groupId:null}:null}]);
  v6.assertV6State(s);assert.deepEqual(deserialize(serialize(s,T+110)).state,s);
  assert.ok(exportMarkdown(s,'all',T+110).includes(v5.SETUP_LABELS[type]));
  if(stage!=='closed'){
    const r=s.records[0];assert.ok(captureUi.renderCard(s,'GC').includes(v5.SETUP_LABELS[type]));
    if(stage!=='position'){v6.setOpportunityStage(s,r.id,'signal',T+111);v6.markEntered(s,r.id,T+112,true);v6.recordInitialStop(s,r.id,91,T+113);}
    v6.recordBofToPb(s,r.id,T+114);v6.revertBofToPb(s,r.id,T+115);v6.markTradeExited(s,r.id,'UNKNOWN',T+116,true);
    assert.equal(r.type,type);assert.equal(r.id,before.records[0].id);assert.equal(r.registeredAt,before.records[0].registeredAt);
    assert.deepEqual(r.researchCapture.manualEvents.slice(0,before.records[0].researchCapture.manualEvents.length),before.records[0].researchCapture.manualEvents);
  }
});
test('MTF BOF frozen V5 boundary: new type rejected by V5 validator, creation and context gate',()=>{
  const input=historical('htf_bof'),changed=structuredClone(input);
  changed.cards.GC.opportunity.type='mtf_bof';changed.records[0].type='mtf_bof';assert.throws(()=>v5.assertState(changed));
  assert.equal(v5.isSetupAllowed('long','range','mtf_bof'),false);
  const empty=v5.createWorkspace(T);v5.changeStructure(empty,'GC','range',T+1);v5.changeDirection(empty,'GC','long',T+2);
  const before=structuredClone(empty);assert.throws(()=>v5.chooseSetup(empty,'GC','mtf_bof',T+3));assert.deepEqual(empty,before);
});
test('MTF BOF validation projection: only temporary V5 view maps type, canonical data stays unchanged',()=>{
  const s=ready(),r=v6.chooseSetup(s,'GC','mtf_bof',T+3).opportunity,before=structuredClone(s),view=singleRecordV5View(r);
  assert.equal(view.records[0].type,'htf_bof');v5.assertState(view);assert.equal(r.type,'mtf_bof');assert.deepEqual(s,before);
});
for(const defect of ['unknownType','zone','timeline','manualEvent'])test(`MTF BOF strict V6 validation rejects ${defect} without weakening frozen checks`,()=>{
  const s=ready(),r=v6.chooseSetup(s,'GC','mtf_bof',T+3).opportunity;v6.markEntered(s,r.id,T+4,true);
  if(defect==='unknownType')r.type='unknown_bof';
  if(defect==='zone')r.zone='legacy-zone';
  if(defect==='timeline')r.registeredAt=T+2;
  if(defect==='manualEvent')r.researchCapture.manualEvents.push({type:'BOF_TO_PB_RECORDED'});
  assert.throws(()=>v6.assertV6State(s));
});
test('MTF BOF lifecycle: same Setup creates independent trades; per-record stop/conversion/revert and exit remain isolated',()=>{
  const s=ready(),a=v6.chooseSetup(s,'GC','mtf_bof',T+3).opportunity;v6.setOpportunityStage(s,a.id,'signal',T+4);
  assert.ok(captureUi.renderCard(s,'GC').includes(NEW_LABEL));v6.markEntered(s,a.id,T+5,true);
  const b=v6.chooseSetup(s,'GC','mtf_bof',T+6).opportunity;v6.markEntered(s,b.id,T+7,true);
  v6.recordInitialStop(s,a.id,90,T+8);v6.recordInitialStop(s,b.id,92,T+9);v6.correctInitialStop(s,a.id,89,T+10);
  const bBefore=structuredClone(b);v6.recordBofToPb(s,a.id,T+11);assert.equal(v6.derivedManagementState(a),'PB');assert.equal(v6.derivedManagementState(b),'BOF');
  v6.revertBofToPb(s,a.id,T+12);assert.equal(v6.derivedManagementState(a),'BOF');assert.deepEqual(b,bBefore);
  assert.equal(v6.effectiveInitialStop(a),89);assert.equal(v6.effectiveInitialStop(b),92);
  v6.markTradeExited(s,a.id,'STOP_EXIT',T+13,true);assert.equal(b.endedAt,null);
  const pending=v6.chooseSetup(s,'GC','mtf_bof',T+14).opportunity;v6.markAllTradesExited(s,'GC',T+15,true);
  assert.equal(pending.endedAt,null);assert.equal(b.exitCapture.kind,'MANUAL_FLATTEN');
  assert.ok(s.records.every(r=>r.type==='mtf_bof'));assert.deepEqual(deserialize(serialize(s,T+20)).state,s);
  assert.ok(exportMarkdown(s,'all',T+20).includes(NEW_LABEL));v6.assertV6State(s);
});
test('MTF BOF and legacy BOF coexist: new opportunity never renames old active trade or its events',()=>{
  const s=migrateV5ToV6(historical('htf_bof'),{migratedAt:T+100}).state,old=structuredClone(s.records[0]);
  v6.changeStructure(s,'GC','trend_pullback_stronger');
  const r=v6.chooseSetup(s,'GC','mtf_bof',T+101).opportunity;v6.markEntered(s,r.id,T+102,true);
  assert.deepEqual(s.records[0],old);assert.equal(s.records[1].type,'mtf_bof');assert.equal(v6.derivedManagementState(r),'BOF');
});
test('MTF BOF Exit Research: original identity preserved, metrics and full BOF replay output unchanged',()=>{
  const f=workbenchFixture(),legacy=migrateV5ToV6(f.state,{migratedAt:UI_T}).state,next=structuredClone(legacy);
  next.records.find(r=>r.id===f.ids.ES1).type='mtf_bof';v6.assertV6State(next);const outputs=[];
  for(const input of [legacy,next]){
    const before=structuredClone(input),data=new Map(),c=createWorkbenchController({getIntraday:()=>input,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
    for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));
    c.select(f.ids.ES1);c.setReplaySettings(f.ids.ES1,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});
    const selected=c.snapshot().selected;assert.equal(selected.originalSetup,input.records.find(r=>r.id===f.ids.ES1).type);
    assert.equal(selected.researchSetupClass,'BOF');assert.equal(selected.matchingStatus,'MATCHED');assert.equal(selected.replayStatus,'EXECUTED');
    outputs.push({metrics:selected.metrics,realizedR:selected.realizedR,replays:selected.replays});assert.deepEqual(input,before);
  }
  assert.deepEqual(outputs[1],outputs[0]);
});
test('MTF BOF UI semantics: selected, inactive and disabled use existing neutral Setup classes',()=>{
  const s=ready();v6.chooseSetup(s,'GC','mtf_bof',T+3);
  const html=captureUi.renderCard(s,'GC');
  assert.match(html,/class="option setup selected"[^>]*data-value="mtf_bof"[^>]*data-tone="neutral"[^>]*aria-pressed="true"/);
  assert.match(html,/class="option setup"[^>]*data-value="mtf_pb"[^>]*data-tone="neutral"[^>]*aria-pressed="false"/);
  const idle=captureUi.renderCard(v6.createWorkspace(T),'GC');
  for(const type of ['mtf_pb','mtf_bof'])assert.match(idle,new RegExp('data-value="'+type+'"[^>]*data-tone="neutral"[^>]*disabled aria-disabled="true"'));
});
test('MTF BOF UI protects accepted header order and direction priority on all three cards',()=>{
  const s=ready();
  for(const symbol of ['GC','CL','ES']){
    const html=captureUi.renderCard(s,symbol),structure=html.indexOf('HTF结构（HTF波段动能&amp; 新的未测试优质缺口）'),bias=html.indexOf('当前偏见（价格对HVN拒绝or接受）'),direction=html.indexOf('交易方向 <span');
    assert.ok(structure>=0&&structure<bias&&bias<direction);assert.ok(html.includes('偏见方向&gt;HTF方向&gt;MTF方向'));
    assert.ok(html.includes(NEW_LABEL));assert.doesNotMatch(html,/data-action="setup"[^>]*data-value="htf_bof"/);
  }
});
