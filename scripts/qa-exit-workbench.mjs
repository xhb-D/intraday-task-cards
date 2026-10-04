// Synthetic-only files for manual browser QA. Never reads real broker exports.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { workbenchFixture, UI_T, UI_P } from '../test/fixtures/exit-research-ui.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { renderWorkbench } from '../src/exit-research/ui/render.js';
import { createWorkbenchStore } from '../src/exit-research/ui/store.js';
const dir = resolve(process.argv[2] || '/private/tmp/exit-research-step5a-synthetic');
const f = workbenchFixture(), store = createWorkbenchStore();
for(const id of [f.ids.GC0,f.ids.ES1]) {
  const entry=f.state.records.find(r=>r.id===id).enteredAt;
  store.settings.tradeOverrides[id]={replayHardEndAt:entry+4*UI_P,executionTickSize:.1};
}
const incomplete=structuredClone(f.bundle);incomplete.series[0].bars.pop();incomplete.series[0].bars.pop();incomplete.series[0].coverageEnd-=2*UI_P;
const files={'TaskCard-SYNTHETIC.json':JSON.stringify(f.unified,null,2),'Fills-SYNTHETIC.csv':f.fills,'Orders-SYNTHETIC.csv':f.orders,'PositionHistory-SYNTHETIC.csv':f.positions,'MarketBundle-SYNTHETIC.json':JSON.stringify(f.bundle,null,2),'IncompleteBundle-SYNTHETIC.json':JSON.stringify(incomplete,null,2),'ResearchStore-SYNTHETIC.json':JSON.stringify(store,null,2),'README.txt':`SYNTHETIC ONLY. No user trading data. Fixture anchor ${new Date(UI_T).toISOString()}. Flat confirmation and Hard End remain explicit UI actions.\n`};
await mkdir(dir,{recursive:true});
for(const [name,text] of Object.entries(files))await writeFile(resolve(dir,name),text,'utf8');
console.log(JSON.stringify({directory:dir,files:Object.keys(files),canonicalRecords:f.state.records.length,closedTrades:5,ambiguityCandidates:2},null,2));

// Static layout fixtures use the actual renderer/styles, no browser state or scripts.
// Interactive file/route QA is performed separately in the full localhost application.
const values=new Map(), storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const controller=createWorkbenchController({getIntraday:()=>f.state,storage});
for(const kind of ['fills','orders','positions'])controller.importFile(kind,f[kind]);
controller.confirmFlat(true);controller.importFile('bundle',JSON.stringify(f.bundle));controller.importStore(JSON.stringify(store));controller.select(f.ids.ES1);
const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
const head=index.slice(0,index.indexOf('</head>')).replace(/<script[\s\S]*?<\/script>/g,'');
const header=index.match(/<header class="page-head">[\s\S]*?<\/header>/)[0];
for(const match of index.matchAll(/href="([^"?]+\.css)\?/g))await writeFile(resolve(dir,match[1]),await readFile(new URL('../'+match[1],import.meta.url),'utf8'));
for(const theme of ['light','dark']){
 const html=head.replace('<html lang="zh-CN">',`<html lang="zh-CN" data-theme="${theme}">`)+`</head><body><main class="shell">${header}<p class="er-muted">SYNTHETIC · 静态布局检查；使用正式 renderer / CSS，交互另行在完整工作台验证。</p><section>${renderWorkbench(controller.snapshot())}</section></main></body></html>`;
 await writeFile(resolve(dir,`layout-${theme}.html`),html,'utf8');
}
