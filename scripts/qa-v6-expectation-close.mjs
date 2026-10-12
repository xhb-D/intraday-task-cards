// Real Chrome on an isolated localhost origin. All trade/storage data is synthetic.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { intradayV6 as v } from '../src/intraday-v6/index.js';
import { makeEnvelope } from '../src/capture-persistence.js';
import { makeUnified, UNIFIED_KEY } from '../src/capture-unified.js';
import { EXPECTATION_PANEL_POSITION_KEY } from '../src/expectation-panel.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.'), output = resolve(process.argv[2] || 'docs/qa/v6-expectation-close');
await mkdir(output, { recursive:true });
const server = createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw new Error('path');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type':({'.html':'text/html','.css':'text/css','.js':'text/javascript'}[extname(file)] || 'application/octet-stream'), 'Cache-Control':'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const url = `http://127.0.0.1:${server.address().port}/#/home`;
const browser = await chromium.launch({headless:true, executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const T = Date.now() - 3600000, state = v.createWorkspace(T), ids = {};
for (const [symbol,type] of [['GC','spb'],['CL','bof'],['ES','cpb']]) {
  v.changeStructure(state,symbol,'breakout_strong_pullback_weak'); v.changeDirection(state,symbol,'long',T+1);
  const record = v.chooseSetup(state,symbol,type,T+2).opportunity; ids[symbol] = record.id;
  if (symbol !== 'CL') {
    v.markEntered(state,record.id,T+3,true);
    v.recordEntryExpectation(state,record.id,{path:`${symbol} saved path`,keyLevels:'saved levels',focus:'saved focus'},`${symbol}-entry`,T+4);
    v.updateHoldingExpectation(state,record.id,'met','saved reason',`${symbol}-holding`,T+5);
  }
}
ids.B = v.chooseSetup(state,'GC','cpb',T+20).opportunity.id;
const checks = [], screenshots = [], errors = [], expectedDiagnostics = [];
let injectedFault = '';
const panel = p => p.locator('#expectation-panel-host');
const pa = (p,a) => panel(p).locator(`[data-expectation-action="${a}"]`);
const action = (p,a,id) => p.locator(`[data-action="${a}"][data-opportunity-id="${id}"]`);
const raw = p => p.evaluate(key => localStorage.getItem(key),UNIFIED_KEY);
const records = async p => JSON.parse(await raw(p)).sections.intraday.state.records;
const check = (scope,name) => checks.push({scope,name,status:'PASS'});
const visible = async p => assert.equal(await panel(p).isVisible(),true);
const closed = async p => assert.equal(await panel(p).isVisible(),false);
async function guard(p) {
  await visible(p); assert.equal(await panel(p).locator('[data-expectation-discard]').isVisible(),true);
  assert.equal(await panel(p).locator('#expectation-unsaved-title').textContent(),'存在未保存修改');
  for (const [a,text] of [['save-close','保存并关闭'],['keep','继续编辑'],['discard','放弃修改']]) {
    assert.equal(await pa(p,a).textContent(),text); assert.equal(await pa(p,a).isVisible(),true);
  }
}
async function shot(p,name) {
  await p.screenshot({path:resolve(output,name+'.png')}); screenshots.push(name+'.png');
}
async function open(p,id=ids.GC,mode='entry') {
  await action(p,`expectation-${mode}`,id).click(); await visible(p);
}
async function outside(p) { await p.mouse.click(3,3); }
async function bounds(p) {
  await p.waitForFunction(()=>{const r=document.querySelector('#expectation-panel-host').getBoundingClientRect();return r.x>=-1 && r.y>=-1 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1;});
  const b = await panel(p).evaluate(el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}; });
  assert.ok(b.x>=-1 && b.y>=-1 && b.right<=b.w+1 && b.bottom<=b.h+1,JSON.stringify(b)); assert.equal(b.overflow,false);
}
async function dragTo(p,x,y) {
  const b=await panel(p).locator('[data-expectation-drag]').boundingBox();
  await p.mouse.move(b.x+60,b.y+30); await p.mouse.down(); await p.mouse.move(x+60,y+30,{steps:10}); await p.mouse.up();
}
function watch(p) {
  p.on('pageerror',e => errors.push(e.message));
  p.on('console',e => { if (e.type()==='error' || e.type()==='warning') {
    if (injectedFault && e.text().includes('CANONICAL_WRITE_FAILED')) expectedDiagnostics.push({fault:injectedFault,message:e.text()});
    else errors.push(e.text());
  }});
}
try {
for (const width of [1440,390]) for (const theme of ['light','dark']) {
  const scope=`${width}-${theme}`, initial=makeUnified(makeEnvelope(state,T+30)); initial.preferences.appearance=theme;
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},colorScheme:theme,isMobile:width===390,hasTouch:width===390,deviceScaleFactor:1});
  await context.addInitScript(({key,value}) => { if (!localStorage.getItem(key)) localStorage.setItem(key,value); },{key:UNIFIED_KEY,value:JSON.stringify(initial)});
  const page=await context.newPage(); watch(page); await page.goto(url); await page.locator('.capture-card').first().waitFor();
  const baseline=await raw(page);
  await open(page); await bounds(page); await shot(page,`${scope}-01-open`);
  await pa(page,'close').click(); await closed(page); check(scope,'01 close button');
  await open(page); await outside(page); await closed(page); await shot(page,`${scope}-outside-closed`); check(scope,width===390?'15 mobile outside click':'02 outside click');
  await open(page); await panel(page).locator('h2').click(); await visible(page); check(scope,'03 inside click');
  await pa(page,'history').click(); await visible(page); assert.match(await panel(page).textContent(),/完整历史/); check(scope,'05 tab');
  await pa(page,'entry').focus(); await page.keyboard.press('Enter'); await visible(page); check(scope,'keyboard tab activation remains inside after rerender');
  await pa(page,'entry').click(); await panel(page).locator('summary').click(); await visible(page); check(scope,'06 history expand');
  await pa(page,'correct').click(); await panel(page).locator('[name="path"]').click(); await visible(page); check(scope,width===390?'16 mobile input':'04 input / correction');
  if (width===1440) {
    const inputBox=await panel(page).locator('[name="path"]').boundingBox();
    await page.mouse.move(inputBox.x+15,inputBox.y+15); await page.mouse.down(); await page.mouse.move(3,3,{steps:8}); await page.mouse.up();
    await visible(page); check(scope,'inside pointer release outside is not an outside click');
  }
  await page.keyboard.press('Escape'); await closed(page); await shot(page,`${scope}-esc-closed`); check(scope,'07 ESC clean');
  await open(page); await pa(page,'correct').click(); await panel(page).locator('[name="focus"]').fill('close button draft');
  await pa(page,'close').click(); await guard(page); await pa(page,'discard').click(); await closed(page); assert.equal(await raw(page),baseline); check(scope,'dirty close button uses same guard');
  await open(page); await pa(page,'correct').click();
  await panel(page).locator('[name="path"]').fill('unsaved path');
  await panel(page).locator('[name="keyLevels"]').fill('unsaved levels');
  await panel(page).locator('[name="focus"]').fill('unsaved focus');
  await pa(page,'history').click(); await page.keyboard.press('Escape'); await guard(page); check(scope,'ESC converts a pending tab switch into close confirmation');
  await page.keyboard.press('Escape'); await guard(page); assert.equal(await raw(page),baseline);
  await shot(page,`${scope}-02-esc-unsaved`); check(scope,'08 ESC dirty guard / all entry fields');
  await pa(page,'keep').click(); await visible(page); assert.equal(await panel(page).locator('[name="path"]').inputValue(),'unsaved path');
  assert.equal(await panel(page).locator('[data-expectation-discard]').isVisible(),false); check(scope,'12 continue editing');
  await outside(page); await guard(page); await shot(page,`${scope}-03-outside-unsaved`); check(scope,'09 outside dirty guard');
  if (width===390) { await pa(page,'keep').click(); await page.touchscreen.tap(3,3); await guard(page); check(scope,'dirty mobile touch outside protects draft'); }
  await pa(page,'discard').click(); await closed(page); assert.equal(await raw(page),baseline); await shot(page,`${scope}-discard-closed`);
  await open(page); await pa(page,'correct').click(); assert.equal(await panel(page).locator('[name="path"]').inputValue(),'GC saved path');
  assert.equal(await panel(page).locator('[name="keyLevels"]').inputValue(),'saved levels');
  assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'saved focus'); check(scope,'11 discard restores saved values');
  await panel(page).locator('[name="path"]').fill('explicitly saved correction'); await outside(page); await guard(page);
  const beforeSave=await records(page); await pa(page,'save-close').click(); await closed(page);
  const afterSave=await records(page),gcBefore=beforeSave.find(r=>r.id===ids.GC),gcAfter=afterSave.find(r=>r.id===ids.GC);
  assert.deepEqual(gcAfter.researchCapture.manualEvents.slice(0,-1),gcBefore.researchCapture.manualEvents);
  assert.equal(gcAfter.researchCapture.manualEvents.length,gcBefore.researchCapture.manualEvents.length+1);
  assert.equal(gcAfter.researchCapture.manualEvents.at(-1).type,'ENTRY_EXPECTATION_CORRECTED');
  for (const r of beforeSave.filter(r=>r.id!==ids.GC)) assert.deepEqual(afterSave.find(a=>a.id===r.id),r);
  check(scope,'10 save and close succeeds once / original save flow'); check(scope,'17 existing expectation history unchanged');
  await open(page); await shot(page,`${scope}-04-saved`); await pa(page,'close').click();
  await open(page,ids.CL); await panel(page).locator('[name="path"]').fill('first entry'); await page.keyboard.press('Escape');
  await pa(page,'save-close').click(); await closed(page); assert.equal((await records(page)).find(r=>r.id===ids.CL).researchCapture.manualEvents.at(-1).type,'ENTRY_EXPECTATION_RECORDED'); check(scope,'entry recording save and close');
  await open(page,ids.GC,'update'); await panel(page).locator('[name="reason"]').fill('reason alone is dirty');
  await outside(page); await guard(page); await pa(page,'save-close').click(); await visible(page); // required status rejects save
  assert.equal(await panel(page).locator('[name="reason"]').inputValue(),'reason alone is dirty'); check(scope,'invalid save retains draft');
  await panel(page).locator('[value="underperformed"]').check(); await pa(page,'save-close').click(); await closed(page);
  assert.equal((await records(page)).find(r=>r.id===ids.GC).researchCapture.manualEvents.at(-1).payload.reason,'reason alone is dirty'); check(scope,'holding reason / status guard and save');

  await open(page); await pa(page,'correct').click(); await panel(page).locator('[name="path"]').fill('quota retained draft');
  const beforeFailure=await raw(page); injectedFault='quota';
  await page.evaluate(key=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,val){if(k===key)throw new Error('QA quota');return window.originalSetItem.call(this,k,val);};},UNIFIED_KEY);
  await outside(page); await guard(page); await pa(page,'save-close').click(); await visible(page);
  assert.equal(await panel(page).locator('[name="path"]').inputValue(),'quota retained draft'); assert.equal(await raw(page),beforeFailure);
  assert.match(await panel(page).locator('[data-expectation-feedback]').textContent(),/保存失败/); await shot(page,`${scope}-05-save-failure`);
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;}); injectedFault='';
  await pa(page,'keep').click(); await page.keyboard.press('Escape'); await pa(page,'discard').click(); await closed(page); check(scope,'18 save failure retains panel / draft / canonical bytes');

  await open(page); await pa(page,'correct').click(); await panel(page).locator('[name="focus"]').fill('trade A isolated draft');
  await action(page,'expectation-entry',ids.B).dispatchEvent('click'); await visible(page);
  assert.match(await panel(page).textContent(),new RegExp(ids.GC)); await pa(page,'keep').click();
  assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'trade A isolated draft');
  await action(page,'expectation-entry',ids.B).dispatchEvent('click'); await pa(page,'discard').click();
  assert.match(await panel(page).textContent(),new RegExp(ids.B)); assert.equal(await panel(page).locator('[name="path"]').inputValue(),'');
  await pa(page,'close').click(); check(scope,'20 multi Trade switching isolation');

  await open(page); const beforeInteraction=await raw(page);
  if (width===1440) {
    await dragTo(page,50,110); await visible(page); await shot(page,`${scope}-06-dragged`);
    const b=await panel(page).boundingBox(),pos=await page.evaluate(k=>localStorage.getItem(k),EXPECTATION_PANEL_POSITION_KEY);
    assert.ok(pos); await pa(page,'close').click(); await page.reload(); await open(page);
    const restored=await panel(page).boundingBox(); assert.equal(restored.x,b.x); assert.equal(restored.y,b.y);
    await shot(page,`${scope}-07-position-restored`); check(scope,'13 desktop drag never closes'); check(scope,'14 reload restores position');
    await pa(page,'reset').click(); await bounds(page); assert.notEqual((await panel(page).boundingBox()).x,b.x); check(scope,'reset position');
    // ESC is global even when a home input owns focus.
    await page.locator('#appearance-select').focus(); assert.equal(await page.locator('#appearance-select').evaluate(el=>el===document.activeElement),true); await page.keyboard.press('Escape'); await closed(page); check(scope,'global ESC with outside focus');
    await open(page); await page.locator('.capture-card[data-symbol="CL"] .symbol').click(); await closed(page); check(scope,'outside card click');
  } else {
    const beforeScroll=await page.evaluate(()=>scrollY); await page.mouse.move(3,3); await page.mouse.wheel(0,-120);
    await page.waitForFunction(y=>scrollY<y,beforeScroll); await visible(page); check(scope,'mobile background scroll remains available');
    const scrollBefore=await page.evaluate(()=>scrollY);
    await page.touchscreen.tap(3,3); await closed(page); assert.equal(await page.evaluate(()=>scrollY),scrollBefore); check(scope,'mobile touch outside preserves scroll');
    await open(page); await pa(page,'correct').click(); await panel(page).locator('[name="focus"]').fill('mobile keyboard draft');
    await panel(page).locator('[name="focus"]').focus(); await page.setViewportSize({width,height:430}); await bounds(page);
    assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'mobile keyboard draft'); await visible(page);
    await shot(page,`${scope}-06-reduced-viewport`); await page.setViewportSize({width,height:844});
    await page.keyboard.press('Escape'); await pa(page,'discard').click(); await closed(page); check(scope,'mobile reduced viewport keeps input / draft');
  }
  assert.equal(await raw(page),beforeInteraction); check(scope,'close / drag / reset write no canonical data');

  // Dirty navigation keeps the guard visible above the destination page.
  await open(page); await pa(page,'correct').click(); await panel(page).locator('[name="focus"]').fill('route draft');
  await page.evaluate(()=>{location.hash='#/risk';}); await page.locator('[data-route-view="risk"]').waitFor({state:'visible'});
  await guard(page); await pa(page,'keep').click(); assert.equal(await panel(page).locator('[name="focus"]').inputValue(),'route draft');
  await page.keyboard.press('Escape'); await pa(page,'discard').click(); await closed(page);
  await page.evaluate(()=>{location.hash='#/home';}); await page.locator('[data-route-view="home"]').waitFor({state:'visible'}); check(scope,'dirty route navigation retains visible guard');

  const second=await context.newPage(); watch(second); await second.goto(url); await open(second,ids.GC,'update');
  await panel(second).locator('[value="met"]').check(); await panel(second).locator('[name="reason"]').fill('CAS stale tab draft');
  await open(page,ids.GC,'update'); await panel(page).locator('[value="exceeded"]').check(); await panel(page).locator('[type="submit"]').click();
  await second.waitForFunction(()=>document.querySelector('#expectation-panel-host [type="submit"]').disabled);
  const afterOtherTab=await raw(page); await second.keyboard.press('Escape'); await guard(second);
  assert.equal(await pa(second,'save-close').isDisabled(),true); assert.equal(await panel(second).locator('[name="reason"]').inputValue(),'CAS stale tab draft');
  await pa(second,'save-close').dispatchEvent('click'); await visible(second); assert.equal(await panel(second).locator('[name="reason"]').inputValue(),'CAS stale tab draft');
  assert.equal(await raw(second),afterOtherTab); await pa(second,'keep').click(); await visible(second); check(scope,'19 real dual-tab CAS lock retains draft and canonical');
  await context.close(); console.log(`${scope}: PASS`);
}
assert.deepEqual(errors,[]);
const result={status:'PASS',browser:await browser.version(),origin:url,fixture:'synthetic only',checks,screenshots,errors,expectedDiagnostics,limitations:['Mobile uses Chrome touch emulation; physical iOS Safari and the real OS soft keyboard are not verified. Reduced visual viewport is simulated.']};
await writeFile(resolve(output,'browser-results.json'),JSON.stringify(result,null,2)+'\n');
console.log(`PASS: ${checks.length} checks; ${screenshots.length} screenshots`);
} finally { await browser.close(); await new Promise(done=>server.close(done)); }
