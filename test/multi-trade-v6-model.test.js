import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as m from '../src/intraday-v6/model.js';
import * as q from '../src/intraday-v6/queries.js';
import * as old from '../src/model.js';
import { T, clone, ready, addTrade, pair } from './fixtures/intraday-v6.js';

function rejectsUnchanged(state, action, code) {
  const before = clone(state);
  assert.throws(action, code ? error => error.code === code : undefined);
  assert.deepEqual(state, before); m.assertV6State(state);
}

test('V6 A: PB opportunity enters using the same canonical record, ID and object', () => {
  const state = ready(), { opportunity } = m.chooseSetup(state, 'GC', 'mtf_pb', T + 10);
  assert.equal(q.recordLifecycleState(opportunity), 'wait');
  const id = opportunity.id, count = state.records.length;
  m.setOpportunityStage(state, id, 'signal', T + 11);
  assert.equal(q.recordLifecycleState(opportunity), 'signal');
  m.markEntered(state, id, T + 12, true);
  assert.equal(state.records.length, count); assert.equal(state.records[0], opportunity);
  assert.equal(opportunity.id, id); assert.equal(q.recordLifecycleState(opportunity), 'position');
  assert.equal(q.activeOpportunityForSymbol(state, 'GC'), null);
  assert.deepEqual(opportunity.stages, [{ state:'wait',start:T+10,end:T+11 }, { state:'signal',start:T+11,end:T+12 }, { state:'position',start:T+12,end:null }]);
});

test('V6 B/C: held A permits same-direction PB wait and entry B; A remains unchanged', () => {
  const state = ready(), a = addTrade(state), before = clone(a);
  state.cards.GC.direction = 'short'; // Card is a preference, not an override of active truth.
  const { opportunity: b } = m.chooseSetup(state, 'GC', 'mtf_pb', T + 20);
  assert.equal(b.direction, 'long'); assert.equal(q.activeOpportunityForSymbol(state, 'GC'), b);
  assert.equal(q.effectiveDirectionForSymbol(state, 'GC'), 'long');
  m.markEntered(state, b.id, T + 21, true);
  assert.deepEqual(q.activeTradesForSymbol(state, 'GC').map(r => r.id), [a.id, b.id]);
  assert.deepEqual(a, before); assert.equal(q.activeOpportunityForSymbol(state, 'GC'), null);
});

test('V6 D/E/F/G: B Stop exits alone, reload preserves A, C enters, flatten closes A/C once', () => {
  let { state, a, b } = pair(); const savedA = clone(a);
  m.markTradeExited(state, b.id, 'STOP_EXIT', T + 30, true);
  assert.deepEqual(a, savedA); assert.deepEqual(b.exitCapture, { kind:'STOP_EXIT',groupId:null });
  state = JSON.parse(JSON.stringify(state)); m.assertV6State(state);
  assert.deepEqual(q.activeTradesForSymbol(state, 'GC').map(r=>r.id), [a.id]);
  assert.equal(q.recordLifecycleState(state.records.find(r=>r.id===b.id)), 'ended');
  const c = addTrade(state, 'mtf_pb', T + 40), beforeB = clone(state.records.find(r=>r.id===b.id));
  const before = state.revision, result = m.markAllTradesExited(state, 'GC', T + 50, true);
  assert.equal(state.revision, before + 1); assert.deepEqual(result.targetIds, [a.id,c.id]);
  const closed = result.targetIds.map(id=>state.records.find(r=>r.id===id));
  assert.ok(closed.every(r=>r.endedAt===T+50 && r.reason==='closed' && r.exitCapture.kind==='MANUAL_FLATTEN'));
  assert.equal(closed[0].exitCapture.groupId, closed[1].exitCapture.groupId);
  assert.deepEqual(state.records.find(r=>r.id===b.id), beforeB);
});

test('V6 H: each trade owns its stop and corrections retain the first event without touching B', () => {
  const { state,a,b } = pair();
  m.recordInitialStop(state,a.id,3990,T+22); m.recordInitialStop(state,b.id,4025,T+23);
  const first = clone(a.researchCapture.manualEvents[0]), savedB = clone(b);
  m.correctInitialStop(state,a.id,3988,T+24);
  assert.equal(m.effectiveInitialStop(a),3988); assert.equal(m.effectiveInitialStop(b),4025);
  assert.deepEqual(a.researchCapture.manualEvents[0],first); assert.deepEqual(b,savedB);
  assert.deepEqual(a.researchCapture.manualEvents[1].payload,{oldValue:3990,newValue:3988});
});

test('V6 I: A BOF→PB and revert are independent of BOF B and do not replace original Setup', () => {
  const { state,a,b } = pair(), savedB = clone(b);
  m.recordBofToPb(state,a.id,T+22); const first = clone(a.researchCapture.manualEvents[0]);
  assert.equal(m.derivedManagementState(a),'PB'); assert.equal(m.derivedManagementState(b),'BOF');
  m.revertBofToPb(state,a.id,T+23);
  assert.equal(m.derivedManagementState(a),'BOF'); assert.equal(a.type,'mtf_bof');
  assert.deepEqual(a.researchCapture.manualEvents[0],first); assert.deepEqual(b,savedB);
  assert.equal(a.researchCapture.manualEvents[1].payload.revertedEventId,first.id);
});

test('V6 J / independent audit: JSON reload restores A+B+C wait without any card opportunity/cache', () => {
  const { state,a,b } = pair(), { opportunity:c } = m.chooseSetup(state,'GC','mtf_pb',T+30);
  for (const card of Object.values(state.cards)) {
    assert.deepEqual(Object.keys(card).sort(),['symbol','bias','structure3m','needsStructureReview','direction','idleSince'].sort());
    assert.equal(Object.hasOwn(card,'opportunity'),false); assert.equal(Object.hasOwn(card,'activeTrades'),false);
  }
  const restored = JSON.parse(JSON.stringify(state)); m.assertV6State(restored);
  assert.deepEqual(restored,state);
  assert.deepEqual(q.activeTradesForSymbol(restored,'GC').map(r=>r.id),[a.id,b.id]);
  assert.equal(q.activeOpportunityForSymbol(restored,'GC').id,c.id);
  assert.equal(q.recordLifecycleState(q.activeOpportunityForSymbol(restored,'GC')),'wait');
});

for (const kind of ['trade','opportunity']) test(`V6 O/P: ${kind} ordinary deletion rejects with unchanged state/revision`, () => {
  const state = ready(), r = kind==='trade' ? addTrade(state) : m.chooseSetup(state,'GC','mtf_pb',T+10).opportunity;
  rejectsUnchanged(state,()=>m.deleteRecord(state,r.id),'V6_ACTIVE_RECORD_DELETE_FORBIDDEN');
});

test('V6 Q: flatten preflights B event time before mutating either A or B', () => {
  const { state,a,b } = pair(); m.recordInitialStop(state,b.id,4000,T+40);
  rejectsUnchanged(state,()=>m.markAllTradesExited(state,'GC',T+30,true),'V6_TIME_INVALID');
  assert.equal(a.endedAt,null); assert.equal(b.endedAt,null);
});

test('V6 Q boundary: flatten rejects before the later position stage start; A is not partially closed', () => {
  const { state } = pair(); rejectsUnchanged(state,()=>m.markAllTradesExited(state,'GC',T+15,true),'V6_TIME_INVALID');
});

test('V6 R: flatten leaves pending C and unrelated CL trade completely unchanged', () => {
  const { state } = pair(); m.changeStructure(state,'CL','htf_range_v2'); m.changeDirection(state,'CL','short',T+25);
  const cl=addTrade(state,'mtf_bof',T+26,'CL'), c=m.chooseSetup(state,'GC','mtf_pb',T+30).opportunity;
  const cBefore=clone(c), clBefore=clone(cl); m.markAllTradesExited(state,'GC',T+40,true);
  assert.deepEqual(c,cBefore); assert.deepEqual(cl,clBefore);
  assert.equal(q.activeOpportunityForSymbol(state,'GC'),c);
  assert.equal(q.effectiveDirectionForSymbol(state,'GC'),'long');
});

test('V6 S: active LONG blocks ordinary SHORT change even when confirmed; new Setup inherits LONG', () => {
  const state=ready(), a=addTrade(state), before=clone(state);
  assert.deepEqual(m.changeDirection(state,'GC','short',T+20,true),{changed:false,reason:'holding'});
  assert.deepEqual(state,before);
  const b=m.chooseSetup(state,'GC','mtf_pb',T+20).opportunity;
  assert.equal(b.direction,a.direction); m.assertV6State(state);
});

test('V6 direction is also locked by pending alone and unlocks only after pending ends', () => {
  const state=ready(), pending=m.chooseSetup(state,'GC','mtf_pb',T+10).opportunity, before=clone(state);
  assert.deepEqual(m.changeDirection(state,'GC','short',T+11,true),{changed:false,reason:'pending'});
  assert.deepEqual(state,before);
  m.endOpportunity(state,pending.id,'canceled',T+12);
  assert.equal(m.changeDirection(state,'GC','short',T+13).changed,true);
});

test('V6 T: context updates leave old snapshots intact; B freezes new Bias/Structure', () => {
  const state=ready(); m.changeBias(state,'GC','bullish'); const a=addTrade(state), before=clone(a);
  m.changeBias(state,'GC','bearish'); m.changeStructure(state,'GC','htf_range_v2');
  const b=m.chooseSetup(state,'GC','mtf_pb',T+20).opportunity;
  assert.deepEqual(a,before); assert.equal(a.structure3mAtRegistration,'trend_pullback_stronger'); assert.equal(a.biasAtRegistration,'bullish');
  assert.equal(b.structure3mAtRegistration,'htf_range_v2'); assert.equal(b.biasAtRegistration,'bearish'); assert.equal(b.direction,'long');
});

for (const [label,action] of [
  ['stop zero',(s,a)=>m.recordInitialStop(s,a.id,0,T+30)],
  ['stop NaN',(s,a)=>m.recordInitialStop(s,a.id,NaN,T+30)],
  ['stop Infinity',(s,a)=>m.recordInitialStop(s,a.id,Infinity,T+30)],
  ['event before entry',(s,a)=>m.recordInitialStop(s,a.id,3990,T+1)],
  ['future effective time',(s,a)=>m.recordInitialStop(s,a.id,3990,T+30,T+31)],
  ['correction before recording',(s,a)=>m.correctInitialStop(s,a.id,3990,T+30)],
  ['single close before event',(s,a)=>{m.recordInitialStop(s,a.id,3990,T+40);return ()=>m.markTradeExited(s,a.id,'STOP_EXIT',T+30,true);}],
  ['single close before stage',(s,a)=>m.markTradeExited(s,a.id,'UNKNOWN',T+1,true)]
]) test(`V6 U: ${label} rejects atomically`, () => {
  const {state,a}=pair();
  if (label==='single close before event') rejectsUnchanged(state,action(state,a));
  else rejectsUnchanged(state,()=>action(state,a));
});

test('V6 late stop / event monotonicity / no-op actions preserve append-only values and revision', () => {
  const {state,a}=pair(); m.recordInitialStop(state,a.id,3990,T+30,T+12);
  assert.equal(a.researchCapture.manualEvents[0].type,'INITIAL_STOP_LATE_RECORDED');
  rejectsUnchanged(state,()=>m.correctInitialStop(state,a.id,3980,T+29));
  rejectsUnchanged(state,()=>m.recordBofToPb(state,a.id,T+29));
  const rev=state.revision; assert.equal(m.correctInitialStop(state,a.id,3990,T+31).changed,false); assert.equal(state.revision,rev);
  m.recordBofToPb(state,a.id,T+31); const after=clone(state);
  assert.equal(m.recordBofToPb(state,a.id,T+32).changed,false); assert.deepEqual(state,after);
});

test('V6 full manual event log survives both single exit and JSON reload', () => {
  const {state,a}=pair(); m.recordInitialStop(state,a.id,3990,T+22); m.correctInitialStop(state,a.id,3980,T+23);
  m.recordBofToPb(state,a.id,T+24); m.revertBofToPb(state,a.id,T+25);
  const events=clone(a.researchCapture); m.markTradeExited(state,a.id,'OTHER_EXIT',T+30,true);
  const restored=JSON.parse(JSON.stringify(state)); m.assertV6State(restored);
  assert.deepEqual(restored.records.find(r=>r.id===a.id).researchCapture,events);
});

test('V6 confirmations require explicit true, and empty flatten / same stage are no-ops', () => {
  const state=ready(), pending=m.chooseSetup(state,'GC','mtf_pb',T+10).opportunity;
  let before=clone(state); assert.equal(m.markEntered(state,pending.id,T+11).needsConfirmation,true); assert.deepEqual(state,before);
  assert.equal(m.setOpportunityStage(state,pending.id,'wait',T+11).changed,false); assert.deepEqual(state,before);
  m.markEntered(state,pending.id,T+11,true); before=clone(state);
  assert.equal(m.markTradeExited(state,pending.id,'UNKNOWN',T+12,'true').needsConfirmation,true);
  assert.equal(m.markAllTradesExited(state,'GC',T+12,false).needsConfirmation,true); assert.deepEqual(state,before);
  assert.equal(m.markAllTradesExited(state,'CL',T+12,true).changed,false); assert.deepEqual(state,before);
});

test('V6 ID operations cannot affect the wrong stage or reuse an ended trade', () => {
  const {state,a}=pair();
  rejectsUnchanged(state,()=>m.setOpportunityStage(state,a.id,'signal',T+30),'V6_PENDING_REQUIRED');
  rejectsUnchanged(state,()=>m.markEntered(state,a.id,T+30,true),'V6_PENDING_REQUIRED');
  rejectsUnchanged(state,()=>m.endOpportunity(state,a.id,'canceled',T+30),'V6_PENDING_REQUIRED');
  rejectsUnchanged(state,()=>m.markTradeExited(state,a.id,'MANUAL_FLATTEN',T+30,true),'V6_EXIT_KIND_INVALID');
  rejectsUnchanged(state,()=>m.recordInitialStop(state,'GC',3990,T+30),'V6_RECORD_NOT_FOUND');
  m.markTradeExited(state,a.id,'UNKNOWN',T+30,true);
  rejectsUnchanged(state,()=>m.markTradeExited(state,a.id,'UNKNOWN',T+31,true),'V6_ACTIVE_TRADE_REQUIRED');
});

test('V6 pending Setup replacement/end preflights time and never changes existing A', () => {
  const state=ready(), a=addTrade(state), savedA=clone(a), pending=m.chooseSetup(state,'GC','mtf_pb',T+20).opportunity;
  m.setOpportunityStage(state,pending.id,'signal',T+25);
  rejectsUnchanged(state,()=>m.chooseSetup(state,'GC','mtf_bof',T+24),'V6_TIME_INVALID');
  rejectsUnchanged(state,()=>m.endOpportunity(state,pending.id,'invalid',T+24),'V6_TIME_INVALID');
  rejectsUnchanged(state,()=>m.setOpportunityStage(state,pending.id,'wait',T+24),'V6_TIME_INVALID');
  const next=m.chooseSetup(state,'GC','mtf_bof',T+26).opportunity;
  assert.equal(pending.reason,'canceled'); assert.equal(pending.exitCapture,null); assert.notEqual(next.id,pending.id); assert.deepEqual(a,savedA);
});

test('V6 deterministic query ordering includes ID tie breaker and never sorts records in place', () => {
  const {state,a,b}=pair();
  b.enteredAt=a.enteredAt; b.registeredAt=a.registeredAt; b.createdAt=a.createdAt; b.stageSince=a.stageSince; b.stages=clone(a.stages);
  a.id='z'; b.id='a'; state.records.reverse(); const before=clone(state); m.assertV6State(state);
  assert.deepEqual(q.activeTradesForSymbol(state,'GC').map(r=>r.id),['a','z']); assert.deepEqual(state,before);
  assert.equal(q.activeOpportunityForSymbol(state,'CL'),null); assert.equal(q.effectiveDirectionForSymbol(state,'CL'),'none');
});

test('V6 flatten group IDs are deterministic, distinct across batches and avoid imported collisions', () => {
  const {state}=pair(), before=clone(state), a=m.markAllTradesExited(state,'GC',T+30,true), restored=clone(before);
  assert.deepEqual(m.markAllTradesExited(restored,'GC',T+30,true),a); assert.deepEqual(restored,state);
  addTrade(state,'mtf_pb',T+40); const b=m.markAllTradesExited(state,'GC',T+50,true); assert.notEqual(a.groupId,b.groupId);
  addTrade(state,'mtf_pb',T+60);
  state.records[0].exitCapture.groupId=`flatten-${state.revision+1}`; state.records[1].exitCapture.groupId=state.records[0].exitCapture.groupId;
  const used=state.records[0].exitCapture.groupId; const c=m.markAllTradesExited(state,'GC',T+70,true); assert.notEqual(c.groupId,used); m.assertV6State(state);
});

test('V6 ended history can be deleted; no-op missing ID leaves revision unchanged', () => {
  const {state,a}=pair(); m.markTradeExited(state,a.id,'UNKNOWN',T+30,true);
  assert.equal(m.deleteRecord(state,a.id).changed,true); const before=clone(state);
  assert.equal(m.deleteRecord(state,a.id).changed,false); assert.deepEqual(state,before);
});

test('V6 frozen input is rejected before mutation, and overflow cannot partially write', () => {
  const {state,a}=pair(); state.revision=Number.MAX_SAFE_INTEGER;
  rejectsUnchanged(state,()=>m.markTradeExited(state,a.id,'UNKNOWN',T+30,true),'V6_STATE_INVALID');
  state.revision=10; Object.freeze(a); const before=clone(state);
  assert.throws(()=>m.markTradeExited(state,a.id,'UNKNOWN',T+30,true),e=>e.code==='V6_STATE_NOT_WRITABLE'); assert.deepEqual(state,before);
});

test('V6 validation preflight rejects corrupted input before any command can change it', () => {
  const {state,a,b}=pair(); b.direction='short'; const before=clone(state);
  assert.throws(()=>m.markTradeExited(state,a.id,'UNKNOWN',T+30,true),e=>e.code==='V6_DIRECTION_CONFLICT');
  assert.deepEqual(state,before);
});

test('V6 capture API rejects pending/ended targets and invalid correction without leaking to another trade', () => {
  const {state,a}=pair(); const pending=m.chooseSetup(state,'GC','mtf_pb',T+30).opportunity;
  rejectsUnchanged(state,()=>m.recordInitialStop(state,pending.id,3990,T+31),'V6_ACTIVE_TRADE_REQUIRED');
  m.recordInitialStop(state,a.id,3990,T+32);
  rejectsUnchanged(state,()=>m.correctInitialStop(state,a.id,-1,T+33),'V6_CAPTURE_INVALID');
  m.markTradeExited(state,a.id,'UNKNOWN',T+34,true);
  rejectsUnchanged(state,()=>m.recordBofToPb(state,a.id,T+35),'V6_ACTIVE_TRADE_REQUIRED');
});

test('V6 invalid configuration/stage/entry commands are atomic and successful no-ops preserve revision', () => {
  const state=ready(), pending=m.chooseSetup(state,'GC','mtf_pb',T+10).opportunity;
  for(const action of [()=>m.changeBias(state,'GC','invalid'),()=>m.changeStructure(state,'GC','invalid'),
    ()=>m.changeDirection(state,'GC','invalid'),()=>m.chooseSetup(state,'GC','invalid',T+20),
    ()=>m.setOpportunityStage(state,pending.id,'position',T+20),()=>m.markEntered(state,pending.id,T+1,true),
    ()=>m.markEntered(state,'missing',T+20,true)]) rejectsUnchanged(state,action);
  const before=clone(state); assert.equal(m.changeBias(state,'GC','neutral').changed,false);
  assert.equal(m.changeStructure(state,'GC','trend_pullback_stronger').changed,false); assert.equal(m.chooseSetup(state,'GC','mtf_pb',T+20).changed,false);
  assert.deepEqual(state,before);
});

test('V6 JSON validation rejects getters without invoking them during commands', () => {
  const {state,a}=pair(); let reads=0;
  Object.defineProperty(a,'metadata',{enumerable:true,configurable:true,get(){reads+=1;return 1;}});
  const revision=state.revision;
  assert.throws(()=>m.markTradeExited(state,a.id,'UNKNOWN',T+30,true),e=>e.code==='V6_JSON_INVALID');
  assert.equal(reads,0); assert.equal(state.revision,revision); assert.equal(a.endedAt,null);
});

test('V6 PB conversion rejects, SHORT trade stop and per-ID management still use frozen event semantics', () => {
  const state=ready('ES','short'), pb=addTrade(state,'mtf_pb',T+10,'ES');
  rejectsUnchanged(state,()=>m.recordBofToPb(state,pb.id,T+20),'V6_CAPTURE_INVALID');
  m.recordInitialStop(state,pb.id,6000,T+20); assert.equal(m.effectiveInitialStop(pb),6000);
  assert.equal(m.derivedManagementState(pb),'PB'); assert.equal(q.effectiveDirectionForSymbol(state,'ES'),'short');
});

const invalidStates = [
  ['card opportunity',s=>{s.cards.GC.opportunity=null;}],
  ['card activeTrades',s=>{s.cards.GC.activeTrades=[];}],
  ['top cached activeTrades',s=>{s.activeTrades=[];}],
  ['duplicate record ID',s=>{s.records.push(clone(s.records[0]));}],
  ['two pending',s=>{const r=clone(s.records[0]);r.id='pending1';r.enteredAt=null;r.stageSince=r.registeredAt;r.stages=[{state:'wait',start:r.registeredAt,end:null}];s.records.push(r);s.records.push({...clone(r),id:'pending2'});}],
  ['opposed active directions',s=>{s.records[1].direction='short';}],
  ['opposed pending direction',s=>{const r=clone(s.records[0]);r.id='pending';r.direction='short';r.enteredAt=null;r.stageSince=r.registeredAt;r.stages=[{state:'wait',start:r.registeredAt,end:null}];s.records.push(r);}],
  ['current stop duplicate',s=>{s.records[0].currentInitialStop=3990;}],
  ['initialStop second truth',s=>{s.records[0].initialStop=3990;}],
  ['current management duplicate',s=>{s.records[0].currentManagementState='PB';}],
  ['tradeId duplicate identity',s=>{s.records[0].tradeId=s.records[0].id;}],
  ['zoneDraft',s=>{s.records[0].zoneDraft='';}],
  ['active exit capture',s=>{s.records[0].exitCapture={kind:'UNKNOWN',groupId:null};}],
  ['ended missing exit capture',s=>{const r=s.records[0];r.endedAt=T+40;r.stages.at(-1).end=T+40;r.reason='closed';}],
  ['event from other record',s=>{s.records[1].researchCapture=clone(s.records[0].researchCapture);}],
  ['stage reversed time',s=>{s.records[0].stages[0].end=T+1;s.records[0].stages[1].start=T+1;s.records[0].enteredAt=T+1;s.records[0].stageSince=T+1;}],
  ['entry timestamp mismatch',s=>{s.records[0].enteredAt+=1;}],
  ['ended timestamp mismatch',s=>{const r=s.records[0];r.endedAt=T+40;r.stages.at(-1).end=T+41;r.reason='closed';r.exitCapture={kind:'UNKNOWN',groupId:null};}],
  ['non-JSON metadata',s=>{s.records[0].metadata=undefined;}],
  ['flatten group time conflict',s=>{for(const [i,r] of s.records.entries()){r.endedAt=T+40+i;r.stages.at(-1).end=r.endedAt;r.reason='closed';r.exitCapture={kind:'MANUAL_FLATTEN',groupId:'same'};}}],
  ['single exit group ID',s=>{const r=s.records[0];r.endedAt=T+40;r.stages.at(-1).end=T+40;r.reason='closed';r.exitCapture={kind:'STOP_EXIT',groupId:'forbidden'};}],
  ['exitCapture extra timestamp',s=>{const r=s.records[0];r.endedAt=T+40;r.stages.at(-1).end=T+40;r.reason='closed';r.exitCapture={kind:'UNKNOWN',groupId:null,confirmedAt:T+40};}],
  ['null flatten group ID',s=>{const r=s.records[0];r.endedAt=T+40;r.stages.at(-1).end=T+40;r.reason='closed';r.exitCapture={kind:'MANUAL_FLATTEN',groupId:null};}],
  ['negative zero JSON loss',s=>{s.records[0].metadata=-0;}],
  ['sparse array with extra property',s=>{const a=[1];a.length=2;a.extra='not JSON';s.records[0].metadata=a;}],
  ['null migration audit',s=>{s.migrationAudit.push(null);}]
];
for (const [label,mutate] of invalidStates) test(`V6 validator rejects ${label} without repairing input`, () => {
  const {state,a}=pair(); m.recordInitialStop(state,a.id,3990,T+25); mutate(state); const before=clone(state);
  assert.throws(()=>m.assertV6State(state)); assert.deepEqual(state,before);
});

test('V6 production isolation: old V5 remains unchanged and production bundle excludes V6 modules', () => {
  assert.equal(old.createWorkspace(T).schemaVersion,5); assert.equal(m.createWorkspace(T).schemaVersion,6);
  const bundle=readFileSync(new URL('./fixtures/frozen-m1/app.bundle.txt',import.meta.url));
  assert.equal(createHash('sha256').update(bundle).digest('hex'),'7372cfb300effc6d5283683b610675900fdd87f133e756203d2cd26176ac2a6c');
  for (const file of ['./fixtures/frozen-m1/app.txt','./fixtures/frozen-m1/build.txt','./fixtures/frozen-m1/research-bundle.txt']) assert.doesNotMatch(readFileSync(new URL(file,import.meta.url),'utf8'),/intraday-v6/);
});
