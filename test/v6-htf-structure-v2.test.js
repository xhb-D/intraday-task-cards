import test from 'node:test';
import assert from 'node:assert/strict';
import * as v5 from '../src/model.js';
import * as v6 from '../src/intraday-v6/model.js';
import { migrateV5ToV6 } from '../src/intraday-v6/migration.js';
import { singleRecordV5View } from '../src/intraday-v6/validation.js';
import { captureUi } from '../src/capture-ui.js';
import { serialize, deserialize, exportMarkdown } from '../src/capture-persistence.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { T, v5Active } from './fixtures/intraday-v6.js';

const structures = v5.HTF_STRUCTURES_V2;
const keys = ['trend_pullback_stronger','trend_pullback_weaker','htf_range_v2'];
const labels = ['趋势（回调变强）','趋势（回调变弱）','震荡'];
const copy = value => structuredClone(value);
function setup(structure, direction='long') {
  const state=v6.createWorkspace(T);
  v6.changeStructure(state,'GC',structure);v6.changeDirection(state,'GC',direction,T+1);
  return state;
}
test('HTF V2 UI: three exact choices in order; precise headings and no legacy creation buttons on every card',()=>{
  assert.deepEqual(Object.keys(structures),keys);assert.deepEqual(Object.values(structures),labels);
  for(const symbol of ['GC','CL','ES']){
    const html=captureUi.renderCard(v6.createWorkspace(T),symbol),section=html.match(/<section class="classifier structure-field">([^]*?)<\/section>/)[1];
    const buttons=[...section.matchAll(/<button[^>]*data-action="structure"[^>]*data-value="([^"]+)"[^>]*>([^]*?)<\/button>/g)];
    assert.deepEqual(buttons.map(m=>m[1]),keys);assert.deepEqual(buttons.map(m=>m[2]),labels);
    assert.ok(html.indexOf('HTF波段动能&amp;新的未测试优质缺口')<html.indexOf('价格拒绝（尾部/单打印）&amp;价格接受（弱端点/震荡）'));
    assert.ok(html.indexOf('价格拒绝（尾部/单打印）&amp;价格接受（弱端点/震荡）')<html.indexOf('交易方向 <span'));
    assert.ok(html.includes('偏见方向&gt;HTF方向&gt;MTF方向'));
  }
});
for(const key of keys)for(const type of ['mtf_pb','mtf_bof'])for(const direction of ['long','short'])test(`HTF V2 ${key}/${type}/${direction}: explicit selection, immutable snapshot, lifecycle, JSON and Markdown`,()=>{
  const state=setup(key,direction),r=v6.chooseSetup(state,'GC',type,T+2).opportunity;
  assert.equal(r.structure3mAtRegistration,key);assert.equal(r.type,type);assert.equal(r.direction,direction);
  v6.setOpportunityStage(state,r.id,'signal',T+3);v6.markEntered(state,r.id,T+4,true);
  v6.recordInitialStop(state,r.id,90,T+5);v6.correctInitialStop(state,r.id,89,T+6);
  if(type==='mtf_bof'){v6.recordBofToPb(state,r.id,T+7);assert.equal(v6.derivedManagementState(r),'PB');v6.revertBofToPb(state,r.id,T+8);assert.equal(v6.derivedManagementState(r),'BOF');}
  const before=copy(r),bias=state.cards.GC.bias;
  v6.changeStructure(state,'GC',keys.find(k=>k!==key));assert.deepEqual(r,before);assert.equal(state.cards.GC.bias,bias);assert.equal(state.cards.GC.direction,direction);
  v6.markTradeExited(state,r.id,'UNKNOWN',T+9,true);assert.equal(r.structure3mAtRegistration,key);
  const reloaded=deserialize(serialize(state,T+10)).state;assert.deepEqual(reloaded,state);assert.equal(reloaded.schemaVersion,6);
  assert.ok(exportMarkdown(state,'all',T+10).includes(structures[key]));v6.assertV6State(reloaded);
});
for(const legacy of ['unjudged','bullish','range','bearish'])test(`HTF V2 legacy ${legacy}: no automatic interpretation, new registration rejected without mutation`,()=>{
  const state=setup(legacy),before=copy(state),html=captureUi.renderCard(state,'GC');
  for(const type of ['mtf_pb','mtf_bof'])assert.equal(v6.chooseSetup(state,'GC',type,T+2).changed,false);
  assert.deepEqual(state,before);assert.equal(state.cards.GC.structure3m,legacy);
  if(legacy!=='unjudged')assert.ok(html.includes(`旧分类：${v5.VISIBLE_STRUCTURES_3M[legacy]}`));
  assert.equal((html.match(/class="option structure selected"/g)||[]).length,0);
  assert.deepEqual(deserialize(serialize(state,T+10)).state,state);
  v6.changeStructure(state,'GC',keys[0]);assert.ok(v6.chooseSetup(state,'GC','mtf_pb',T+3).changed);
});
for(const stage of ['wait','signal','position'])test(`HTF V2 V5 ${stage}: migration preserves legacy fact, current selection leaves record intact, old lifecycle remains operable`,()=>{
  const old=v5Active(stage),before=copy(old),state=migrateV5ToV6(old,{migratedAt:T+100}).state;
  assert.deepEqual(old,before);assert.equal(state.cards.GC.structure3m,'bullish');assert.equal(state.records[0].structure3mAtRegistration,'bullish');
  const r=state.records[0],snapshot=copy(r),card=copy(state.cards.GC),untouched=copy(state);
  for(const type of ['mtf_pb','mtf_bof'])assert.equal(v6.chooseSetup(state,'GC',type,T+102).changed,false);assert.deepEqual(state,untouched);
  const reloaded=deserialize(serialize(state,T+101)).state;assert.deepEqual(reloaded,state);
  v6.changeStructure(state,'GC',keys[1]);assert.deepEqual(r,snapshot);assert.equal(state.cards.GC.bias,card.bias);assert.equal(state.cards.GC.direction,card.direction);
  if(stage!=='position'){v6.setOpportunityStage(state,r.id,'signal',T+110);v6.markEntered(state,r.id,T+111,true);}
  v6.recordInitialStop(state,r.id,90,T+112);v6.recordBofToPb(state,r.id,T+113);v6.revertBofToPb(state,r.id,T+114);v6.markTradeExited(state,r.id,'STOP_EXIT',T+115,true);
  assert.equal(r.structure3mAtRegistration,'bullish');assert.equal(r.id,snapshot.id);assert.equal(r.registeredAt,snapshot.registeredAt);
  assert.ok(exportMarkdown(state,'all',T+116).includes('市场结构：多头'));v6.assertV6State(state);
});
test('HTF V2 missing active V5 record: recovery audit and original classification survive unmodified',()=>{
  const old=v5Active();old.records=[];const before=copy(old),state=migrateV5ToV6(old,{migratedAt:T+100}).state;
  assert.deepEqual(old,before);assert.equal(state.records[0].structure3mAtRegistration,'bullish');assert.equal(state.migrationAudit[0].code,'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD');
  assert.ok(captureUi.renderCard(state,'GC').includes('旧分类：多头'));v6.assertV6State(state);
});
test('HTF V2 new selection preserves old trade and pending snapshot plus events independently',()=>{
  const state=migrateV5ToV6(v5Active(),{migratedAt:T+100}).state;
  v6.recordInitialStop(state,state.records[0].id,90,T+101);const old=copy(state.records[0]);
  v6.changeStructure(state,'GC',keys[0]);const pending=v6.chooseSetup(state,'GC','mtf_bof',T+102).opportunity,before=copy(state.records);
  v6.changeStructure(state,'GC',keys[1]);assert.deepEqual(state.records,before);assert.deepEqual(state.records[0],old);
  v6.markEntered(state,pending.id,T+103,true);assert.equal(pending.structure3mAtRegistration,keys[0]);
});
for(const key of keys)test(`HTF V2 ${key}: frozen V5 remains strict; detached validation cannot rewrite canonical snapshot`,()=>{
  const old=v5Active();old.cards.GC.opportunity.structure3mAtRegistration=key;old.records[0].structure3mAtRegistration=key;assert.throws(()=>v5.assertState(old));
  const state=setup(key),r=v6.chooseSetup(state,'GC','mtf_pb',T+2).opportunity,before=copy(state),view=singleRecordV5View(r);
  v5.assertState(view);assert.equal(view.records[0].structure3mAtRegistration,'range');assert.deepEqual(state,before);assert.equal(r.structure3mAtRegistration,key);
});
test('HTF V2 validation: unknown card/record enum and invalid selection rejected atomically',()=>{
  const state=setup(keys[0]),r=v6.chooseSetup(state,'GC','mtf_pb',T+2).opportunity,before=copy(state);
  assert.throws(()=>v6.changeStructure(state,'GC','trend_unknown'),{code:'V6_STRUCTURE_INVALID'});assert.deepEqual(state,before);
  const badCard=copy(state);badCard.cards.GC.structure3m='trend_unknown';assert.throws(()=>v6.assertV6State(badCard),{code:'V6_CARD_INVALID'});
  const badRecord=copy(state);badRecord.records[0].structure3mAtRegistration='trend_unknown';assert.throws(()=>v6.assertV6State(badRecord),{code:'V6_RECORD_INVALID'});assert.equal(r.structure3mAtRegistration,keys[0]);
});
for(const key of keys)test(`HTF V2 ${key}: read-only Exit Research accepts new snapshot with identical matching, metrics and replay results`,()=>{
  const f=workbenchFixture(),old=migrateV5ToV6(f.state,{migratedAt:UI_T}).state,next=copy(old),outputs=[];
  next.records.forEach(r=>r.structure3mAtRegistration=key);v6.assertV6State(next);
  for(const input of [old,next]){
    const before=copy(input),data=new Map(),c=createWorkbenchController({getIntraday:()=>input,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}});
    for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));
    c.select(f.ids.ES1);c.setReplaySettings(f.ids.ES1,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});
    const s=c.snapshot().selected;assert.equal(s.matchingStatus,'MATCHED');assert.equal(s.replayStatus,'EXECUTED');outputs.push({metrics:s.metrics,realizedR:s.realizedR,replays:s.replays});assert.deepEqual(input,before);
  }
  assert.deepEqual(outputs[1],outputs[0]);
});
