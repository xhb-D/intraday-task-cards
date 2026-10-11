import test from 'node:test';
import assert from 'node:assert/strict';
import { intradayV6 as v } from '../src/intraday-v6/index.js';
import * as decisions from '../src/intraday-v6/expectations.js';
import * as adapter from '../src/exit-research/ui/capture-adapter.js';
import { researchSetupClass } from '../src/model.js';
import { parseCsv } from '../src/exit-research/csv.js';
import { renderHistoryArchive, assertArchiveRetention } from '../src/history-archive.js';
import { captureUi } from '../src/capture-ui.js';
import { makeUnified, commitUnified, normalizeImport, loadUnified, UNIFIED_KEY } from '../src/capture-unified.js';
import { makeEnvelope, exportMarkdown } from '../src/capture-persistence.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const T=1750000000000, content=path=>({path,keyLevels:'',focus:''});
function fixture(type='bof') {
  const s=v.createWorkspace(T);v.changeStructure(s,'GC','breakout_strong_pullback_weak');v.changeDirection(s,'GC','long',T);
  const r=v.chooseSetup(s,'GC',type,T).opportunity;return {s,r};
}
function active(type='bof') {const f=fixture(type);v.markEntered(f.s,f.r.id,T,true);return f;}
function unchanged(s,fn,code) {const before=structuredClone(s);assert.throws(fn,code?{code}:undefined);assert.deepEqual(s,before);}

test('F01: ended record cannot be hard-deleted, including its complete manual history',()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('原始'),'entry',T);v.recordInitialStop(s,r.id,90,T);v.updateHoldingExpectation(s,r.id,'met','','hold',T);v.markTradeExited(s,r.id,'UNKNOWN',T,true);
  unchanged(s,()=>v.deleteRecord(s,r.id),'V6_RECORD_DELETE_FORBIDDEN');assert.equal(s.records.length,1);
});
for(const target of ['SPB','CPB'])test(`F02: original bof permits one append-only management switch to ${target}`,()=>{
  const {s,r}=active();const original=structuredClone(r);
  v.switchBofManagement(s,r.id,target,'switch',T);
  assert.equal(r.type,'bof');assert.equal(v.currentManagement(r),target);assert.equal(researchSetupClass(r.type),null);
  assert.deepEqual({...r,researchCapture:original.researchCapture},original);
  const e=r.researchCapture.manualEvents[0];assert.equal(e.type,'BOF_MANAGEMENT_SWITCH_RECORDED');assert.equal(e.payload.from,'BOF');assert.equal(e.payload.to,target);
  unchanged(s,()=>v.switchBofManagement(s,r.id,target,'second',T),'V6_MANAGEMENT_SWITCH_FORBIDDEN');
});
for(const id of ['=1+1','+1+1','-1+1','@SUM(1,1)','\t=1+1','\r@SUM(1,1)','\n+1+1','\u0000=1+1','\ufeff=1+1','\u200b=1+1','\u2028=1+1','\u2066@SUM(1,1)',' =1+1',"'original",'csv-text:original','逗号,"换行\n身份'])test(`F03: CSV text is safe and original identity recoverable ${JSON.stringify(id)}`,()=>{
  const {s,r}=fixture();r.id=id;v.assertV6State(s);const csv=adapter.decisionReviewCsv(s),parsed=parseCsv(csv),value=parsed.rows[0].values[0];
  assert.doesNotMatch(value,/^[=+\-@\u0000-\u0020\u007f-\u009f\ufeff']/u);
  assert.equal(adapter.decodeDecisionCsvText(value),id);assert.equal(s.records[0].id,id);
});
test('F03: CSV decoder rejects malformed or non-text encoded identities',()=>{
  for(const value of ['csv-text:{}','csv-text:null','csv-text:123','csv-text:[]','csv-text:broken',null])assert.throws(()=>adapter.decodeDecisionCsvText(value));
});
test('F04: equal-millisecond facts appear between before/holding/post-close events, without rewriting truth',()=>{
  const {s,r}=fixture();v.recordEntryExpectation(s,r.id,content('前'),'entry',T);v.markEntered(s,r.id,T,true);v.correctEntryExpectation(s,r.id,content('后'),'correct',T);v.updateHoldingExpectation(s,r.id,'met','','hold',T);v.markTradeExited(s,r.id,'UNKNOWN',T,true);v.correctEntryExpectation(s,r.id,content('复盘'),'review',T);
  const before=structuredClone(r),timeline=decisions.manualDecisionTimeline(r);
  assert.deepEqual(timeline.map(e=>e.id),[`${r.id}:manual-1`,'html-entry',`${r.id}:manual-2`,`${r.id}:manual-3`,'html-exit',`${r.id}:manual-4`]);assert.deepEqual(r,before);
});

for(const reason of ['closed','canceled','invalid'])test(`F01: ${reason} archive retains IDs, complete exports and read-only query, no row delete`,()=>{
  const {s,r}=fixture();v.recordEntryExpectation(s,r.id,content('档案查询目标'),'entry',T);
  if(reason==='closed'){v.markEntered(s,r.id,T,true);v.markTradeExited(s,r.id,'UNKNOWN',T,true);}else v.endOpportunity(s,r.id,reason,T);
  const before=structuredClone(s),rows=v.archivedRecords(s,'查询目标'),html=renderHistoryArchive(s,r.id);
  assert.deepEqual(rows,[r]);assert.doesNotMatch(html,/data-delete/);assert.match(html,/预期与完整历史/);assert.equal(v.archivedRecords(s,'not found').length,0);
  assert.deepEqual(normalizeImport(makeUnified(makeEnvelope(s,T)),makeUnified()).state.sections.intraday.state.records,[r]);
  assert.ok(exportMarkdown(s,'all',T).includes(r.id));assert.ok(adapter.decisionReviewCsv(s).includes(r.id));assert.equal(adapter.weeklyDecisionReview(s)[0].recordId,r.id);
  assert.doesNotMatch(captureUi.renderCard(s,'GC'),new RegExp(`data-record-id="${r.id}"`));unchanged(s,()=>v.deleteRecord(s,r.id),'V6_RECORD_DELETE_FORBIDDEN');assert.deepEqual(s,before);
});
test('F01: home contains archive navigation only; table and query belong to separate route',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),home=html.split('<section data-route-view="home">')[1].split('<section data-route-view="history"')[0];
  assert.match(home,/href="#\/history"/);assert.doesNotMatch(home,/<table|id="history-body"|data-delete|data-scope/);
  assert.match(html,/<section data-route-view="history"[^]*?id="archive-query"[^]*?id="history-body"/);
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');assert.doesNotMatch(app,/data-delete|intradayV6\.deleteRecord/);assert.match(app,/assertArchiveRetention\(state,preview.state.sections.intraday.state\)/);
});
test('F01: restore/fresh replacement cannot drop, change or truncate ended archive; explicit post-close append remains valid',()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('记录'),'e',T);v.markTradeExited(s,r.id,'UNKNOWN',T,true);
  for(const change of [x=>x.records=[],x=>x.records[0].type='cpb',x=>x.records[0].researchCapture.manualEvents=[],x=>x.records[0].researchCapture.manualEvents[0].payload.content.path='改写']){
    const next=structuredClone(s);change(next);unchanged(s,()=>assertArchiveRetention(s,next),'V6_ARCHIVE_RETENTION_REQUIRED');
  }
  const next=structuredClone(s);v.correctEntryExpectation(next,r.id,content('复盘补写'),'c',T+1);assert.equal(assertArchiveRetention(s,next),true);
  assert.equal(assertArchiveRetention(s,JSON.parse(JSON.stringify(s))),true);
});
for(const type of ['spb','cpb'])test(`F02: ${type} default management and ordinary operations survive; conversion to BOF rejected`,()=>{
  const {s,r}=active(type);assert.equal(v.currentManagement(r),type.toUpperCase());assert.equal(r.researchCapture.manualEvents.length,0);
  for(const target of ['BOF','SPB','CPB'])unchanged(s,()=>v.switchBofManagement(s,r.id,target,'switch',T),'V6_MANAGEMENT_SWITCH_FORBIDDEN');
  v.recordEntryExpectation(s,r.id,content('保留'),'e',T);v.recordInitialStop(s,r.id,90,T);v.updateHoldingExpectation(s,r.id,'observing','','h',T);v.markTradeExited(s,r.id,'UNKNOWN',T,true);
  assert.equal(r.researchCapture.manualEvents.length,3);assert.ok(r.endedAt!==null);
});
test('F02: pending/ended/invalid target and reverse switches fail without partial writes',()=>{
  const {s,r}=fixture();unchanged(s,()=>v.switchBofManagement(s,r.id,'SPB','pending',T),'V6_ACTIVE_TRADE_REQUIRED');v.markEntered(s,r.id,T,true);
  for(const to of ['BOF','spb','cpb','PB','OTHER',null])unchanged(s,()=>v.switchBofManagement(s,r.id,to,'invalid',T),'V6_MANAGEMENT_SWITCH_FORBIDDEN');
  v.switchBofManagement(s,r.id,'CPB','one',T);unchanged(s,()=>v.switchBofManagement(s,r.id,'SPB','two',T),'V6_MANAGEMENT_SWITCH_FORBIDDEN');
  v.markTradeExited(s,r.id,'UNKNOWN',T,true);unchanged(s,()=>v.switchBofManagement(s,r.id,'SPB','three',T),'V6_ACTIVE_TRADE_REQUIRED');
});
test('F02: duplicate submission no-ops; conflicting reuse rejects; original event and other trade unchanged',()=>{
  const {s,r}=active(),b=v.chooseSetup(s,'GC','bof',T).opportunity;v.markEntered(s,b.id,T,true);const other=structuredClone(b);
  v.switchBofManagement(s,r.id,'SPB','one',T);const before=structuredClone(s);
  assert.equal(v.switchBofManagement(s,r.id,'SPB','one',T+1).reason,'duplicate');assert.deepEqual(s,before);assert.deepEqual(b,other);
  unchanged(s,()=>v.switchBofManagement(s,r.id,'CPB','one',T+1),'V6_SUBMISSION_CONFLICT');
});
test('F02: management interleaves with initial stop, expectations and observations; full backup restores all IDs',()=>{
  const {s,r}=fixture();v.recordEntryExpectation(s,r.id,content('事前'),'entry',T);v.markEntered(s,r.id,T,true);v.recordInitialStop(s,r.id,90,T);v.switchBofManagement(s,r.id,'CPB','switch',T);v.correctEntryExpectation(s,r.id,content('更正'),'correct',T);v.updateHoldingExpectation(s,r.id,'underperformed','','holding',T);v.correctInitialStop(s,r.id,89,T);v.markTradeExited(s,r.id,'UNKNOWN',T,true);v.correctEntryExpectation(s,r.id,content('复盘'),'review',T);
  const events=r.researchCapture.manualEvents;assert.deepEqual(events.map(e=>e.id),events.map((_,i)=>`${r.id}:manual-${i+1}`));assert.equal(v.currentManagement(r),'CPB');
  assert.deepEqual(v.singleRecordV5View(r).records[0].researchCapture.manualEvents.map(e=>e.type),['INITIAL_STOP_RECORDED','INITIAL_STOP_CORRECTED']);
  const u=makeUnified(makeEnvelope(s,T)),store=memory(JSON.stringify(u));assert.deepEqual(loadUnified(store).state.sections.intraday.state.records,s.records);
  assert.deepEqual(normalizeImport(u,makeUnified()).state.sections.intraday.state.records,s.records);
  const csv=parseCsv(adapter.decisionReviewCsv(s));assert.deepEqual(JSON.parse(csv.rows[0].values[7]),events);assert.equal(csv.rows[0].values[9],'CPB');
  assert.ok(exportMarkdown(s,'all',T).includes('BOF_MANAGEMENT_SWITCH_RECORDED'));assert.deepEqual(adapter.weeklyDecisionReview(s)[0].manualEvents,events);
});
for(const defect of ['from','to','originalSetup','pending','endedSnapshot','missingEntrySnapshot','timing','extra','recordId','eventId','sequence','duplicateSwitch','duplicateSubmission','source','effectiveAt','oldBOF'])test(`F02 strict union rejects forged switch: ${defect}`,()=>{
  const {s,r}=active();v.switchBofManagement(s,r.id,'SPB','switch',T);const e=r.researchCapture.manualEvents[0];
  if(defect==='from')e.payload.from='SPB';if(defect==='to')e.payload.to='BOF';if(defect==='originalSetup')r.type='cpb';
  if(defect==='pending'){e.payload.htmlEnteredAtAtRecording=null;e.payload.timing='before_html_entry';}
  if(defect==='endedSnapshot'){v.markTradeExited(s,r.id,'UNKNOWN',T,true);e.payload.htmlEndedAtAtRecording=T;e.payload.timing='post_close_review';}
  if(defect==='missingEntrySnapshot')e.payload.htmlEnteredAtAtRecording=null;if(defect==='timing')e.payload.timing='post_close_review';if(defect==='extra')e.payload.extra=true;
  if(defect==='recordId')e.payload.recordId='other';if(defect==='eventId')e.id='other';if(defect==='sequence')r.researchCapture.eventSequence=99;
  if(['duplicateSwitch','duplicateSubmission'].includes(defect)){const clone=structuredClone(e);clone.id=`${r.id}:manual-2`;if(defect==='duplicateSwitch')clone.payload.submissionId='second';r.researchCapture.manualEvents.push(clone);r.researchCapture.eventSequence++;}
  if(defect==='source')e.source='broker';if(defect==='effectiveAt')e.effectiveAt=T-1;if(defect==='oldBOF')e.type='BOF_TO_PB_RECORDED';
  assert.throws(()=>v.assertV6State(s));const before=structuredClone(s);assert.throws(()=>v.changeBias(s,'GC','bullish'));assert.deepEqual(s,before);
});
for(const legacy of ['mtf_bof','htf_bof','htf_pb'])test(`F02: legacy ${legacy} keeps old BOF/PB switch and canonical revert reference amid decisions`,()=>{
  const {s,r}=active();r.type=legacy;v.assertV6State(s);v.recordEntryExpectation(s,r.id,content('旧'),'entry',T);v.recordInitialStop(s,r.id,90,T);v.recordBofToPb(s,r.id,T);v.updateHoldingExpectation(s,r.id,'met','','holding',T);v.revertBofToPb(s,r.id,T);
  assert.equal(r.type,legacy);assert.equal(r.researchCapture.manualEvents[4].payload.revertedEventId,r.researchCapture.manualEvents[2].id);unchanged(s,()=>v.switchBofManagement(s,r.id,'SPB','new',T),'V6_MANAGEMENT_SWITCH_FORBIDDEN');
});
function memory(raw=null) {const data=new Map(raw===null?[]:[[UNIFIED_KEY,raw]]);return {data,getItem:k=>data.get(k)??null,setItem:(k,value)=>data.set(k,value),removeItem:k=>data.delete(k)};}
function convertedResearchFixture(target) {
  const f=workbenchFixture(),s=v.migrateV5ToV6(f.state,{migratedAt:UI_T}).state,r=s.records.find(r=>r.id===f.ids.ES1),end=r.endedAt;
  r.type='bof';r.endedAt=null;r.reason=null;r.exitCapture=null;r.stages.at(-1).end=null;r.researchCapture={eventSequence:0,manualEvents:[]};v.assertV6State(s);
  v.recordInitialStop(s,r.id,90,r.enteredAt);v.switchBofManagement(s,r.id,target,'switch',r.enteredAt+1);v.markTradeExited(s,r.id,'UNKNOWN',end,true);return {f,s,r};
}
for(const target of ['SPB','CPB'])test(`Research: converted bof/${target} preserves Manual Decision Truth; complete inputs cannot grant strategy eligibility`,()=>{
  const {f,s,r}=convertedResearchFixture(target),c=createWorkbenchController({getIntraday:()=>s,storage:memory()});for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));c.select(r.id);c.setReplaySettings(r.id,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});
  const t=c.snapshot().selected;assert.equal(t.originalSetup,'bof');assert.equal(t.currentManagement,target);assert.equal(t.researchSetupClass,null);assert.equal(t.researchClassificationStatus,'PENDING_HUMAN_REVIEW');assert.equal(t.strategyComparisonEligible,false);assert.equal(t.replayStatus,'SETUP_CLASSIFICATION_PENDING');assert.deepEqual(t.replays,[]);
  assert.deepEqual(t.manualDecisionTruth.manualEvents,r.researchCapture.manualEvents);assert.ok(t.manualEvents.some(e=>e.type==='BOF_MANAGEMENT_SWITCH_RECORDED'));assert.ok(adapter.replayCompatibleInput(t).manualEvents.every(e=>e.type!=='BOF_MANAGEMENT_SWITCH_RECORDED'));
});
test('Research: overlap stays blocked after a new management switch, even with manual matching decisions',()=>{
  const {f,s,r}=convertedResearchFixture('CPB'),overlap=structuredClone(r);overlap.id+='-overlap';overlap.researchCapture={eventSequence:0,manualEvents:[]};s.records.push(overlap);v.assertV6State(s);
  const c=createWorkbenchController({getIntraday:()=>s,storage:memory()});for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);
  c.decide('confirm',r.id,c.snapshot().logicalTrades[0].logicalTradeId);c.select(r.id);const t=c.snapshot().selected;
  assert.equal(t.matchingStatus,'NO_MATCH');assert.equal(t.qualityStatus,'BLOCKED');assert.ok(t.qualityReasons.includes('V6_OVERLAP_EXECUTION_UNSUPPORTED'));assert.equal(t.strategyComparisonEligible,false);assert.equal(t.actualEntryPrice,null);
});
for(const failure of ['CAS','quota','readback'])test(`New management save ${failure} never reports success or drops prior history`,()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('保全'),'e',T);const u=makeUnified(makeEnvelope(s,T)),raw=JSON.stringify(u),store=memory(raw);v.switchBofManagement(s,r.id,'SPB','switch',T);const next=structuredClone(u);next.sections.intraday=makeEnvelope(s,T);
  if(failure==='CAS')store.data.set(UNIFIED_KEY,'external');if(failure==='quota')store.setItem=()=>{throw new Error('quota');};
  if(failure==='readback'){const get=store.getItem,set=store.setItem;let written=false;store.setItem=(k,value)=>{set(k,value);written=true;};store.getItem=k=>{if(k===UNIFIED_KEY&&written){written=false;return 'mismatch';}return get(k);};}
  assert.throws(()=>commitUnified(store,next,{expectedRaw:raw}));assert.equal(store.data.get(UNIFIED_KEY),failure==='CAS'?'external':raw);
});
test('Recovery: independent research store exports/imports actual manual decisions, settings and new filters',()=>{
  const {f,s,r}=convertedResearchFixture('CPB'),storage=memory(),c=createWorkbenchController({getIntraday:()=>s,storage});c.importFile('fills',f.fills);c.confirmFlat(true);c.decide('reject',r.id,c.snapshot().logicalTrades[0].logicalTradeId);c.filters({setup:'SETUP_BOF'});c.setReplaySettings(r.id,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});const backup=c.exportStore();
  const restored=createWorkbenchController({getIntraday:()=>s,storage:memory()});restored.importStore(backup);assert.deepEqual(restored.store,c.store);assert.equal(restored.store.manualDecisions.length,1);assert.equal(restored.store.preferences.setup,'SETUP_BOF');
});
test('Recovery: original candidate fails closed on the new event; old data still reads without mutation',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'v6-rollback-check-'));
  try {
    execFileSync('tar',['-x','-C',directory],{input:execFileSync('git',['archive','eb80e9ace0784a40beacef2e870e6e821b026f58'],{maxBuffer:64*1024*1024})});
    const old=await import(pathToFileURL(join(directory,'src/capture-unified.js'))),{s,r}=active();const before=JSON.stringify(makeUnified(makeEnvelope(s,T))),valid=memory(before);
    assert.equal(old.loadUnified(valid).source,'canonical');assert.equal(valid.getItem(UNIFIED_KEY),before);
    v.switchBofManagement(s,r.id,'SPB','switch',T);const raw=JSON.stringify(makeUnified(makeEnvelope(s,T))),store=memory(raw);
    assert.equal(old.loadUnified(store).source,'recovery-required');assert.equal(store.getItem(UNIFIED_KEY),raw);assert.equal(loadUnified(store).source,'canonical');assert.equal(store.getItem(UNIFIED_KEY),raw);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
test('Archive search accepts the displayed historical Setup name without changing stored facts',()=>{
  const {s,r}=active();r.type='mtf_bof';v.markTradeExited(s,r.id,'UNKNOWN',T,true);const before=structuredClone(s);
  assert.deepEqual(v.archivedRecords(s,'MTF BOF'),[r]);assert.deepEqual(s,before);
});
test('Recovery: production Base reads legacy V6 and fails closed on expectation additions without rewriting raw',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'v6-production-base-check-'));
  try {
    execFileSync('tar',['-x','-C',directory],{input:execFileSync('git',['archive','ef54f29e48d1de7e2f7a87840a6f0aa3cd2df72e'],{maxBuffer:64*1024*1024})});
    const old=await import(pathToFileURL(join(directory,'src/capture-unified.js'))),{s,r}=active();r.type='mtf_bof';r.structure3mAtRegistration='trend_pullback_weaker';s.cards.GC.structure3m='trend_pullback_weaker';v.assertV6State(s);
    const prior=JSON.stringify(makeUnified(makeEnvelope(s,T))),valid=memory(prior);assert.equal(old.loadUnified(valid).source,'canonical');assert.equal(valid.getItem(UNIFIED_KEY),prior);
    v.recordEntryExpectation(s,r.id,content('新增'),'e',T);const raw=JSON.stringify(makeUnified(makeEnvelope(s,T))),store=memory(raw);assert.equal(old.loadUnified(store).source,'recovery-required');assert.equal(store.getItem(UNIFIED_KEY),raw);assert.equal(loadUnified(store).source,'canonical');
  } finally {rmSync(directory,{recursive:true,force:true});}
});
