import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as v5 from '../src/model.js';
import { migrateEnvelope } from '../src/persistence.js';
import { assertV6State, effectiveInitialStop, derivedManagementState, chooseSetup, markEntered, changeStructure } from '../src/intraday-v6/model.js';
import { activeTradesForSymbol, activeOpportunityForSymbol } from '../src/intraday-v6/queries.js';
import { migrateV5ToV6 } from '../src/intraday-v6/migration.js';
import { goldenFixtures } from './fixtures/compatibility/golden-fixtures.js';
import { T, clone, v5Active } from './fixtures/intraday-v6.js';

function blockedUnchanged(state, options, code) {
  const before=clone(state);
  assert.throws(()=>migrateV5ToV6(state,options),error=>{
    assert.equal(error.code,code); assert.equal(error.status,'BLOCKED');
    assert.equal(Object.hasOwn(error,'state'),false); assert.equal(Object.hasOwn(error,'candidate'),false); return true;
  });
  assert.deepEqual(state,before);
}

test('V6 migration: empty workspace keeps counters, savedAt and card preferences, drops only opportunity', () => {
  const old=v5.createWorkspace(T); old.sequence=12; old.revision=40; old.lastSavedAt=T+10;
  v5.changeDirection(old,'CL','short',T+1); const before=clone(old);
  const result=migrateV5ToV6(old,{migratedAt:T+100}); assertV6State(result.state);
  assert.deepEqual(old,before); assert.deepEqual(result.audits,[]);
  assert.equal(result.state.sequence,old.sequence); assert.equal(result.state.revision,old.revision); assert.equal(result.state.lastSavedAt,old.lastSavedAt);
  assert.equal(result.state.cards.CL.direction,'short');
  for(const symbol of v5.ORDER){const {opportunity,...card}=old.cards[symbol];assert.deepEqual(result.state.cards[symbol],card);}
});

for(const stage of ['position','wait','signal']) test(`V6 K/L: V5 ${stage} becomes one canonical record and correct derived lifecycle`, () => {
  const old=v5Active(stage), before=clone(old), result=migrateV5ToV6(old,{migratedAt:T+100});
  assertV6State(result.state); assert.equal(result.state.records.length,1); assert.deepEqual(old,before);
  assert.deepEqual(result.state.records[0],{...old.records[0],exitCapture:null});
  assert.equal(activeTradesForSymbol(result.state,'GC').length,stage==='position'?1:0);
  assert.equal(activeOpportunityForSymbol(result.state,'GC')?.attention??null,stage==='position'?null:stage);
  assert.equal(result.state.records[0].id,old.cards.GC.opportunity.id); assert.deepEqual(result.audits,[]);
});

for(const stage of ['position','wait','signal']) test(`V6 M: missing ${stage} record recovers original ID and emits only recovery audit`, () => {
  const old=v5Active(stage), id=old.cards.GC.opportunity.id;
  if(stage==='position'){
    v5.recordInitialStop(old,'GC',3990,T+10,T+5); v5.correctInitialStop(old,'GC',3980,T+11);
    v5.recordBofToPb(old,'GC',T+12); v5.revertBofToPb(old,'GC',T+13);
  }
  const snapshot=v5.recordSnapshot(old.cards.GC.opportunity); v5.deleteRecord(old,id); v5.assertState(old);
  const before=clone(old), result=migrateV5ToV6(old,{migratedAt:T+100});
  assert.deepEqual(result.state.records,[{...snapshot,exitCapture:null}]); assert.deepEqual(old,before);
  const expected={code:'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD',fromSchemaVersion:5,toSchemaVersion:6,symbol:'GC',opportunityId:id,migratedAt:T+100};
  assert.deepEqual(result.audits,[expected]); assert.deepEqual(result.state.migrationAudit,[expected]); assertV6State(result.state);
  if(stage==='position'){assert.equal(effectiveInitialStop(result.state.records[0]),3980);assert.equal(derivedManagementState(result.state.records[0]),'BOF');}
});

test('V6 migration: multiple missing symbols restore deterministically in GC/CL/ES order without renumbering', () => {
  const old=v5Active('position');
  for(const symbol of ['CL','ES']){
    v5.changeStructure(old,symbol,'range',T+5); v5.changeDirection(old,symbol,'short',T+6);
    v5.chooseSetup(old,symbol,'mtf_pb',T+7); v5.markEntered(old,symbol,T+8,true);
  }
  old.records=[];v5.assertState(old);
  const result=migrateV5ToV6(old,{migratedAt:T+100});
  assert.deepEqual(result.state.records.map(r=>r.symbol),['GC','CL','ES']);
  assert.deepEqual(result.audits.map(r=>r.symbol),['GC','CL','ES']);
  assert.equal(result.state.sequence,old.sequence);assert.equal(result.state.revision,old.revision);
});

test('V6 N: conflicting card/history blocks with ACTIVE_RECORD_CONFLICT_IN_V5, no candidate or input mutation', () => {
  const old=v5Active(); old.records[0].biasAtRegistration='bearish';
  blockedUnchanged(old,{migratedAt:T+100},'ACTIVE_RECORD_CONFLICT_IN_V5');
});

test('V6 migration: history snapshot ordering mismatch is not repaired around the existing V5 validator', () => {
  const old=v5Active(); old.records[0]=Object.fromEntries(Object.entries(old.records[0]).reverse());
  blockedUnchanged(old,{migratedAt:T+100},'ACTIVE_RECORD_CONFLICT_IN_V5');
});

test('V6 migration: invalid V5 capture is rejected rather than rebuilt from the good card', () => {
  const old=v5Active();old.records[0].researchCapture={eventSequence:1,manualEvents:[]};
  blockedUnchanged(old,{migratedAt:T+100},'INVALID_V5_STATE');
});

for(const options of [undefined,{}, {migratedAt:undefined}, {migratedAt:-1}, {migratedAt:NaN}, {migratedAt:Infinity}, {migratedAt:T+0.5}, {migratedAt:T,extra:true}]) {
  test(`V6 migration requires explicit migratedAt: ${String(options?.migratedAt)} / ${Object.keys(options??{}).join(',')}`,()=>{
    blockedUnchanged(v5Active(),options,'MIGRATED_AT_REQUIRED');
  });
}

test('V6 migration: deterministic output, frozen input, no implicit clock and detached recovery audit result', () => {
  const old=v5Active();v5.deleteRecord(old,old.cards.GC.opportunity.id);
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  freeze(old);const original=Date.now; let first,second;
  Date.now=()=>{throw new Error('implicit clock forbidden');};
  try{first=migrateV5ToV6(old,{migratedAt:T+100});second=migrateV5ToV6(old,{migratedAt:T+100});}finally{Date.now=original;}
  assert.deepEqual(first,second); assertV6State(first.state);
  first.audits[0].symbol='CL';assert.equal(first.state.migrationAudit[0].symbol,'GC');
});

test('V6 migration: full stop correction/conversion/undo sequence and closed facts are lossless UNKNOWN exit', () => {
  const old=v5Active();v5.recordInitialStop(old,'GC',3990,T+10,T+5);v5.correctInitialStop(old,'GC',3980,T+11);
  v5.recordBofToPb(old,'GC',T+12);v5.revertBofToPb(old,'GC',T+13);v5.recordBofToPb(old,'GC',T+14);
  v5.markExited(old,'GC',T+15,true);
  const result=migrateV5ToV6(old,{migratedAt:T+100}), r=result.state.records[0];
  assert.deepEqual(r,{...old.records[0],exitCapture:{kind:'UNKNOWN',groupId:null}});
  assert.equal(effectiveInitialStop(r),3980);assert.equal(derivedManagementState(r),'PB');
  assert.deepEqual(activeTradesForSymbol(result.state,'GC'),[]);assert.deepEqual(result.audits,[]);
  const restored=JSON.parse(JSON.stringify(result.state));assertV6State(restored);assert.deepEqual(restored,result.state);
});

for(const reason of ['invalid','canceled','direction']) test(`V6 migration preserves unentered ${reason} history with null exitCapture`,()=>{
  const old=v5Active('wait');
  if(reason==='direction')v5.changeDirection(old,'GC','short',T+10,true);else v5.endOpportunity(old,'GC',reason,T+10);
  const result=migrateV5ToV6(old,{migratedAt:T+100});
  assert.deepEqual(result.state.records[0],{...old.records[0],exitCapture:null});assertV6State(result.state);
});

test('V6 migration preserves V3→V4→V5 rules_upgrade history, zones and old audits without new exit fiction',()=>{
  const envelope=clone(goldenFixtures['unified-v1-active'].value.sections.intraday);
  const old=migrateEnvelope(envelope).envelope.state, before=clone(old), result=migrateV5ToV6(old,{migratedAt:T+100});
  assert.deepEqual(result.state.migrationAudit,old.migrationAudit);assert.deepEqual(result.audits,[]);assert.deepEqual(old,before);
  for(const [i,r] of result.state.records.entries()){
    const {exitCapture,...business}=r;assert.deepEqual(business,old.records[i]);
    if(r.reason==='rules_upgrade')assert.equal(exitCapture,null);
  }
  assertV6State(result.state);
});

test('V6 migration drops empty UI zoneDraft only and keeps legitimate extra record metadata',()=>{
  const old=v5Active();old.cards.GC.opportunity.zoneDraft='';
  for(const r of [old.cards.GC.opportunity,old.records[0]]){r.contextSymbol='GC1!';r.contextSymbolSource='explicit_user';r.metadata={note:'retained'};}
  v5.assertState(old);const result=migrateV5ToV6(old,{migratedAt:T+100});
  assert.equal(Object.hasOwn(result.state.records[0],'zoneDraft'),false);
  assert.equal(result.state.records[0].contextSymbol,'GC1!');assert.deepEqual(result.state.records[0].metadata,{note:'retained'});
});

test('V6 migration stops on nonempty legal V5 zoneDraft without discarding possible user content',()=>{
  const old=v5Active();old.cards.GC.opportunity.zoneDraft='user note';v5.assertState(old);
  blockedUnchanged(old,{migratedAt:T+100},'V5_ZONE_DRAFT_REQUIRES_REVIEW');
});

test('V6 migration blocks loss-prone V5 metadata and does not clean forbidden second truths',()=>{
  const old=v5Active();for(const r of [old.cards.GC.opportunity,old.records[0]])r.currentInitialStop=3990;
  v5.assertState(old);blockedUnchanged(old,{migratedAt:T+100},'V6_MIGRATION_CANDIDATE_INVALID');
});

test('V6 migration candidate rejects a reversed timeline accepted by the older validator without rewriting times',()=>{
  const old=v5Active();for(const r of [old.cards.GC.opportunity,old.records[0]]){
    r.enteredAt=T+1;r.stageSince=T+1;r.stages[0].end=T+1;r.stages[1].start=T+1;
  }
  v5.assertState(old);blockedUnchanged(old,{migratedAt:T+100},'V6_MIGRATION_CANDIDATE_INVALID');
});

test('V6 migration output supports additional independent entry after explicit V2 structure confirmation with recovered ID intact',()=>{
  const old=v5Active();v5.deleteRecord(old,old.cards.GC.opportunity.id);
  const {state}=migrateV5ToV6(old,{migratedAt:T+100});const a=state.records[0];
  const before=structuredClone(state);assert.equal(chooseSetup(state,'GC','mtf_pb',T+109).changed,false);assert.deepEqual(state,before);
  changeStructure(state,'GC','trend_pullback_stronger');
  const b=chooseSetup(state,'GC','mtf_pb',T+110).opportunity;markEntered(state,b.id,T+111,true);
  assert.deepEqual(activeTradesForSymbol(state,'GC').map(r=>r.id),[a.id,b.id]);assert.equal(state.records[0],a);assertV6State(state);
});

test('V6 migration remains disconnected from production startup/persistence imports and storage',()=>{
  for(const file of ['../src/persistence.js','../src/unified-persistence.js','../src/startup.js'])assert.doesNotMatch(readFileSync(new URL(file,import.meta.url),'utf8'),/intraday-v6/);
  assert.doesNotMatch(readFileSync(new URL('../src/intraday-v6/migration.js',import.meta.url),'utf8'),/Date\.now\(|localStorage|setItem\(/);
});
