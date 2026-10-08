import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { intradayV6 as v6 } from '../src/intraday-v6/index.js';
import { makeEnvelope, deserialize, serialize, migrateEnvelope, exportMarkdown } from '../src/capture-persistence.js';
import { makeUnified, validateUnified, loadUnified, migrateUnified, normalizeImport, commitUnified, UNIFIED_KEY, PRE_UPGRADE_KEY, PRE_IMPORT_KEY } from '../src/capture-unified.js';
import { makeEnvelope as legacyEnvelope } from '../src/persistence.js';
import { makeUnified as legacyUnified } from '../src/unified-persistence.js';
import { captureUi } from '../src/capture-ui.js';
import { T, pair, v5Active, ready, addTrade } from './fixtures/intraday-v6.js';
import { captureResearchInput } from '../src/exit-research/ui/capture-adapter.js';
import { buildWorkbenchModel } from '../src/exit-research/ui/view-model.js';
import { createWorkbenchStore } from '../src/exit-research/ui/store.js';
import { workbenchFixture } from './fixtures/exit-research-ui.js';
import { parseTradovateFillsCsv as parseFillsCsv, parseTradovateOrdersCsv as parseOrdersCsv, parseTradovatePositionHistoryCsv as parsePositionHistoryCsv } from '../src/exit-research/tradovate-csv.js';

const rawV5 = state => JSON.stringify(legacyUnified(legacyEnvelope(state,T+100)));
function memory(raw = null, hook = () => {}) {
  const data = new Map(raw === null ? [] : [[UNIFIED_KEY,raw]]);
  return { data, getItem(key) { return hook('get',key,data.get(key) ?? null,data) ?? data.get(key) ?? null; }, setItem(key,value) { hook('set',key,value,data); data.set(key,String(value)); }, removeItem(key) { data.delete(key); } };
}
function bundleHarness(state = v6.createWorkspace(0), { raw, backing, quota = false } = {}) {
  const storage = backing || memory(raw ?? JSON.stringify(makeUnified(makeEnvelope(state,T+100))));
  const elements = new Map(), listeners = new Map(), errors = [];
  const element = () => ({ hidden:true,disabled:false,inert:false,textContent:'',innerHTML:'',value:'',dataset:{},options:[],children:[],style:{setProperty(){}},classList:{add(){},toggle(){}}, listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},querySelector(){return element();},querySelectorAll(){return [];},setAttribute(){},add(child){this.options.push(child);},appendChild(child){this.children.push(child);return child;},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},focus(){},showModal(){this.open=true;},close(){this.open=false;} });
  const document = { querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},getElementById(id){return this.querySelector('#'+id);},querySelectorAll(){return [];},createElement:element };
  const context = { document,localStorage:storage,window:{addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);}},console:{error(...args){errors.push(args);}},setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){},Option:function(text,value){return {text,value};},Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},TextEncoder,Intl,Date };
  vm.runInNewContext('function structuredClone(value) { return JSON.parse(JSON.stringify(value)); }\n'+readFileSync(new URL('../dist/app.bundle.js',import.meta.url),'utf8'),context);
  const click = (action,id=null,value=null,symbol='GC') => document.querySelector('#cards').listeners.click({detail:1,target:{closest:()=>({disabled:false,dataset:{action,opportunityId:id,value,symbol}})}});
  const submit = (id,value) => document.querySelector('#cards').listeners.submit({target:{closest:()=>({dataset:{stopForm:id},querySelector:()=>({value})})},preventDefault(){}});
  const confirm = kind => { document.querySelector('input[name="exit-kind"]:checked').value=kind; document.querySelector('#dialog-confirm').listeners.click(); };
  return {storage,document,errors,click,submit,confirm,cancel:()=>document.querySelector('#dialog-cancel').listeners.click(),saved:()=>JSON.parse(storage.getItem(UNIFIED_KEY)),html:()=>document.querySelector('#cards').innerHTML,history:()=>document.querySelector('#history-body').innerHTML,raw:()=>storage.getItem(UNIFIED_KEY)};
}

test('M2 production: frozen M1 artifacts retain exact bytes and old UI assertions',()=>{
  const bytes=readFileSync(new URL('./fixtures/frozen-m1/app.bundle.txt',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'7372cfb300effc6d5283683b610675900fdd87f133e756203d2cd26176ac2a6c');
  const manifest=JSON.parse(readFileSync(new URL('./fixtures/frozen-m1/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.base,'b6cc7e8eba910b224f4fb3c98535e308e44fcc16');
  for(const [file,hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/frozen-m1/'+file,import.meta.url))).digest('hex'),hash);
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(app,/intradayV6\.createWorkspace/);assert.doesNotMatch(app,/card\.opportunity|stateOf\(/);
  const build=readFileSync(new URL('../scripts/build.mjs',import.meta.url),'utf8');
  assert.match(build,/capture-persistence/);assert.doesNotMatch(build,/'src\/persistence.js'|'src\/unified-persistence.js'|'src\/startup.js'/);
});

test('M2 persistence: only V6 writes, strict reload preserves 2 active plus pending',()=>{
  const {state}=pair();v6.chooseSetup(state,'GC','mtf_pb',T+30);
  const value=deserialize(serialize(state,T+40));assert.deepEqual(value.state,state);assert.equal(value.schemaVersion,6);
  const store=memory(),saved=commitUnified(store,makeUnified(makeEnvelope(state,T+40)),{expectedRaw:null});
  const boot=loadUnified(store);assert.deepEqual(boot.state,saved);v6.assertV6State(boot.state.sections.intraday.state);
  assert.equal(v6.activeTradesForSymbol(boot.state.sections.intraday.state,'GC').length,2);assert.ok(v6.activeOpportunityForSymbol(boot.state.sections.intraday.state,'GC'));
});
for(const stage of ['wait','signal','position'])test(`M2 startup: V5 ${stage} snapshot backed up before V6 readback`,()=>{
  const raw=rawV5(v5Active(stage)),store=memory(raw),boot=loadUnified(store,{migratedAt:T+200});
  assert.equal(boot.source,'canonical-migrated');assert.equal(store.getItem(PRE_UPGRADE_KEY),raw);assert.equal(boot.state.schemaVersion,2);assert.equal(boot.state.sections.intraday.schemaVersion,6);validateUnified(boot.state);
  assert.deepEqual(boot.state.sections.riskManager,JSON.parse(raw).sections.riskManager);assert.deepEqual(boot.state.sections.chime,JSON.parse(raw).sections.chime);
  assert.deepEqual(boot.state.sections.intraday.state.records[0].researchCapture,JSON.parse(raw).sections.intraday.state.records[0].researchCapture);
});
test('M2 startup: active record recovery is audited without renumbering',()=>{const state=v5Active();const id=state.cards.GC.opportunity.id;state.records=[];const boot=loadUnified(memory(rawV5(state)),{migratedAt:T+200});assert.equal(boot.state.sections.intraday.state.records[0].id,id);assert.equal(boot.state.sections.intraday.state.migrationAudit[0].code,'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD');});
for(const defect of ['conflict','zoneDraft','timeline','secondTruth'])test(`M2 startup: ${defect} blocks without raw modification`,()=>{
  const state=v5Active();
  if(defect==='conflict')state.records[0].zone='conflict';
  if(defect==='zoneDraft')state.cards.GC.opportunity.zoneDraft='unconfirmed';
  if(defect==='timeline'){state.cards.GC.opportunity.enteredAt=T+2;state.records[0].enteredAt=T+2;}
  if(defect==='secondTruth')state.cards.GC.activeTrades=[];
  const raw=rawV5Unchecked(state),store=memory(raw),boot=loadUnified(store,{migratedAt:T+200});assert.equal(boot.source,'recovery-required');assert.equal(boot.state,null);assert.equal(store.getItem(UNIFIED_KEY),raw);assert.equal(store.getItem(PRE_UPGRADE_KEY),null);
});
function rawV5Unchecked(state){const base=legacyUnified(legacyEnvelope(v5Active(),T+100));base.sections.intraday.state=state;return JSON.stringify(base);}
for(const failure of ['snapshotQuota','snapshotReadback','canonicalQuota','canonicalReadback','CAS'])test(`M2 migration transaction: ${failure} never returns migrated memory`,()=>{
  const raw=rawV5(v5Active());let canonicalWritten=false;
  const store=memory(raw,(op,key,value,data)=>{
    if(failure==='snapshotQuota'&&op==='set'&&key===PRE_UPGRADE_KEY)throw new Error('quota');
    if(failure==='snapshotReadback'&&op==='get'&&key===PRE_UPGRADE_KEY)return 'bad';
    if(failure==='canonicalQuota'&&op==='set'&&key===UNIFIED_KEY)throw new Error('quota');
    if(failure==='canonicalReadback'&&op==='set'&&key===UNIFIED_KEY)canonicalWritten=true;
    if(failure==='canonicalReadback'&&op==='get'&&key===UNIFIED_KEY&&canonicalWritten){canonicalWritten=false;return 'bad';}
    if(failure==='CAS'&&op==='get'&&key===PRE_UPGRADE_KEY)data.set(UNIFIED_KEY,'external');
  });
  const boot=loadUnified(store,{migratedAt:T+200});assert.equal(boot.source,'recovery-required');assert.equal(boot.state,null);assert.equal(store.data.get(UNIFIED_KEY),failure==='CAS'?'external':raw);
});
test('M2 import: V5 preview names both versions, V6 multi-record events and exits round-trip',()=>{
  const {state,a,b}=pair();v6.recordInitialStop(state,a.id,90,T+30);v6.recordBofToPb(state,a.id,T+31);v6.markTradeExited(state,b.id,'STOP_EXIT',T+32,true);v6.chooseSetup(state,'GC','mtf_pb',T+33);
  const unified=makeUnified(makeEnvelope(state,T+34)),preview=normalizeImport(JSON.parse(rawV5(v5Active())),unified);
  assert.match(preview.summary,/旧版数据：V5；将升级为：V6/);
  const full=normalizeImport(JSON.parse(JSON.stringify(unified)),makeUnified());assert.deepEqual(full.state,unified);assert.equal(full.state.sections.intraday.state.records[1].exitCapture.kind,'STOP_EXIT');
  const store=memory(JSON.stringify(unified));commitUnified(store,full.state,{expectedRaw:JSON.stringify(unified),preImport:true});assert.equal(store.getItem(PRE_IMPORT_KEY),JSON.stringify(unified));
});
test('M2 Markdown: independent active records, stop events and manual-only timestamps',()=>{const {state,a,b}=pair();v6.recordInitialStop(state,a.id,90,T+30);v6.recordInitialStop(state,b.id,92,T+31);const md=exportMarkdown(state,'all',T+40);assert.equal((md.match(/持仓中/g)||[]).length,2);assert.match(md,/Initial Stop：90/);assert.match(md,/Initial Stop：92/);assert.doesNotMatch(md,/Actual Entry|实际成交时间/);});
test('M2 direct UI: two trades plus pending, unique per-ID controls and same Setup available',()=>{const {state,a,b}=pair();v6.chooseSetup(state,'GC','mtf_pb',T+30);const html=captureUi.renderCard(state,'GC',{stopEditors:new Map([[a.id,{draft:'90'}],[b.id,{draft:'92'}]])});assert.match(html,/当前持仓 · 2 笔/);assert.match(html,/跟随当前持仓/);assert.equal((html.match(/data-stop-form=/g)||[]).length,2);assert.equal(new Set([...html.matchAll(/ id="([^"]*)"/g)].map(m=>m[1])).size,7);assert.match(html,/新交易机会/);assert.equal((html.match(/data-action="direction"/g)||[]).length,0);assert.match(html,/计划管理/);assert.doesNotMatch(html,/STOP_EXIT|MANUAL_FLATTEN|card.opportunity/);});
test('M2 production UI: per-ID stop correction and BOF conversion isolate other trade',()=>{const {state,a,b}=pair(),h=bundleHarness(state);assert.deepEqual(h.errors,[]);h.click('stop-edit',a.id);h.submit(a.id,'90');h.click('stop-edit',b.id);h.submit(b.id,'92');h.click('stop-edit',a.id);h.submit(a.id,'89');h.click('bof-to-pb',a.id);let records=h.saved().sections.intraday.state.records;assert.equal(records[0].researchCapture.manualEvents.length,3);assert.equal(records[1].researchCapture.manualEvents.length,1);assert.equal(records[1].researchCapture.manualEvents[0].payload.stopPrice,92);h.click('bof-revert',a.id);records=h.saved().sections.intraday.state.records;assert.equal(records[0].researchCapture.manualEvents.at(-1).type,'BOF_TO_PB_REVERTED');assert.deepEqual(h.errors,[]);});
test('M2 production UI: invalid stop and cancel preserve canonical revision and state',()=>{const {state,a}=pair(),h=bundleHarness(state),raw=h.raw();h.click('stop-edit',a.id);h.submit(a.id,'-1');assert.equal(h.raw(),raw);h.click('stop-cancel',a.id);h.click('trade-exit',a.id);h.cancel();assert.equal(h.raw(),raw);});
test('M2 production UI: single stop exit affects B only, active history cannot delete',()=>{const {state,a,b}=pair(),h=bundleHarness(state);assert.equal((h.history().match(/data-delete/g)||[]).length,0);h.click('trade-exit',b.id);h.confirm('STOP_EXIT');const records=h.saved().sections.intraday.state.records;assert.equal(records[0].endedAt,null);assert.equal(records[1].exitCapture.kind,'STOP_EXIT');assert.equal((h.history().match(/data-delete/g)||[]).length,1);assert.match(h.html(),/当前持仓 · 1 笔/);assert.deepEqual(h.errors,[]);});
test('M2 production UI: flatten once closes captured trades and leaves pending alive',()=>{const {state}=pair(),pending=v6.chooseSetup(state,'GC','mtf_pb',T+30).opportunity,h=bundleHarness(state),revision=state.revision;h.click('flatten');h.confirm();const next=h.saved().sections.intraday.state;assert.equal(next.revision,revision+1);assert.equal(next.records[0].exitCapture.groupId,next.records[1].exitCapture.groupId);assert.equal(next.records[0].endedAt,next.records[1].endedAt);assert.equal(next.records.find(r=>r.id===pending.id).endedAt,null);assert.match(h.html(),/计划管理/);assert.deepEqual(h.errors,[]);});
test('M2 two tabs: stale flatten dialog cannot close trade B added in Tab A, even without storage event delivery',()=>{const state=ready();const a=addTrade(state);const storage=memory(JSON.stringify(makeUnified(makeEnvelope(state,T+50)))),tabA=bundleHarness(state,{backing:storage}),tabB=bundleHarness(state,{backing:storage});tabB.click('flatten');tabA.click('setup',null,'mtf_pb');let candidate=tabA.saved().sections.intraday.state.records.at(-1);tabA.click('entry',candidate.id);tabA.confirm();const raw=storage.getItem(UNIFIED_KEY);tabB.confirm();assert.equal(storage.getItem(UNIFIED_KEY),raw);assert.equal(v6.activeTradesForSymbol(JSON.parse(raw).sections.intraday.state,'GC').length,2);assert.equal(tabB.document.querySelector('#cards').inert,true);});
test('M2 production startup: blocked screen exposes raw export and hides fresh-start bypass',()=>{const state=v5Active();state.cards.GC.opportunity.zoneDraft='draft';const raw=rawV5Unchecked(state),h=bundleHarness(undefined,{raw});assert.match(h.html(),/旧版交易数据需要人工检查/);assert.match(h.html(),/导出原始数据/);assert.equal(h.document.querySelector('#start-fresh').hidden,true);assert.equal(h.raw(),raw);assert.deepEqual(h.errors,[]);});
test('M2 capture adapter: frozen input, overlap conservatively blocked, pending excluded',()=>{const {state}=pair();v6.chooseSetup(state,'GC','mtf_pb',T+30);const before=structuredClone(state),input=captureResearchInput(state);assert.equal(input.blocked.length,2);assert.equal(input.eligible.length,0);assert.deepEqual(state,before);const store=createWorkbenchStore();const model=buildWorkbenchModel({intraday:state,files:{},flatConfirmed:true,store});assert.equal(model.trades.length,2);for(const t of model.trades){assert.notEqual(t.matchingStatus,'MATCHED');assert.equal(t.qualityStatus,'BLOCKED');assert.equal(t.actualEntryTime,null);assert.deepEqual(t.candidates,[]);}assert.deepEqual(state,before);});
test('M2 Exit Research: nonoverlapping migrated V6 synthetic preserves frozen matching and canonical state',()=>{const f=workbenchFixture(),v6state=v6.migrateV5ToV6(f.state,{migratedAt:T}).state,before=structuredClone(v6state),store=createWorkbenchStore(),files={fills:parseFillsCsv(f.fills).rows,orders:parseOrdersCsv(f.orders).rows,positions:parsePositionHistoryCsv(f.positions).rows};const old=buildWorkbenchModel({intraday:f.state,files,flatConfirmed:true,store}),next=buildWorkbenchModel({intraday:v6state,files,flatConfirmed:true,store});assert.equal(next.captureVersion,6);assert.deepEqual({...next,captureVersion:5},old);assert.deepEqual(v6state,before);});
test('M2 Risk/Chime: capture actions change no other unified sections',()=>{const {state,a}=pair(),h=bundleHarness(state),before=h.saved();h.click('bof-to-pb',a.id);h.click('trade-exit',a.id);h.confirm('OTHER_EXIT');const next=h.saved();assert.deepEqual(next.sections.riskManager,before.sections.riskManager);assert.deepEqual(next.sections.chime,before.sections.chime);assert.deepEqual(next.preferences,before.preferences);assert.equal(next.schemaVersion,2);assert.doesNotMatch(JSON.stringify(next),/logicalTrades|marketBundle|fillId|holdingReference/);assert.deepEqual(h.errors,[]);});

test('M2 startup: V4 traverses original Research Capture migration before frozen V6',()=>{
  const state=v5Active();state.schemaVersion=4;for(const card of Object.values(state.cards))if(card.opportunity)delete card.opportunity.researchCapture;for(const record of state.records)delete record.researchCapture;
  const envelope={...legacyEnvelope(v5Active(),T+100),schemaVersion:4,state};const first=migrateEnvelope(envelope,T+200),second=migrateEnvelope(envelope,T+200);assert.deepEqual(first,second);assert.equal(first.envelope.state.schemaVersion,6);assert.deepEqual(first.envelope.state.records[0].researchCapture,{eventSequence:0,manualEvents:[]});assert.equal(first.envelope.state.records[0].id,state.records[0].id);
});
test('M2 startup: V3 original rules-upgrade history and audit survive V4 then V5 then V6',async()=>{
  const {goldenFixtures}=await import('./fixtures/compatibility/golden-fixtures.js');const envelope=structuredClone(goldenFixtures['unified-v1-active'].value.sections.intraday);const first=migrateEnvelope(envelope,T+200);assert.equal(first.envelope.state.schemaVersion,6);assert.ok(first.envelope.state.migrationAudit.length);assert.ok(first.envelope.state.records.some(record=>record.reason==='rules_upgrade'));assert.ok(first.envelope.state.records.filter(record=>record.reason==='rules_upgrade').every(record=>record.exitCapture===null));assert.deepEqual(migrateEnvelope(envelope,T+200),first);
});
test('M2 schema: migration clock required at envelope boundary and V5 writes rejected',()=>{assert.throws(()=>migrateEnvelope(legacyEnvelope(v5Active(),T+100)),e=>e.code==='MIGRATED_AT_REQUIRED');assert.throws(()=>makeEnvelope(v5Active(),T+100));assert.throws(()=>validateUnified(legacyUnified(legacyEnvelope(v5Active(),T+100))));});
test('M2 confirmation: default single exit UNKNOWN and cancel flatten leaves byte-identical raw',()=>{const {state,a}=pair(),h=bundleHarness(state),raw=h.raw();h.click('flatten');h.cancel();assert.equal(h.raw(),raw);h.click('trade-exit',a.id);h.confirm();assert.equal(h.saved().sections.intraday.state.records[0].exitCapture.kind,'UNKNOWN');assert.deepEqual(h.errors,[]);});
test('M2 history: forged active delete cannot bypass model gate',()=>{const {state,a}=pair(),h=bundleHarness(state),raw=h.raw();h.document.querySelector('#history-body').listeners.click({detail:1,target:{closest:()=>({dataset:{delete:a.id}})}});assert.equal(h.raw(),raw);assert.equal(h.errors.at(-1)[1].errorCode,'V6_ACTIVE_RECORD_DELETE_FORBIDDEN');});
test('M2 reload: real production bundle derives two active trades and pending solely from records',()=>{const {state}=pair();v6.chooseSetup(state,'GC','mtf_pb',T+30);const one=bundleHarness(state),two=bundleHarness(undefined,{raw:one.raw()});assert.match(two.html(),/当前持仓 · 2 笔/);assert.match(two.html(),/计划管理：<strong>PB/);assert.equal(Object.hasOwn(two.saved().sections.intraday.state.cards.GC,'opportunity'),false);assert.deepEqual(two.errors,[]);});
test('M2 production lifecycle: same Setup entry twice retains record IDs and background snapshots',()=>{const h=bundleHarness(ready());h.click('setup',null,'mtf_pb');let a=h.saved().sections.intraday.state.records.at(-1);h.click('entry',a.id);h.confirm();h.click('bias',null,'bullish');h.click('setup',null,'mtf_pb');let b=h.saved().sections.intraday.state.records.at(-1);assert.notEqual(a.id,b.id);h.click('stage',b.id,'signal');h.click('entry',b.id);h.confirm();const state=h.saved().sections.intraday.state;assert.equal(v6.activeTradesForSymbol(state,'GC').length,2);assert.equal(state.records[0].biasAtRegistration,'neutral');assert.equal(state.records[1].biasAtRegistration,'bullish');assert.deepEqual(h.errors,[]);});

test('M2 full backup: recovery audit, flatten groups, complete manual chains and multi-active reload all survive',()=>{
  const legacy=v5Active();legacy.records=[];const state=v6.migrateV5ToV6(legacy,{migratedAt:T+100}).state;
  addTrade(state,'mtf_bof',T+10);v6.markAllTradesExited(state,'GC',T+30,true);
  const a=addTrade(state,'mtf_bof',T+40),b=addTrade(state,'mtf_bof',T+50);
  v6.recordInitialStop(state,a.id,90,T+60);v6.correctInitialStop(state,a.id,89,T+61);v6.recordBofToPb(state,a.id,T+62);v6.revertBofToPb(state,a.id,T+63);v6.recordInitialStop(state,b.id,95,T+64);v6.chooseSetup(state,'GC','mtf_pb',T+70);
  const value=makeUnified(makeEnvelope(state,T+80)),restored=normalizeImport(JSON.parse(JSON.stringify(value)),makeUnified()).state;
  assert.deepEqual(restored,value);assert.equal(restored.sections.intraday.state.migrationAudit[0].code,'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD');assert.equal(restored.sections.intraday.state.records[0].exitCapture.groupId,restored.sections.intraday.state.records[1].exitCapture.groupId);
  const store=memory(JSON.stringify(restored)),reloaded=loadUnified(store).state.sections.intraday.state;assert.deepEqual(reloaded,state);assert.equal(v6.activeTradesForSymbol(reloaded,'GC').length,2);assert.ok(v6.activeOpportunityForSymbol(reloaded,'GC'));assert.equal(reloaded.records.find(r=>r.id===a.id).researchCapture.manualEvents.length,4);
});

test('M2 production preferences: hide/collapse never alter records or manual events',()=>{const {state,a}=pair();v6.recordInitialStop(state,a.id,90,T+30);const h=bundleHarness(state),raw=h.raw();h.click('toggle-collapse');h.click('toggle-collapse');assert.equal(h.raw(),raw);h.click('hide-card');assert.equal(h.raw(),raw);assert.doesNotMatch(h.html(),/data-symbol="GC"/);assert.deepEqual(h.errors,[]);});
test('M2 production save failure: quota keeps prior truth and never announces successful capture',()=>{const {state,a}=pair(),backing=memory(JSON.stringify(makeUnified(makeEnvelope(state,T+50))),(op,key)=>{if(op==='set'&&key===UNIFIED_KEY)throw new Error('quota');}),h=bundleHarness(state,{backing}),raw=h.raw();h.click('bof-to-pb',a.id);assert.equal(h.raw(),raw);assert.match(h.document.querySelector('#announcer').textContent,/本次操作未保存/);assert.doesNotMatch(h.html(),/当前管理：PB/);assert.equal(h.saved().sections.intraday.state.revision,state.revision);});

test('V6 simplified Setup: old htf_pb History still renders its original name and JSON loads unchanged',()=>{
  const old=v5Active();old.cards.GC.opportunity.type='htf_pb';old.records[0].type='htf_pb';
  const migrated=v6.migrateV5ToV6(old,{migratedAt:T+100}).state;
  const h=bundleHarness(migrated);
  assert.equal(h.errors.length,0);assert.match(h.history(),/MTF BOF（趋势走弱 1次）/);
  assert.equal(h.saved().sections.intraday.state.records[0].type,'htf_pb');
  assert.doesNotMatch(h.html(),/data-action="setup"[^>]*data-value="htf_pb"/);
});

test('MTF BOF production bundle: new setup persists through entry and history; legacy creation is rejected',()=>{
  const h=bundleHarness(ready());
  for(const type of ['htf_pb','htf_bof']){const raw=h.raw();h.click('setup',null,type);assert.equal(h.raw(),raw);}
  assert.deepEqual(h.errors.map(e=>e[1].errorCode),['V6_SETUP_INVALID','V6_SETUP_INVALID']);h.errors.length=0;
  h.click('setup',null,'mtf_bof');let r=h.saved().sections.intraday.state.records.at(-1);
  assert.equal(r.type,'mtf_bof');assert.match(h.html(),/MTF BOF（做多等收敛 做空等扫高）/);
  h.click('entry',r.id);h.confirm();assert.equal(h.saved().sections.intraday.state.records.at(-1).type,'mtf_bof');
  assert.match(h.history(),/MTF BOF（做多等收敛 做空等扫高）/);
  h.click('setup',null,'mtf_bof');r=h.saved().sections.intraday.state.records.at(-1);h.click('entry',r.id);h.confirm();
  assert.equal(v6.activeTradesForSymbol(h.saved().sections.intraday.state,'GC').length,2);
  assert.deepEqual(h.errors,[]);
});
test('MTF BOF production bundle: old HTF BOF history and active lifecycle keep their original name and ID',()=>{
  const state=v6.migrateV5ToV6(v5Active('wait'),{migratedAt:T+100}).state,id=state.records[0].id,h=bundleHarness(state);
  assert.match(h.html(),/HTF BOF（恐慌或走弱 1次）/);h.click('entry',id);h.confirm();
  assert.equal(h.saved().sections.intraday.state.records[0].type,'htf_bof');assert.match(h.history(),/HTF BOF（恐慌或走弱 1次）/);
  h.click('trade-exit',id);h.confirm('UNKNOWN');assert.equal(h.saved().sections.intraday.state.records[0].id,id);
  assert.deepEqual(h.errors,[]);
});
