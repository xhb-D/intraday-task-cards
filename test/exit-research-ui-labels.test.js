import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { renderWorkbench, describeTrace, formatExcursion } from '../src/exit-research/ui/render.js';
import { REPLAY_TRACE_TYPES } from '../src/exit-research/replay-trace.js';
import { POLICIES_V1 } from '../src/exit-research/policies-v1.js';
import { POLICY_LABELS, TRACE_EVENT_LABELS } from '../src/exit-research/ui/labels.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
function prepared(id='GC0') {
  const f=workbenchFixture(), values=new Map(), c=createWorkbenchController({getIntraday:()=>f.state,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)}});
  for(const kind of ['fills','orders','positions'])c.importFile(kind,f[kind]);
  c.confirmFlat(true);c.importFile('bundle',JSON.stringify(f.bundle));c.select(f.ids[id]);
  c.setReplaySettings(f.ids[id],{replayHardEndAt:UI_T+(id==='ES1'?3600000:0)+4*UI_P,executionTickSize:.1});
  return {f,c};
}
// All <details> are initially closed. Remove their bodies, then attributes/tags,
// so assertions concern user-visible text rather than stable data attributes.
function mainText(html) {
  let depth=0,end=0,out='';
  for(const m of html.matchAll(/<details\b[^>]*>|<\/details>/g)) {
    if(depth===0)out+=html.slice(end,m.index);
    if(m[0].startsWith('</'))depth--;else depth++;
    end=m.index+m[0].length;
  }
  return (out+html.slice(end)).replace(/<[^>]+>/g,' ');
}
for(const [status,allowed] of [['MATCHED',false],['REVIEW_REQUIRED',true],['MATCH_AMBIGUOUS',true],['NO_MATCH',false],['DATA_CONFLICT',false]]) {
  test(`S5A ZH candidate actions ${status}: ${allowed?'available':'absent'}`,()=>{
    const {c}=prepared('GC3'),model=c.snapshot();model.selected.matchingStatus=status;
    const html=renderWorkbench(model);
    assert.equal(html.includes('data-er-action="confirm"'),allowed);
    assert.equal(html.includes('data-er-action="reject"'),allowed);
    assert.equal(mainText(html).includes('确认是这笔'),allowed);
    assert.equal(mainText(html).includes('排除这笔'),allowed);
    if(allowed){assert.match(html,/候选成交 1/);assert.match(html,/合约：MGCZ9/);}
  });
}
test('S5A ZH automatic match replaces candidates with folded evidence',()=>{
  const {c}=prepared(),html=renderWorkbench(c.snapshot());
  assert.match(html,/自动匹配成功/);assert.match(html,/<summary>查看匹配依据<\/summary>/);
  for(const text of ['品种一致','方向一致','入场时间差','平仓时间差','一对一匹配','0 秒'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/候选成交|data-er-action="confirm"|data-er-action="reject"/);
});
test('S5A ZH manually confirmed MATCHED also has no candidate actions',()=>{
  const {f,c}=prepared('GC3'),t=c.snapshot().selected;c.decide('confirm',f.ids.GC3,t.candidates[0].logicalTradeId);
  const html=renderWorkbench(c.snapshot());assert.match(html,/人工确认匹配/);assert.doesNotMatch(html,/data-er-action="confirm"|data-er-action="reject"/);
});
test('S5A ZH main facts and replay labels contain no internal field names or codes',()=>{
  const {c}=prepared(),html=renderWorkbench(c.snapshot()),text=mainText(html);
  for(const value of ['registeredAt','taskEntryConfirmedAt','taskExitConfirmedAt','Simulated Exit R','Max Known MFE','Lookahead QA','Execution QA','PB_BASELINE_V1','STOP_TRIGGERED','READY','REVIEW_REQUIRED','BLOCKED','LONG','mtf_pb'])assert.ok(!text.includes(value),value);
  for(const value of ['机会登记时间','HTML 入场确认','HTML 平仓确认','真实入场时间','真实平仓时间','真实入场价','真实平仓价','数量','初始风险（1R）','成交数据核验','PB 基准管理 V1','模拟退出','退出原因','最大已确认 MFE','前视检查','可正式比较','GC · 做多'])assert.ok(text.includes(value),value);
  for(const value of ['registeredAt','PB_BASELINE_V1','STOP_TRIGGERED','lookaheadQaStatus','matchingReasons','sourceRows'])assert.ok(html.includes(value),value);
  assert.doesNotMatch(html,/<h4>PB_BASELINE_V1/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
});
test('S5A ZH preparation and quality explanations are plain Chinese',()=>{
  const {c}=prepared(),html=renderWorkbench(c.snapshot()),text=mainText(html);
  for(const word of ['HTML 交易记录','Tradovate 成交数据','入场类型','数据状态','导出研究设置','导入研究设置','研究交易 · 4','初始止损','真实入场','用真实交易和历史行情比较不同退出管理方式。'])assert.ok(text.includes(word),word);
  assert.doesNotMatch(text,/Task Card|Research Store|Logical Trades|Flat|不是程序故障|WINDOW_START_FLAT_UNCONFIRMED/);
});
test('S5A ZH all frozen policy IDs map to human headings and retain IDs only in technical details',()=>{
  assert.deepEqual(Object.keys(POLICY_LABELS).sort(),Object.keys(POLICIES_V1).sort());
  const {c}=prepared('ES1'),html=renderWorkbench(c.snapshot());
  for(const name of ['BOF 基准管理 V1','BOF 紧保护 V1','BOF 固定上限 V1','按实际人工管理','始终按原始 Setup 管理'])assert.ok(mainText(html).includes(name));
  assert.doesNotMatch(mainText(html),/BOF_BASELINE_V1|FIXED_INITIAL_SETUP|MANUAL_ACTUAL/);
});
test('S5A ZH all frozen trace events translate, including policy switch back to BOF',()=>{
  assert.deepEqual(Object.keys(TRACE_EVENT_LABELS).sort(),[...REPLAY_TRACE_TYPES].sort());
  assert.equal(describeTrace({type:'MILESTONE_REACHED',milestoneR:6}),'达到 6R');
  assert.equal(describeTrace({type:'POLICY_SWITCH_EFFECTIVE',policyId:'PB_BASELINE_V1'}),'PB 管理正式生效');
  assert.equal(describeTrace({type:'POLICY_SWITCH_EFFECTIVE',policyId:'BOF_BASELINE_V1'}),'BOF 管理正式生效');
  const {c}=prepared('ES1'),html=renderWorkbench(c.snapshot());
  assert.match(html,/人工判断 BOF → PB/);assert.match(html,/新保护位生效/);
  assert.doesNotMatch(html,/reason code \/ 时序证据/);assert.match(html,/<summary>技术详情<\/summary>/);
});
test('S5A ZH excursion bounds and missing upper bound keep their numeric meanings',()=>{
  assert.equal(formatExcursion({confirmedR:8.4,possibleMaxR:8.5,exact:false}),'已确认：至少 8.4R / 可能最高：8.5R');
  assert.equal(formatExcursion({confirmedR:8.4,possibleMaxR:8.4,exact:true}),'已确认：8.4R');
  assert.equal(formatExcursion({confirmedR:4,possibleMaxR:null,exact:false}),'已确认：至少 4R / 数据不足，可能最高值未知');
});
test('S5A ZH error codes and imported error text stay escaped in technical details',()=>{
  const {c}=prepared(),m=c.snapshot();m.message='处理未完成：<img src=x onerror=alert(1)> SOME_INTERNAL_ERROR';m.storeError='RESEARCH_STORE_CHANGED';
  const html=renderWorkbench(m),text=mainText(html);assert.doesNotMatch(text,/SOME_INTERNAL_ERROR|RESEARCH_STORE_CHANGED|<img/);assert.match(text,/处理未完成，请核对输入资料/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
test('S5A ZH CSS every selector including media and comma groups is root scoped',()=>{
  const css=readFileSync(new URL('../exit-research.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
  let count=0;
  for(const m of css.matchAll(/([^{}]+)\{/g)){
    if(m[1].trim().startsWith('@'))continue;
    for(const selector of m[1].split(',')){assert.match(selector.trim(),/^\.er-workbench(?:\b|\s|[.:[])/,selector);count++;}
  }
  assert.ok(count>70);
});
