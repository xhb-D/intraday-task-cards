// Actual Chrome, isolated localhost origin/profile, synthetic records only.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { intradayV6 as v } from '../src/intraday-v6/index.js';
import { makeEnvelope } from '../src/capture-persistence.js';
import { makeUnified, UNIFIED_KEY } from '../src/capture-unified.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.'), output = resolve(process.argv[2] || 'docs/qa/v6-setup-expectations');
await mkdir(output, { recursive:true });
const server = createServer(async (req,res) => {
  try {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(name==='/favicon.ico'){res.writeHead(204);res.end();return;}
    const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+'/'))throw new Error('path');
    const data=await readFile(file),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}/#/home`, errors=[], expectedFaultDiagnostics=[], checks=[], screenshots=[];
let expectedFault = '';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const T=Date.now()-3600000,s=v.createWorkspace(T);
for(const [symbol,type,direction] of [['GC','spb','long'],['ES','cpb','short'],['CL','bof','long']]){
  v.changeStructure(s,symbol,'breakout_strong_pullback_weak');v.changeDirection(s,symbol,direction,T+1);const r=v.chooseSetup(s,symbol,type,T+2).opportunity;
  if(symbol!=='GC')v.markEntered(s,r.id,T+3,true);
  if(symbol==='CL'){r.type='mtf_bof';r.structure3mAtRegistration='trend_pullback_weaker';v.recordInitialStop(s,r.id,90,T+4);}
}
const ids=Object.fromEntries(s.records.map(r=>[r.symbol,r.id])),contexts=[];
async function pageFor(theme,width=1500,height=1100){
  const u=makeUnified(makeEnvelope(s,T+10));u.preferences.appearance=theme;
  const context=await browser.newContext({viewport:{width,height},colorScheme:theme,deviceScaleFactor:1});contexts.push(context);
  await context.addInitScript(({key,raw})=>{if(!localStorage.getItem(key))localStorage.setItem(key,raw);},{key:UNIFIED_KEY,raw:JSON.stringify(u)});
  const page=await context.newPage();watch(page);await page.goto(url);await page.locator('[data-symbol="GC"].capture-card').waitFor();return {page,context};
}
function watch(page){page.on('pageerror',e=>errors.push({type:'pageerror',message:e.message}));page.on('console',e=>{if(['error','warning'].includes(e.type())){const entry={type:e.type(),message:e.text()};if(expectedFault && e.text().includes('CANONICAL_WRITE_FAILED'))expectedFaultDiagnostics.push({...entry,injectedFault:expectedFault});else errors.push(entry);}});}
const panel=page=>page.locator('#expectation-panel-host');
const action=(page,name,id)=>page.locator(`[data-action="${name}"][data-opportunity-id="${id}"]`);
const paction=(page,name)=>panel(page).locator(`[data-expectation-action="${name}"]`);
const raw=page=>page.evaluate(key=>localStorage.getItem(key),UNIFIED_KEY);
const records=async page=>JSON.parse(await raw(page)).sections.intraday.state.records;
async function shot(page,name){await page.screenshot({path:resolve(output,name+'.png'),fullPage:false});screenshots.push(name+'.png');}
async function visibleBounds(page){
  await page.waitForFunction(()=>{const r=document.querySelector('#expectation-panel-host').getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;},{},{timeout:4000});
  const q=await page.evaluate(()=>{const p=document.querySelector('#expectation-panel-host'),r=p.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.ok(q.left>=-1&&q.top>=-1&&q.right<=q.w+1&&q.bottom<=q.h+1,JSON.stringify(q));assert.equal(q.overflow,false);return q;
}
async function saveForm(page){await panel(page).locator('[type="submit"]').click();await panel(page).locator('[data-expectation-feedback]').filter({hasText:'已保存本次记录'}).waitFor();}
async function dragTo(page,x,y){const header=panel(page).locator('[data-expectation-drag]'),b=await header.boundingBox();await page.mouse.move(b.x+60,b.y+30);await page.mouse.down();await page.mouse.move(x+60,y+30,{steps:15});await page.mouse.up();}
try{
for(const theme of ['light','dark']){
  const {page,context}=await pageFor(theme);
  await shot(page,`desktop-${theme}-01-pending-empty`);
  const baseline=await raw(page);await action(page,'expectation-entry',ids.GC).click();assert.equal(await page.evaluate(()=>location.hash),'#/home');assert.equal(await raw(page),baseline);
  await visibleBounds(page);await shot(page,`desktop-${theme}-02-entry-panel`);
  await panel(page).locator('[name="path"]').fill('先回踩缺口，再向上测试前高。');await panel(page).locator('[name="keyLevels"]').fill('目标为前高；途中关注历史卖方失衡区。');await panel(page).locator('[name="focus"]').fill('MTF 收敛后位移，并在缺口上沿接受。');await saveForm(page);await paction(page,'close').click();
  await shot(page,`desktop-${theme}-03-pending-saved`);
  await action(page,'expectation-entry',ids.GC).click();await dragTo(page,35,140);const savedPosition=await panel(page).boundingBox();await shot(page,`desktop-${theme}-08-dragged`);
  await paction(page,'close').click();await action(page,'expectation-entry',ids.GC).click();const reopened=await panel(page).boundingBox();assert.equal(reopened.x,savedPosition.x);assert.equal(reopened.y,savedPosition.y);await shot(page,`desktop-${theme}-09-reopened-position`);
  await paction(page,'close').click();await page.reload();await action(page,'expectation-entry',ids.GC).click();const reloaded=await panel(page).boundingBox();assert.equal(reloaded.x,savedPosition.x);assert.equal(reloaded.y,savedPosition.y);checks.push(`${theme}: drag/close/reopen/reload PASS`);
  await dragTo(page,1000,70);await paction(page,'correct').click();await panel(page).locator('[name="path"]').fill('未保存的更正草稿');
  await page.locator('.capture-card[data-symbol="CL"] [data-action="bias"][data-value="bullish"]').click();await page.waitForTimeout(1200);assert.equal(await panel(page).locator('[name="path"]').inputValue(),'未保存的更正草稿');
  await paction(page,'close').click();assert.equal(await panel(page).locator('[data-expectation-discard]').isVisible(),true);await paction(page,'keep').click();assert.equal(await panel(page).locator('[name="path"]').inputValue(),'未保存的更正草稿');
  // A normal background entry confirmation remains available while the panel has a draft.
  await action(page,'entry',ids.GC).click();await page.locator('#dialog-confirm').click();assert.equal(await panel(page).locator('[name="path"]').inputValue(),'未保存的更正草稿');await saveForm(page);await paction(page,'close').click();
  const gc=(await records(page)).find(r=>r.id===ids.GC);assert.equal(gc.researchCapture.manualEvents[0].payload.timing,'before_html_entry');assert.equal(gc.researchCapture.manualEvents[1].payload.timing,'after_html_entry');
  await action(page,'expectation-entry',ids.ES).scrollIntoViewIfNeeded();await shot(page,`desktop-${theme}-04-active-empty`);await action(page,'expectation-entry',ids.ES).click();await panel(page).locator('[name="path"]').fill('等待扫高后的向下扩展。');await saveForm(page);assert.ok((await panel(page).textContent()).includes('入场后补录'));await paction(page,'close').click();
  await action(page,'expectation-update',ids.GC).click();await shot(page,`desktop-${theme}-06-update-panel`);let count=(await records(page)).find(r=>r.id===ids.GC).researchCapture.manualEvents.length;
  await panel(page).locator('[value="underperformed"]').check();await panel(page).locator('[name="reason"]').fill('进入历史卖方失衡区，上涨无法继续扩展。');await saveForm(page);
  assert.equal((await records(page)).find(r=>r.id===ids.GC).researchCapture.manualEvents.length,count+1);await shot(page,`desktop-${theme}-07-history-panel`);await paction(page,'close').click();await shot(page,`desktop-${theme}-05-active-tracking`);
  await action(page,'expectation-update',ids.GC).click();await panel(page).locator('[value="underperformed"]').check();await saveForm(page);await paction(page,'close').click();
  // Same-symbol independent trade, no copied expectation.
  await page.locator('.capture-card[data-symbol="GC"] [data-action="setup"][data-value="cpb"]').click();let b=(await records(page)).at(-1);await action(page,'entry',b.id).click();await page.locator('#dialog-confirm').click();assert.equal(b.type,'cpb');
  const oldGc=JSON.stringify((await records(page)).find(r=>r.id===ids.GC));await action(page,'expectation-entry',b.id).click();await panel(page).locator('[name="path"]').fill('独立 B 的预期。');await saveForm(page);assert.equal(JSON.stringify((await records(page)).find(r=>r.id===ids.GC)),oldGc);await paction(page,'close').click();
  await action(page,'expectation-entry',ids.GC).click();await paction(page,'correct').click();await panel(page).locator('[name="focus"]').fill('切换前的草稿');await action(page,'expectation-entry',b.id).click();assert.ok((await panel(page).textContent()).includes(ids.GC));await paction(page,'keep').click();assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'切换前的草稿');await action(page,'expectation-entry',b.id).click();await paction(page,'discard').click();assert.ok((await panel(page).textContent()).includes(b.id));checks.push(`${theme}: draft keep/discard, background trade/Chime rerender, A/B isolation PASS`);
  await page.setViewportSize({width:760,height:600});await visibleBounds(page);await paction(page,'reset').click();await visibleBounds(page);await page.setViewportSize({width:1500,height:1100});await paction(page,'close').click();
  await action(page,'expectation-entry',b.id).click();await page.evaluate(()=>{document.documentElement.style.zoom='1.25';dispatchEvent(new Event('resize'));});await visibleBounds(page);await page.evaluate(()=>{document.documentElement.style.zoom='';dispatchEvent(new Event('resize'));});await paction(page,'close').click();checks.push(`${theme}: resize/zoom/reclamp/reset PASS`);
  // Legacy stop and BOF regression while the floating panel is open.
  await action(page,'expectation-entry',ids.GC).click();await dragTo(page,35,70);await action(page,'bof-to-pb',ids.CL).click();await action(page,'bof-revert',ids.CL).click();assert.equal(await panel(page).isVisible(),true);await paction(page,'close').click();
  // Quota failure retains form and canonical bytes.
  await action(page,'expectation-entry',b.id).click();await paction(page,'correct').click();await panel(page).locator('[name="path"]').fill('保存失败仍须保留');const beforeFailure=await raw(page);
  expectedFault='quota';
  await page.evaluate(key=>{window.qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,val){if(k===key)throw new Error('QA quota');return window.qaSetItem.call(this,k,val);};},UNIFIED_KEY);
  await panel(page).locator('[type="submit"]').click();assert.equal(await raw(page),beforeFailure);assert.equal(await panel(page).locator('[name="path"]').inputValue(),'保存失败仍须保留');assert.ok((await panel(page).locator('[data-expectation-feedback]').textContent()).includes('保存失败'));
  await page.evaluate(()=>{Storage.prototype.setItem=window.qaSetItem;});expectedFault='';await paction(page,'close').click();await paction(page,'discard').click();checks.push(`${theme}: quota failure preserves draft/canonical PASS`);
  // Real post-write mismatch rolls back without reporting a saved expectation.
  await action(page,'expectation-entry',b.id).click();await paction(page,'correct').click();await panel(page).locator('[name="path"]').fill('回读失败的草稿');const beforeReadback=await raw(page);expectedFault='readback';
  await page.evaluate(key=>{window.qaGetItem=Storage.prototype.getItem;window.qaSetItem=Storage.prototype.setItem;let wrote=false,failed=false;
    Storage.prototype.setItem=function(k,val){const result=window.qaSetItem.call(this,k,val);if(k===key)wrote=true;return result;};
    Storage.prototype.getItem=function(k){if(k===key&&wrote&&!failed){failed=true;return 'QA mismatched readback';}return window.qaGetItem.call(this,k);};},UNIFIED_KEY);
  await panel(page).locator('[type="submit"]').click();assert.equal(await raw(page),beforeReadback);assert.equal(await panel(page).locator('[name="path"]').inputValue(),'回读失败的草稿');assert.ok((await panel(page).locator('[data-expectation-feedback]').textContent()).includes('保存失败'));
  await page.evaluate(()=>{Storage.prototype.getItem=window.qaGetItem;Storage.prototype.setItem=window.qaSetItem;});expectedFault='';await paction(page,'close').click();await paction(page,'discard').click();checks.push(`${theme}: actual readback mismatch rollback/draft PASS`);
  // Two real tabs. The stale tab cannot append a holding judgement.
  const second=await context.newPage();watch(second);await second.goto(url);await action(second,'expectation-update',ids.GC).click();await panel(second).locator('[value="met"]').check();await panel(second).locator('[name="reason"]').fill('过期标签页草稿');
  await action(page,'expectation-update',ids.GC).click();await panel(page).locator('[value="exceeded"]').check();await saveForm(page);const afterA=await raw(page);await second.waitForFunction(()=>document.querySelector('#expectation-panel-host [type="submit"]').disabled);assert.equal(await panel(second).locator('[name="reason"]').inputValue(),'过期标签页草稿');assert.equal(await raw(second),afterA);await second.close();checks.push(`${theme}: real dual-tab CAS/lock PASS`);
  await paction(page,'close').click();await action(page,'trade-exit',b.id).click();await page.locator('#dialog-confirm').click();await page.evaluate(()=>location.hash='#/history');await page.locator('[data-route-view="history"]').waitFor({state:'visible'});await page.locator(`[data-expectation-history="${b.id}"]`).click();assert.equal(await panel(page).locator('[data-expectation-action="update"]').count(),0);await paction(page,'close').click();await page.evaluate(()=>location.hash='#/home');await page.locator('[data-route-view="home"]').waitFor({state:'visible'});
  await page.locator('.capture-card[data-symbol="GC"] [data-action="flatten"]').click();await page.locator('#dialog-confirm').click();assert.equal((await records(page)).filter(r=>r.symbol==='GC'&&r.enteredAt!==null&&r.endedAt===null).length,0);checks.push(`${theme}: closed history/single exit/flatten PASS`);
  // Real UI download and full restore recover the entire mixed event log.
  const beforeExport=await records(page);await page.locator('#data-tools').click();
  const downloadEvent=page.waitForEvent('download');await page.locator('#export-json').click();const download=await downloadEvent;
  const backupPath=resolve(output,`synthetic-${theme}-backup.json`);await download.saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));assert.deepEqual(backup.sections.intraday.state.records,beforeExport);
  await page.locator('#import-file').setInputFiles(backupPath);await page.locator('#confirm-dialog').waitFor({state:'visible'});await page.locator('#dialog-confirm').click();
  assert.deepEqual(await records(page),beforeExport);checks.push(`${theme}: actual JSON download/restore PASS`);
  for(const route of ['risk','chime','exit-research','home']){await page.evaluate(route=>location.hash='#/'+route,route);await page.locator(`[data-route-view="${route}"]`).waitFor({state:'visible'});if(route==='exit-research'){assert.ok((await page.locator('.er-trades').textContent()).includes('研究分类待确认'));await shot(page,`desktop-${theme}-10-research-classification-pending`);}}checks.push(`${theme}: routes PASS`);
}
for(const theme of ['light','dark'])for(const width of [390,375,320]){
  const {page}=await pageFor(theme,width,844);
  const setupLayout=await page.locator('.capture-card[data-symbol="GC"] .setup-segment .option').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,clipped:b.scrollWidth>b.clientWidth||b.scrollHeight>b.clientHeight};}));
  assert.equal(setupLayout.length,3);assert.ok(setupLayout.every(b=>!b.clipped));assert.ok(setupLayout.every(b=>Math.abs(b.y-setupLayout[0].y)<1&&Math.abs(b.w-setupLayout[0].w)<1&&Math.abs(b.h-setupLayout[0].h)<1));
  await action(page,'expectation-entry',ids.GC).scrollIntoViewIfNeeded();const scrollBefore=await page.evaluate(()=>scrollY);
  await action(page,'expectation-entry',ids.GC).click();await visibleBounds(page);await shot(page,`mobile-${theme}-${width}-drawer`);
  await panel(page).locator('[name="focus"]').fill('手机端观察重点');await panel(page).locator('[type="submit"]').scrollIntoViewIfNeeded();assert.equal(await panel(page).locator('[type="submit"]').isVisible(),true);await saveForm(page);await paction(page,'close').click();
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<2);if(width===390)await shot(page,`mobile-${theme}-390-closed-scroll-restored`);checks.push(`${theme}/${width}: drawer/save/close scroll PASS`);
  if(width===390){await action(page,'expectation-entry',ids.GC).click();await paction(page,'correct').click();await panel(page).locator('[name="focus"]').focus();await page.setViewportSize({width,height:430});await panel(page).locator('[type="submit"]').scrollIntoViewIfNeeded();await visibleBounds(page);await shot(page,`mobile-${theme}-390-reduced-viewport-keyboard-simulation`);checks.push(`${theme}/390: reduced viewport simulation PASS; real OS virtual keyboard NOT VERIFIED`);}
}
assert.deepEqual(errors,[]);
const result={status:'PASS_WITH_DISCLOSED_DEVICE_LIMITATION',browser:await browser.version(),origin:url,fixture:'synthetic only',checks,screenshots,consoleErrorsOrWarnings:errors,expectedFaultDiagnostics,unverified:['Real iOS/Android OS virtual keyboard and external physical monitor removal; viewport resize/zoom simulations passed.']};
await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,checks:checks.length,screenshots:screenshots.length,consoleErrorsOrWarnings:errors}));
}catch(error){await writeFile(resolve(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,screenshots,errors},null,2));throw error;}
finally{await browser.close();await new Promise(done=>server.close(done));}
