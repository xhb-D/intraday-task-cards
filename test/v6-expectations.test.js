import test from 'node:test';
import assert from 'node:assert/strict';
import { intradayV6 as v } from '../src/intraday-v6/index.js';
import { HTF_STRUCTURES_V2, HTF_STRUCTURES_V3, CREATABLE_SETUPS, SETUP_LABELS } from '../src/model.js';
import { captureUi } from '../src/capture-ui.js';
import { makeEnvelope, serialize, deserialize, exportMarkdown } from '../src/capture-persistence.js';
import { makeUnified, normalizeImport, loadUnified, commitUnified, UNIFIED_KEY } from '../src/capture-unified.js';
import { weeklyDecisionReview, decisionReviewCsv, replayCompatibleInput } from '../src/exit-research/ui/capture-adapter.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { clampExpectationPosition, loadExpectationPosition, saveExpectationPosition, EXPECTATION_PANEL_POSITION_KEY } from '../src/expectation-panel.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { parseCsv } from '../src/exit-research/csv.js';
const T = 1750000000000;
const content = path => ({ path, keyLevels:'', focus:'' });
function ready() { const s=v.createWorkspace(T);v.changeStructure(s,'GC','breakout_strong_pullback_weak');v.changeDirection(s,'GC','long',T+1);return s; }
function pending(s=ready(),type='spb',at=T+2) {return {s,r:v.chooseSetup(s,'GC',type,at).opportunity};}
function active() {const {s,r}=pending();v.markEntered(s,r.id,T+5,true);return {s,r};}
function rejects(s,fn,code) {const before=structuredClone(s);assert.throws(fn,code?{code}:undefined);assert.deepEqual(s,before);v.assertV6State(s);}
function memory(raw=null,hook=()=>{}) { const data=new Map(raw===null?[]:[[UNIFIED_KEY,raw]]);return {data,getItem(k){const result=hook('get',k,data);return result===undefined?(data.get(k)??null):result;},setItem(k,value){hook('set',k,data);data.set(k,value);},removeItem(k){data.delete(k);}}; }

test('V3 bias and Setup identities are independent, ordered and exactly specified',()=>{
  assert.deepEqual(Object.keys(HTF_STRUCTURES_V3),['breakout_strong_pullback_weak','breakout_weak_pullback_strong','htf_range_v2']);
  assert.deepEqual(Object.values(HTF_STRUCTURES_V3),['突破强&回调弱','突破弱&回调强','震荡']);
  assert.equal(HTF_STRUCTURES_V2.trend_pullback_stronger,'趋势（回调变强）');
  assert.deepEqual(Object.keys(CREATABLE_SETUPS),['spb','cpb','bof']);
  assert.deepEqual(Object.values(CREATABLE_SETUPS),['SPB（观察结构背离、rsi、PD array）','CPB（做多等收敛 做空等扫高）','BOF（行为是真突破 预期会失败）']);
});
for (const key of Object.keys(HTF_STRUCTURES_V3)) for(const type of Object.keys(CREATABLE_SETUPS)) test(`new ${key}/${type} freezes exact snapshot and permits repeated same-direction trades`,()=>{
  const s=ready();v.changeStructure(s,'GC',key);const a=pending(s,type).r;v.markEntered(s,a.id,T+3,true);const saved=structuredClone(a),b=pending(s,type,T+4).r;
  assert.notEqual(a.id,b.id);assert.equal(a.type,type);assert.equal(a.structure3mAtRegistration,key);v.markEntered(s,b.id,T+5,true);assert.deepEqual(a,saved);assert.equal(v.activeTradesForSymbol(s,'GC').length,2);
  assert.equal(v.entryExpectation(a),null);assert.equal(v.currentHoldingExpectation(a),null);
  rejects(s,()=>v.recordBofToPb(s,a.id,T+6),'V6_RESEARCH_CLASS_PENDING');
});
for(const type of ['mtf_pb','mtf_bof','htf_pb','htf_bof','pullback','range','reversal']) test(`old Setup ${type} cannot be newly created`,()=>{const s=ready();rejects(s,()=>v.chooseSetup(s,'GC',type,T+2),'V6_SETUP_INVALID');});
for(const key of ['trend_pullback_stronger','trend_pullback_weaker','bullish','bearish','range']) test(`old bias ${key} remains readable but new registration requires explicit review`,()=>{
  const {s,r}=pending();s.cards.GC.structure3m=key;v.assertV6State(s);const before=structuredClone(s);
  assert.equal(v.chooseSetup(s,'GC','cpb',T+3).changed,false);assert.deepEqual(s,before);v.markEntered(s,r.id,T+4,true);v.recordInitialStop(s,r.id,90,T+5);v.markTradeExited(s,r.id,'UNKNOWN',T+6,true);
});
test('pending empty expectation never blocks entry; fields independently optional; immutable first save',()=>{
  const {s,r}=pending();rejects(s,()=>v.recordEntryExpectation(s,r.id,content('  '),'empty',T+3),'V6_EXPECTATION_INVALID');
  v.recordEntryExpectation(s,r.id,{path:'',keyLevels:'  目标 100  ',focus:''},'entry',T+3);
  const original=structuredClone(r.researchCapture.manualEvents[0]);v.markEntered(s,r.id,T+5,true);
  assert.equal(v.entryExpectation(r).original.payload.timing,'before_html_entry');assert.equal(v.entryExpectation(r).current.payload.content.keyLevels,'目标 100');
  rejects(s,()=>v.recordEntryExpectation(s,r.id,content('覆盖'),'other',T+6),'V6_EXPECTATION_ALREADY_RECORDED');
  v.correctEntryExpectation(s,r.id,content('更正 1'),'c1',T+6);v.correctEntryExpectation(s,r.id,content('更正 2'),'c2',T+7);
  assert.deepEqual(r.researchCapture.manualEvents[0],original);const last=v.entryExpectation(r).current;
  assert.equal(last.payload.originalEventId,original.id);assert.equal(last.payload.previousEventId,r.researchCapture.manualEvents[1].id);assert.deepEqual(last.payload.originalContent,original.payload.content);
});
test('HTML late recording and post-close recollection retain true recording times and basis',()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('补录'),'late',T+6);
  assert.equal(v.entryExpectation(r).original.payload.timing,'after_html_entry');assert.equal(v.entryExpectation(r).original.payload.htmlEnteredAtAtRecording,T+5);
  v.markTradeExited(s,r.id,'OTHER_EXIT',T+7,true);v.correctEntryExpectation(s,r.id,content('复盘'),'review',T+8);
  assert.equal(v.entryExpectation(r).current.payload.timing,'post_close_review');assert.equal(v.entryExpectation(r).current.recordedAt,T+8);
  const second=active();v.markTradeExited(second.s,second.r.id,'UNKNOWN',T+7,true);v.recordEntryExpectation(second.s,second.r.id,content('首次复盘'),'review',T+8);
  assert.equal(v.entryExpectation(second.r).original.payload.timing,'post_close_review');
});
test('equal millisecond entry/exit transitions preserve truthful immutable snapshots',()=>{
  const {s,r}=pending();v.recordEntryExpectation(s,r.id,content('前'),'a',T+3);v.markEntered(s,r.id,T+3,true);v.updateHoldingExpectation(s,r.id,'met','','b',T+4);v.markTradeExited(s,r.id,'UNKNOWN',T+4,true);v.assertV6State(s);
  assert.equal(v.entryExpectation(r).original.payload.htmlEnteredAtAtRecording,null);assert.equal(v.currentHoldingExpectation(r).payload.htmlEndedAtAtRecording,null);
});
for(const status of Object.keys(v.HOLDING_EXPECTATION_STATES)) test(`holding ${status}: no auto event, optional reason and repeated state appends independently`,()=>{
  const {s,r}=active();assert.equal(v.currentHoldingExpectation(r),null);v.updateHoldingExpectation(s,r.id,status,'','one',T+6);v.updateHoldingExpectation(s,r.id,status,'  再观察  ','two',T+7);
  assert.equal(v.holdingExpectationHistory(r).length,2);assert.equal(v.currentHoldingExpectation(r).payload.reason,'再观察');v.markTradeExited(s,r.id,'UNKNOWN',T+8,true);
  rejects(s,()=>v.updateHoldingExpectation(s,r.id,status,'','three',T+9),'V6_ACTIVE_TRADE_REQUIRED');
});
test('holding pending, unknown status, oversized fields and time inversion reject without partial changes',()=>{
  const {s,r}=pending();rejects(s,()=>v.updateHoldingExpectation(s,r.id,'met','','hold',T+3),'V6_ACTIVE_TRADE_REQUIRED');
  rejects(s,()=>v.recordEntryExpectation(s,r.id,content('中'.repeat(201)),'long',T+3),'V6_EXPECTATION_INVALID');
  v.recordEntryExpectation(s,r.id,content('🙂'.repeat(200)),'emoji',T+3);v.markEntered(s,r.id,T+5,true);
  rejects(s,()=>v.updateHoldingExpectation(s,r.id,'invalidated','','bad',T+6),'V6_EXPECTATION_INVALID');
  rejects(s,()=>v.updateHoldingExpectation(s,r.id,'met','中'.repeat(201),'long',T+6),'V6_EXPECTATION_INVALID');
  rejects(s,()=>v.correctEntryExpectation(s,r.id,content('倒填'),'backdate',T+2),'V6_TIME_INVALID');
});
test('A/B isolation and duplicate submission protect every record independently',()=>{
  const {s,r:a}=active(),b=pending(s,'spb',T+6).r;v.markEntered(s,b.id,T+7,true);const beforeA=structuredClone(a);
  v.recordEntryExpectation(s,b.id,content('B'),'same-token',T+8);v.updateHoldingExpectation(s,b.id,'underperformed','','h',T+9);assert.deepEqual(a,beforeA);
  const before=structuredClone(s),revision=s.revision;assert.equal(v.recordEntryExpectation(s,b.id,content('B'),'same-token',T+10).reason,'duplicate');assert.deepEqual(s,before);assert.equal(s.revision,revision);
  rejects(s,()=>v.correctEntryExpectation(s,b.id,content('conflict'),'same-token',T+10),'V6_SUBMISSION_CONFLICT');
  v.recordEntryExpectation(s,a.id,content('A'),'same-token',T+10);assert.equal(a.researchCapture.manualEvents.length,1);assert.equal(b.researchCapture.manualEvents.length,2);
});
test('legacy mixed stop/BOF lifecycle retains canonical bytes and references',()=>{
  const {s,r}=active();r.type='mtf_bof';r.structure3mAtRegistration='trend_pullback_weaker';v.assertV6State(s);
  v.recordInitialStop(s,r.id,90,T+6);v.recordEntryExpectation(s,r.id,content('旧交易'),'entry',T+7);v.recordBofToPb(s,r.id,T+8);v.updateHoldingExpectation(s,r.id,'met','','h',T+9);
  const before=structuredClone(r.researchCapture.manualEvents);v.revertBofToPb(s,r.id,T+10);v.correctInitialStop(s,r.id,89,T+11);
  assert.deepEqual(r.researchCapture.manualEvents.slice(0,4),before);assert.equal(r.researchCapture.manualEvents[4].payload.revertedEventId,before[2].id);assert.equal(v.entryExpectation(r).original.payload.content.path,'旧交易');
  assert.equal(r.type,'mtf_bof');assert.equal(r.structure3mAtRegistration,'trend_pullback_weaker');
});
test('legacy projection cannot turn an invalid canonical BOF reference into a valid compact alias',()=>{
  const {s,r}=active();r.type='mtf_bof';v.recordInitialStop(s,r.id,90,T+6);v.recordEntryExpectation(s,r.id,content('夹杂'),'e',T+7);v.recordBofToPb(s,r.id,T+8);v.revertBofToPb(s,r.id,T+9);
  r.researchCapture.manualEvents.at(-1).payload.revertedEventId=r.researchCapture.manualEvents[1].id;
  assert.throws(()=>v.assertV6State(s));
});
for(const defect of ['unknownType','eventId','recordId','sequence','source','time','submission','correctionRef','originalContent','timing','futureSnapshot','extraPayload']) test(`strict event validator rejects ${defect}`,()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('A'),'e',T+6);v.correctEntryExpectation(s,r.id,content('B'),'c',T+7);const original=structuredClone(s),e=r.researchCapture.manualEvents[1];
  if(defect==='unknownType')e.type='OTHER';if(defect==='eventId')e.id='wrong';if(defect==='recordId')e.payload.recordId='wrong';if(defect==='sequence')r.researchCapture.eventSequence=4;
  if(defect==='source')e.source='market';if(defect==='time')e.recordedAt=T+4;if(defect==='submission')e.payload.submissionId='e';if(defect==='correctionRef')e.payload.previousEventId='wrong';
  if(defect==='originalContent')e.payload.originalContent.path='tamper';if(defect==='timing')e.payload.timing='before_html_entry';if(defect==='futureSnapshot')e.payload.htmlEnteredAtAtRecording=T+8;if(defect==='extraPayload')e.payload.extra=true;
  assert.throws(()=>v.assertV6State(s));assert.deepEqual(original.records[0].researchCapture.manualEvents[0].payload.content,content('A'));
});
test('V6 JSON, Unified export/import/startup and Markdown/CSV recover full Manual Decision Truth',()=>{
  const {s,r}=pending();v.recordEntryExpectation(s,r.id,content('目标 | 100\n关键位置'),'a',T+3);v.markEntered(s,r.id,T+4,true);v.recordInitialStop(s,r.id,90,T+5);v.correctEntryExpectation(s,r.id,content('更正'),'c',T+6);v.updateHoldingExpectation(s,r.id,'underperformed','原因','h',T+7);v.markTradeExited(s,r.id,'UNKNOWN',T+8,true);
  assert.deepEqual(deserialize(serialize(s,T+9)).state,s);const u=makeUnified(makeEnvelope(s,T+9)),raw=JSON.stringify(u),preview=normalizeImport(JSON.parse(raw),makeUnified());assert.deepEqual(preview.state,u);
  const store=memory(raw);assert.deepEqual(loadUnified(store).state,u);const saved=commitUnified(store,u,{expectedRaw:raw,preImport:true});assert.deepEqual(saved.sections.intraday.state.records,s.records);
  const md=exportMarkdown(s,'all',T+10),csv=decisionReviewCsv(s),review=weeklyDecisionReview(s);assert.ok(md.includes('ENTRY_EXPECTATION_CORRECTED'));assert.ok(md.includes('manual-4'));assert.ok(csv.includes('PENDING_HUMAN_REVIEW'));assert.ok(csv.includes('HOLDING_EXPECTATION_UPDATED'));assert.equal(review[0].manualEvents.length,4);assert.equal(review[0].timeBasis,'HTML_CONFIRMATION_NOT_BROKER_FILL');
  const parsed=parseCsv(csv);assert.deepEqual(JSON.parse(parsed.rows[0].values[7]),r.researchCapture.manualEvents);assert.deepEqual(JSON.parse(parsed.rows[0].values[5]),v.entryExpectation(r).versions);
});
for(const failure of ['CAS','quota','readback'])test(`expectation Unified commit ${failure} never reports success or drops original events`,()=>{
  const {s,r}=active(),u=makeUnified(makeEnvelope(s,T+9)),raw=JSON.stringify(u);v.recordEntryExpectation(s,r.id,content('draft'),'a',T+10);const candidate=structuredClone(u);candidate.sections.intraday=makeEnvelope(s,T+10);let written=false;
  const store=memory(raw,(op,key)=>{if(key!==UNIFIED_KEY)return;if(failure==='quota'&&op==='set')throw new Error('quota');if(failure==='readback'&&op==='set')written=true;if(failure==='readback'&&op==='get'&&written){written=false;return 'bad';}});
  if(failure==='CAS')store.data.set(UNIFIED_KEY,'external');assert.throws(()=>commitUnified(store,candidate,{expectedRaw:raw}));assert.equal(store.data.get(UNIFIED_KEY),failure==='CAS'?'external':raw);
});
test('new Setup research identity survives matching, raw filters and explicit policy comparison gate',()=>{
  const f=workbenchFixture();const state=v.migrateV5ToV6(f.state,{migratedAt:UI_T}).state;
  for(const type of ['spb','cpb','bof']){
    const input=structuredClone(state),r=input.records.find(r=>r.id===f.ids.ES1);r.type=type;r.researchCapture={eventSequence:0,manualEvents:[]};v.assertV6State(input);const data=new Map();const c=createWorkbenchController({getIntraday:()=>input,storage:{getItem:k=>data.get(k)??null,setItem:(k,val)=>data.set(k,val)}});
    for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));c.select(r.id);let t=c.snapshot().selected;
    assert.equal(t.originalSetup,type);assert.equal(t.researchSetupClass,null);assert.equal(t.researchClassificationStatus,'PENDING_HUMAN_REVIEW');assert.equal(t.strategyComparisonEligible,false);assert.equal(t.replayStatus,'SETUP_CLASSIFICATION_PENDING');assert.deepEqual(t.replays,[]);
    c.filters({setup:type==='bof'?'SETUP_BOF':type.toUpperCase()});assert.ok(c.snapshot().visibleTrades.every(t=>t.originalSetup===type));
  }
});
test('legacy Replay results stay identical with mixed decisions; full research events remain exported',()=>{
  const f=workbenchFixture(),s=v.migrateV5ToV6(f.state,{migratedAt:UI_T}).state,outputs=[];
  for(const withDecisions of [false,true]){
    const input=structuredClone(s),r=input.records.find(r=>r.id===f.ids.ES1);
    if(withDecisions)v.recordEntryExpectation(input,r.id,content('复盘补写'),'e',r.endedAt+1);
    const c=createWorkbenchController({getIntraday:()=>input,storage:memory()});for(const k of ['fills','orders','positions'])c.importFile(k,f[k]);c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));c.select(r.id);c.setReplaySettings(r.id,{replayHardEndAt:UI_T+3600000+4*UI_P,executionTickSize:.1});
    const t=c.snapshot().selected;outputs.push({metrics:t.metrics,replays:t.replays});if(withDecisions){assert.ok(t.manualEvents.some(e=>e.type==='ENTRY_EXPECTATION_RECORDED'));assert.ok(!replayCompatibleInput(t).manualEvents.some(e=>e.type==='ENTRY_EXPECTATION_RECORDED'));}
  }
  assert.deepEqual(outputs[1],outputs[0]);assert.ok(outputs[0].replays.length>0);
});
test('position preferences clamp/resume/reset independently of canonical facts',()=>{
  const store=memory();assert.equal(loadExpectationPosition(store),null);saveExpectationPosition(store,{x:800,y:600});assert.deepEqual(loadExpectationPosition(store),{x:800,y:600});
  assert.deepEqual(clampExpectationPosition({x:9000,y:-20},{width:800,height:600},{width:480,height:500}),{x:312,y:8});
  assert.deepEqual(clampExpectationPosition(null,{width:400,height:300},{width:480,height:500}),{x:8,y:8});assert.equal(store.getItem(UNIFIED_KEY),null);assert.ok(store.data.has(EXPECTATION_PANEL_POSITION_KEY));
});
test('per-record summaries escape user text and preserve exact Setup button order',()=>{
  const {s,r}=active();v.recordEntryExpectation(s,r.id,content('<script>'),'e',T+6);v.updateHoldingExpectation(s,r.id,'underperformed','<img src=x>','h',T+7);const html=captureUi.renderCard(s,'GC');
  assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(!html.includes('<img src=x>'));assert.ok(html.includes('当前预期：不及预期'));assert.ok(html.includes('查看跟踪历史 · 1条'));
  const values=[...html.matchAll(/data-action="setup"[^>]*data-value="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(values,['spb','cpb','bof']);assert.ok(html.includes(SETUP_LABELS.spb));
});
