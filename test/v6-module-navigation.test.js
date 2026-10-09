import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('index.html'),view=read('src/natural-chime/view.js'),risk=read('src/risk-manager-view.js'),css=read('natural-chime.css'),layout=read('refinement.css');
test('Module navigation: header title is home entry; centralized nav is absent; header tools retained',()=>{
  const header=html.match(/<header class="page-head">([^]*?)<\/header>/)[1];
  assert.match(header,/<h1><a class="home-title-link" href="#\/home" aria-label="返回日内交易状态卡">统一交易控制中心<\/a><\/h1>/);
  assert.doesNotMatch(header,/<nav|app-nav|href="#\/(?:risk|chime|exit-research)"/);
  for(const value of ['GC / CL / ES','本地记录 V6','appearance-select','save-status','data-tools'])assert.ok(header.includes(value));
  assert.match(read('appearance.css'),/\.home-title-link\{display:block;color:inherit;text-decoration:none\}/);
});
test('Module navigation: research entry is outside summary, visible with closed history; original Risk/Chime entries reused',()=>{
  const region=html.match(/<section class="history-module"[^]*?<\/details><\/section>/)[0];
  assert.match(region,/class="history-module-nav"><a class="module-link" href="#\/exit-research" aria-label="进入 Exit Research"><span class="module-link-full">进入 Exit Research →<\/span><span class="module-link-short" aria-hidden="true">研究 →<\/span><\/a>/);
  assert.doesNotMatch(region.match(/<summary>[^]*?<\/summary>/)[0],/<a\b/);
  assert.ok(region.indexOf('history-module-nav')<region.indexOf('<details'));
  assert.match(risk,/entry\.href = '#\/risk'; entry\.textContent = '进入 Trading Risk Manager →'/);
  assert.match(view,/settingsLink\.href = '#\/chime'/);
  assert.equal((html.match(/id="risk-dashboard-host"/g)||[]).length,1);
});
for(const route of ['risk','exit-research','chime','error'])test(`Module navigation: ${route} has an explicit hash return outside dynamic host`,()=>{
  const region=html.match(new RegExp(`<section data-route-view="${route}"[^]*?<\\/section>`))[0];
  assert.match(region,/href="#\/home"[^>]*>(?:← )?返回日内交易状态卡<\/a>/);
  if(route==='exit-research'||route==='chime')assert.ok(region.indexOf('返回日内交易状态卡')<region.indexOf('-host'));
});
test('Compact Chime: desktop groups and mobile wrapping retain complete warnings and safe controls',()=>{
  assert.match(view,/append\(modeRow, controlLabel\('本机报时方式', modeSelect, 'chime-mode-label'\), modeHint, setupButton\)/);
  assert.match(view,/append\(clockRow, clock, runtimeStatus\)/);
  assert.match(view,/append\(summary, clockRow, preferences, actions, message, periodFooter\)/);
  assert.match(css,/\.chime-mode-row\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css,/\.chime-panel \.chime-home-preferences\{display:flex;align-items:center;flex-wrap:wrap/);
  assert.match(css,/\.chime-panel \.chime-actions\{margin-top:0;flex-wrap:wrap;overflow:visible\}/);
  assert.match(css,/@media\(max-width:620px\)[^]*?\.chime-mode-row \.chime-message\{grid-column:1\/-1;grid-row:2\}/);
  assert.match(view,/当前后台运行状态未知；不会自动切换浏览器报时/);
  assert.match(view,/网页与助手配置不同；点击开始报时同步/);
  assert.match(view,/HTTPS 证书将在30天内到期/);
  assert.match(layout,/\.history-module-nav\{position:absolute;top:0;right:13px;min-height:40px\}/);
  assert.match(read('appearance.css'),/\.module-return:focus-visible\{outline:2px solid var\(--theme-accent\)/);
});


test('Mobile history research: shared themed border contains independent short entry; desktop label and placement retained',()=>{
  const mobile=layout.slice(layout.indexOf('@media(max-width:620px)',layout.indexOf('/* Local module navigation')));
  assert.match(mobile,/\.history-module\{margin-top:12px;border:1px solid var\(--border-primary\);border-radius:9px;background:var\(--bg-surface\);box-shadow:var\(--shadow-card\)\}/);
  assert.match(mobile,/\.history-module \.history\{margin-top:0;border:0;background:transparent;box-shadow:none\}/);
  assert.match(mobile,/\.history-module \.module-link-full\{display:none\}/);
  assert.match(mobile,/\.history-module \.module-link-short\{display:inline\}/);
  assert.match(mobile,/\.history-module \.history summary\{padding-right:65px;flex-wrap:wrap;gap:4px\}/);
  const desktop=layout.slice(0,layout.indexOf('@media(max-width:620px)',layout.indexOf('/* Local module navigation')));
  assert.match(desktop,/\.history-module-nav\{position:absolute;top:0;right:13px;min-height:40px;display:flex;align-items:center;z-index:1\}/);
  assert.match(desktop,/\.history-module \.module-link-short\{display:none\}/);
  assert.equal((html.match(/aria-label="进入 Exit Research"/g)||[]).length,1);
});
