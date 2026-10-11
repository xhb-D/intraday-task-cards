// Isolated actual Chrome QA. Original candidate is a read-only Git archive.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { intradayV6 as v } from '../src/intraday-v6/index.js';
import { makeEnvelope } from '../src/capture-persistence.js';
import { makeUnified, UNIFIED_KEY } from '../src/capture-unified.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { RESEARCH_UI_KEY } from '../src/exit-research/ui/store.js';
import { parseCsv } from '../src/exit-research/csv.js';
import { decodeDecisionCsvText } from '../src/exit-research/ui/capture-adapter.js';
import { workbenchFixture } from '../test/fixtures/exit-research-ui.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve('.'),out=resolve(process.argv[2] || 'docs/qa/v6-remediation/targeted'),originalSha='eb80e9ace0784a40beacef2e870e6e821b026f58';
await mkdir(out,{recursive:true});const original=await mkdtemp(join(tmpdir(),'v6-remediation-browser-original-'));
execFileSync('tar',['-x','-C',original],{input:execFileSync('git',['archive',originalSha],{maxBuffer:64*1024*1024})});
const server=createServer(async(req,res)=>{try{
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name.endsWith('favicon.ico')){res.writeHead(204);res.end();return;}
  const before=name.startsWith('/original/'),base=before?original:root;if(before)name=name.slice('/original'.length);
  const file=resolve(base,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(base+'/'))throw new Error('path');
  const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'}[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(data);
}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const errors=[],checks=[],screenshots=[],contexts=[],T=Date.now()-3600000,s=v.createWorkspace(T),ids={};
const content=path=>({path,keyLevels:'前高 / 缺口',focus:'关注 MTF 行为'});
for(const [symbol,type] of [['GC','bof'],['CL','bof'],['ES','spb']]){
  v.changeStructure(s,symbol,'breakout_strong_pullback_weak');v.changeDirection(s,symbol,'long',T);
  const r=v.chooseSetup(s,symbol,type,T).opportunity;ids[symbol]=r.id;v.recordEntryExpectation(s,r.id,content(symbol+' 事前预期'),'entry',T);v.markEntered(s,r.id,T,true);v.recordInitialStop(s,r.id,90,T);
}
const equal=v.chooseSetup(s,'GC','cpb',T+1).opportunity;ids.equal=equal.id;
v.recordEntryExpectation(s,equal.id,content('SAME_MS_PRE'),'pre',T+1);v.markEntered(s,equal.id,T+1,true);v.correctEntryExpectation(s,equal.id,content('SAME_MS_AFTER'),'after',T+1);v.updateHoldingExpectation(s,equal.id,'met','SAME_MS_HOLD','hold',T+1);v.markTradeExited(s,equal.id,'UNKNOWN',T+1,true);v.correctEntryExpectation(s,equal.id,content('SAME_MS_REVIEW'),'review',T+1);
for(const [symbol,reason] of [['ES','canceled'],['CL','invalid']]){const r=v.chooseSetup(s,symbol,'cpb',T+2).opportunity;v.recordEntryExpectation(s,r.id,content(reason+' 原始事实'),'e',T+2);v.endOpportunity(s,r.id,reason,T+2);ids[reason]=r.id;}
const dangerous=structuredClone(s.records.find(r=>r.id===ids.canceled));dangerous.id='\t=1+1';dangerous.researchCapture={eventSequence:0,manualEvents:[]};s.records.push(dangerous);v.assertV6State(s);
const researchData=new Map(),research=createWorkbenchController({getIntraday:()=>s,storage:{getItem:k=>researchData.get(k)??null,setItem:(k,value)=>researchData.set(k,value)}}),f=workbenchFixture();
research.importFile('fills',f.fills);research.confirmFlat(true);research.decide('reject',ids.GC,research.snapshot().logicalTrades[0].logicalTradeId);research.filters({setup:'SETUP_BOF'});research.setReplaySettings(ids.GC,{replayHardEndAt:Date.now()+3600000,executionTickSize:.1});const researchRaw=research.exportStore();
async function pageFor(theme,{before=false,width=1500,height=1100,blank=false}={}){
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme,deviceScaleFactor:1});contexts.push(context);
  if(!blank){const u=makeUnified(makeEnvelope(s,T+10));u.preferences.appearance=theme;await context.addInitScript(({uk,raw,rk,research})=>{if(!localStorage.getItem(uk))localStorage.setItem(uk,raw);if(!localStorage.getItem(rk))localStorage.setItem(rk,research);},{uk:UNIFIED_KEY,raw:JSON.stringify(u),rk:RESEARCH_UI_KEY,research:researchRaw});}
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(['error','warning'].includes(e.type()))errors.push(e.text());});
  await page.goto(origin+(before?'/original/':'/')+'#/home');await page.locator('#cards .capture-card').first().waitFor();return {page,context};
}
const panel=p=>p.locator('#expectation-panel-host'),paction=(p,name)=>panel(p).locator(`[data-expectation-action="${name}"]`),action=(p,name,id,value)=>p.locator(`[data-action="${name}"][data-opportunity-id="${id}"]${value?`[data-value="${value}"]`:''}`);
const raw=p=>p.evaluate(key=>localStorage.getItem(key),UNIFIED_KEY),records=async p=>JSON.parse(await raw(p)).sections.intraday.state.records;
async function route(p,name){await p.evaluate(name=>location.hash='#/'+name,name);await p.locator(`[data-route-view="${name}"]`).waitFor({state:'visible'});}
async function shot(p,name){await p.screenshot({path:join(out,name+'.png'),fullPage:false});screenshots.push(name+'.png');}
async function download(p,selector,path){const pending=p.waitForEvent('download');await p.locator(selector).click();await (await pending).saveAs(path);}
try{
for(const theme of ['light','dark']){
  const before=(await pageFor(theme,{before:true})).page;
  await before.locator('#history').evaluate(el=>el.open=true);await before.locator('#history').scrollIntoViewIfNeeded();await shot(before,`${theme}-before-home-ended-list`);
  await before.locator(`[data-expectation-history="${ids.equal}"]`).click();await shot(before,`${theme}-before-equal-ms-order`);
  const {page}=await pageFor(theme);assert.equal(await page.locator('[data-route-view="home"] #history-body').count(),0);assert.equal(await page.locator('#cards [data-record-id="'+ids.equal+'"]').count(),0);await shot(page,`${theme}-after-home-current-only`);
  const initial=await records(page);await action(page,'management-switch',ids.GC,'SPB').click();const switched=(await records(page)).find(r=>r.id===ids.GC);
  assert.equal(switched.type,'bof');assert.equal(v.currentManagement(switched),'SPB');assert.deepEqual(switched.researchCapture.manualEvents.slice(0,2),initial.find(r=>r.id===ids.GC).researchCapture.manualEvents);assert.equal(await action(page,'management-switch',ids.GC).count(),0);assert.equal(await action(page,'bof-revert',ids.GC).count(),0);await shot(page,`${theme}-after-bof-to-spb`);
  await action(page,'expectation-entry',ids.GC).click();await paction(page,'correct').click();await panel(page).locator('[name="focus"]').fill('管理转换时保留的草稿');
  const gcBefore=JSON.stringify(switched);await action(page,'management-switch',ids.CL,'CPB').click();assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'管理转换时保留的草稿');assert.equal(JSON.stringify((await records(page)).find(r=>r.id===ids.GC)),gcBefore);assert.equal(v.currentManagement((await records(page)).find(r=>r.id===ids.CL)),'CPB');
  await paction(page,'close').click();await paction(page,'discard').click();assert.equal(await action(page,'management-switch',ids.ES).count(),0);await action(page,'expectation-entry',ids.CL).scrollIntoViewIfNeeded();await shot(page,`${theme}-after-bof-to-cpb`);
  await page.reload();assert.equal(v.currentManagement((await records(page)).find(r=>r.id===ids.CL)),'CPB');checks.push(`${theme}: BOF→SPB/CPB UI, immutable original, A/B isolation, no reverse, draft and reload PASS`);
  await action(page,'trade-exit',ids.GC).click();await page.locator('#dialog-confirm').click();await route(page,'history');await page.locator('#archive-query').fill(ids.GC);assert.equal(await page.locator('#history-body tr').count(),1);await shot(page,`${theme}-after-archive-query`);
  await page.locator(`[data-expectation-history="${ids.GC}"]`).click();assert.equal(await panel(page).locator('form').count(),0);assert.equal(await paction(page,'update').count(),0);assert.ok((await panel(page).textContent()).includes('BOF → SPB'));await shot(page,`${theme}-after-archive-readonly-history`);await paction(page,'close').click();
  const bytes=await raw(page);await page.evaluate(id=>{const button=document.createElement('button');button.dataset.delete=id;button.textContent='QA stale delete';document.querySelector('#history-body').append(button);button.click();button.remove();},ids.GC);assert.equal(await raw(page),bytes);
  for(const reason of ['canceled','invalid']){await page.locator('#archive-query').fill(ids[reason]);assert.equal(await page.locator('#history-body tr').count(),1);}checks.push(`${theme}: ended/canceled/invalid archive query, no hard delete, default read-only PASS`);
  await page.locator('#archive-query').fill(ids.equal);const equalBefore=JSON.stringify((await records(page)).find(r=>r.id===ids.equal));await page.locator(`[data-expectation-history="${ids.equal}"]`).click();
  const labels=await panel(page).locator('.expectation-timeline li>strong').allTextContents();assert.deepEqual(labels,['首次入场预期','HTML 入场确认','更正预期','持仓预期','HTML 退出／结束确认','更正预期']);assert.equal(JSON.stringify((await records(page)).find(r=>r.id===ids.equal)),equalBefore);await shot(page,`${theme}-after-equal-ms-order`);await paction(page,'close').click();checks.push(`${theme}: equal-millisecond UI order and canonical unchanged PASS`);
  // Import loss is rejected during preview, with raw bytes unchanged.
  const prior=await raw(page),loss=JSON.parse(prior);loss.sections.intraday.state.records=loss.sections.intraday.state.records.filter(r=>r.endedAt===null);
  await page.locator('#data-tools').click();await page.locator('#import-file').setInputFiles({name:'archive-loss.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(loss))});await page.locator('#data-feedback').filter({hasText:'档案'}).waitFor();assert.equal(await raw(page),prior);await page.locator('#data-close').click();checks.push(`${theme}: backup/fresh archive retention guard PASS (restore UI checked)`);
  await route(page,'exit-research');assert.ok((await page.locator('#exit-research-host').textContent()).includes('研究分类待确认'));const csvPath=join(out,`${theme}-decision.csv`);await download(page,'[data-er-action="decision-export"]',csvPath);
  const csv=parseCsv(await readFile(csvPath,'utf8')),unsafe=csv.rows.find(r=>decodeDecisionCsvText(r.values[0])===dangerous.id);assert.ok(unsafe);assert.ok(unsafe.values[0].startsWith('csv-text:'));assert.ok(csv.rows.some(r=>r.values[9]==='SPB'));assert.ok(csv.rows.some(r=>r.values[9]==='CPB'));checks.push(`${theme}: actual safe CSV download and exact identity decoding PASS`);
  const researchPath=join(out,`${theme}-research-store.json`);await download(page,'[data-er-action="store-export"]',researchPath);assert.deepEqual(JSON.parse(await readFile(researchPath,'utf8')),JSON.parse(researchRaw));
  await page.locator('#data-tools').click();const unifiedPath=join(out,`${theme}-unified.json`);await download(page,'#export-json',unifiedPath);const expected=await records(page);assert.deepEqual(JSON.parse(await readFile(unifiedPath,'utf8')).sections.intraday.state.records,expected);await page.locator('#data-close').click();
  const restored=(await pageFor(theme,{blank:true})).page;await restored.locator('#data-tools').click();await restored.locator('#import-file').setInputFiles(unifiedPath);await restored.locator('#confirm-dialog').waitFor({state:'visible'});await restored.locator('#dialog-confirm').click();assert.deepEqual(await records(restored),expected);
  await route(restored,'exit-research');await restored.locator('[data-er-file="store"]').setInputFiles(researchPath);await restored.locator('[data-er-action="store-confirm"]').click();assert.deepEqual(JSON.parse(await restored.evaluate(k=>localStorage.getItem(k),RESEARCH_UI_KEY)),JSON.parse(researchRaw));await shot(restored,`${theme}-after-two-store-recovery`);
  const verification=execFileSync(process.execPath,['scripts/verify-v6-recovery.mjs',unifiedPath,researchPath],{encoding:'utf8'});await writeFile(join(out,`${theme}-recovery-verification.json`),verification);checks.push(`${theme}: actual full Unified + independent Research Store download/blank-context restore/read-only verification PASS`);
}
for(const theme of ['light','dark'])for(const width of [390,320]){
  const {page}=await pageFor(theme,{width,height:844});
  for(const [id,target] of [[ids.GC,'SPB'],[ids.CL,'CPB']]){const button=action(page,'management-switch',id,target);await button.scrollIntoViewIfNeeded();const rect=await button.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);await button.click();const record=(await records(page)).find(r=>r.id===id);assert.equal(record.type,'bof');assert.equal(v.currentManagement(record),target);}
  await action(page,'expectation-entry',ids.GC).scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(page,`mobile-${theme}-${width}-bof-management`);checks.push(`${theme}/${width}: both BOF management switches usable within viewport PASS`);
  await route(page,'history');await page.locator('#archive-query').fill(ids.equal);const viewButton=await page.locator(`[data-expectation-history="${ids.equal}"]`).boundingBox();assert.ok(viewButton.x>=0&&viewButton.x+viewButton.width<=width);await shot(page,`mobile-${theme}-${width}-archive`);const scroll=await page.evaluate(()=>scrollY);
  await page.locator(`[data-expectation-history="${ids.equal}"]`).click();const box=await panel(page).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=845);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await shot(page,`mobile-${theme}-${width}-archive-drawer`);await paction(page,'close').click();assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<2);checks.push(`${theme}/${width}: archive query, drawer, no root overflow, close scroll PASS`);
}
assert.deepEqual(errors,[]);const result={status:'PASS_WITH_DISCLOSED_DEVICE_LIMITATIONS',browser:await browser.version(),originalCandidate:originalSha,fixture:'synthetic only, isolated temporary origins/profiles',checks,screenshots,consoleErrorsOrWarnings:errors,unverified:['Real iOS/Android keyboard/touch, physical monitors, browser toolbar zoom. No spreadsheet formula execution was performed.']};await writeFile(join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:checks.length,screenshots:screenshots.length,errors}));
}catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,screenshots,errors},null,2));throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));await rm(original,{recursive:true,force:true});}
