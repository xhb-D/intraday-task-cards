import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspace, assertState, stateOf, changeStructure, changeDirection, chooseSetup, updateDraft, confirmPosition, setStage, markEntered, markExited, endOpportunity, deleteRecord, registrationStatus } from '../src/model.js';
import { deserialize, exportMarkdown, makeEnvelope, serialize, validateEnvelope } from '../src/persistence.js';

let time = 1_700_000_000_000;
const later = () => (time += 1_000);
const fresh = () => createWorkspace(later());
function setup(state, symbol = 'GC', direction = 'long', type = 'pullback') {
  assert.equal(changeStructure(state, symbol, direction === 'long' ? 'bullish' : 'bearish', later()).changed, true);
  assert.equal(changeDirection(state, symbol, direction, later()).changed, true);
  assert.equal(chooseSetup(state, symbol, type, later()).changed, true);
  return state.cards[symbol].opportunity;
}
function registered(state, symbol = 'GC', value = '3535–3540 / 3M FVG + VWMA') {
  setup(state, symbol); updateDraft(state, symbol, value); assert.equal(confirmPosition(state, symbol, later()), true);
  return state.records.at(-1);
}

test('A: GC、CL、ES 完全隔离，单卡持仓不锁住其他卡', () => {
  const state = fresh(); setup(state, 'GC'); setup(state, 'CL', 'short', 'range');
  const esBefore = JSON.stringify(state.cards.ES); markEntered(state, 'GC', later(), true);
  assert.equal(stateOf(state.cards.GC), 'position'); assert.equal(stateOf(state.cards.CL), 'wait'); assert.equal(JSON.stringify(state.cards.ES), esBefore);
  assert.equal(setStage(state, 'CL', 'signal', later()), true); assert.equal(stateOf(state.cards.CL), 'signal'); assertState(state);
});

test('B: 方向空机会一次完成；已选无副作用；活跃机会需确认并可正确结束', () => {
  const state = fresh(); const revision = state.revision;
  assert.equal(changeStructure(state, 'GC', 'bullish', later()).changed, true); assert.equal(changeDirection(state, 'GC', 'long', later()).changed, true); const after = state.revision;
  assert.equal(changeDirection(state, 'GC', 'long', later()).changed, false); assert.equal(state.revision, after); assert.equal(chooseSetup(state, 'GC', 'pullback', later()).changed, true);
  assert.equal(changeStructure(state, 'GC', 'range', later()).changed, true); assert.equal(changeDirection(state, 'GC', 'short', later()).needsConfirmation, true); assert.equal(stateOf(state.cards.GC), 'wait');
  assert.equal(changeDirection(state, 'GC', 'short', later(), true).changed, true); assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.GC.direction, 'short'); assert.ok(state.revision > revision); assertState(state);
});

test('C: 建立机会进入等待、不自动登记；切换类型取消旧机会；重复点击不重置计时', () => {
  const state = fresh(); setup(state); const first = state.cards.GC.opportunity; const since = first.stageSince;
  assert.equal(state.records.length, 0); assert.equal(stateOf(state.cards.GC), 'wait'); assert.equal(chooseSetup(state, 'GC', 'pullback', later()).changed, false); assert.equal(state.cards.GC.opportunity.stageSince, since);
  assert.equal(chooseSetup(state, 'GC', 'range', later()).changed, true); assert.equal(state.records.length, 0); assert.notEqual(state.cards.GC.opportunity.id, first.id); assertState(state);
});

test('D: 草稿、明确登记、确认更新同一记录和阶段时间', () => {
  const state = fresh(); setup(state); const started = state.cards.GC.opportunity.stageSince;
  assert.equal(updateDraft(state, 'GC', '  3535–3540  '), true); assert.equal(state.records.length, 0); assert.equal(registrationStatus(state, 'GC').enabled, true);
  assert.equal(confirmPosition(state, 'GC', later()), true); const id = state.records[0].id; assert.equal(state.records[0].zone, '3535–3540'); assert.equal(state.cards.GC.opportunity.stageSince, started);
  updateDraft(state, 'GC', '3540–3545'); assert.equal(state.records[0].zone, '3535–3540'); assert.equal(registrationStatus(state, 'GC').kind, 'dirty');
  assert.equal(confirmPosition(state, 'GC', later()), true); assert.equal(state.records.length, 1); assert.equal(state.records[0].id, id); assert.equal(state.records[0].zone, '3540–3545'); assert.equal(state.cards.GC.opportunity.stageSince, started); assertState(state);
});

test('D: 空白关键位置不能登记，失焦或切阶段不会登记', () => {
  const state = fresh(); setup(state); assert.equal(confirmPosition(state, 'GC', later()), false); setStage(state, 'GC', 'signal', later()); assert.equal(state.records.length, 0); updateDraft(state, 'GC', '   '); assert.equal(confirmPosition(state, 'GC', later()), false); assertState(state);
});

test('E: 等待与找信号可直接双向切换，重复不会重置计时', () => {
  const state = fresh(); setup(state); assert.equal(setStage(state, 'GC', 'signal', later()), true); const signalSince = state.cards.GC.opportunity.stageSince;
  assert.equal(setStage(state, 'GC', 'signal', later()), false); assert.equal(state.cards.GC.opportunity.stageSince, signalSince); assert.equal(setStage(state, 'GC', 'wait', later()), true); const waitSince = state.cards.GC.opportunity.stageSince;
  assert.equal(setStage(state, 'GC', 'wait', later()), false); assert.equal(state.cards.GC.opportunity.stageSince, waitSince); assert.equal(setStage(state, 'GC', 'signal', later()), true); assert.throws(() => setStage(state, 'GC', 'near', later())); assertState(state);
});

test('F: 未登记的失效和放弃不生成历史，且只影响目标卡', () => {
  const state = fresh(); setup(state, 'GC'); setup(state, 'CL', 'short'); assert.equal(endOpportunity(state, 'GC', 'invalid', later()), true);
  assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.CL.opportunity.type, 'pullback'); assert.equal(state.records.length, 0); assert.equal(endOpportunity(state, 'CL', 'canceled', later()), true); assert.equal(state.records.length, 0); assertState(state);
});

test('G/H: 入场需要确认、同一记录更新、未登记入场不补登记，并锁住该卡', () => {
  const state = fresh(); const record = registered(state); assert.equal(markEntered(state, 'GC', later()).needsConfirmation, true); assert.equal(stateOf(state.cards.GC), 'wait');
  assert.equal(markEntered(state, 'GC', later(), true).changed, true); assert.equal(stateOf(state.cards.GC), 'position'); assert.equal(state.records.length, 1); assert.equal(state.records[0].id, record.id); assert.notEqual(state.records[0].enteredAt, null);
  assert.equal(changeDirection(state, 'GC', 'short', later()).reason, 'holding'); assert.equal(chooseSetup(state, 'GC', 'range', later()).changed, false); assert.equal(endOpportunity(state, 'GC', 'invalid', later()), false);
  const another = fresh(); setup(another); markEntered(another, 'GC', later(), true); assert.equal(another.records.length, 0); assertState(state); assertState(another);
});

test('I: 平仓需要确认，更新同一记录，清空 active opportunity、位置并保留方向', () => {
  const state = fresh(); const record = registered(state); markEntered(state, 'GC', later(), true); assert.equal(markExited(state, 'GC', later()).needsConfirmation, true); assert.equal(stateOf(state.cards.GC), 'position');
  assert.equal(markExited(state, 'GC', later(), true).changed, true); assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.GC.direction, 'long'); assert.equal(stateOf(state.cards.GC), 'none'); assert.equal(state.records.length, 1); assert.equal(state.records[0].id, record.id); assert.equal(state.records[0].reason, 'closed'); assertState(state);
});

test('J: 删除记录不改变当前任务；普通状态、入场和平仓都不复活；明确重新登记才恢复', () => {
  const state = fresh(); const record = registered(state); const id = record.id; assert.equal(deleteRecord(state, id), true); assert.equal(state.records.length, 0); assert.equal(state.cards.GC.opportunity.id, id);
  setStage(state, 'GC', 'signal', later()); markEntered(state, 'GC', later(), true); assert.equal(state.records.length, 0); markExited(state, 'GC', later(), true); assert.equal(state.records.length, 0);
  const second = fresh(); registered(second); const active = second.cards.GC.opportunity; deleteRecord(second, active.id); updateDraft(second, 'GC', '3600–3605'); assert.equal(confirmPosition(second, 'GC', later()), true); assert.equal(second.records.length, 1); assert.equal(second.records[0].id, active.id); assertState(state); assertState(second);
});

test('K/L: 序列化恢复草稿、状态、持仓和历史；导入验证失败不被接受；Markdown 纯导出', () => {
  const state = fresh(); setup(state); updateDraft(state, 'GC', '未确认草稿'); setStage(state, 'GC', 'signal', later()); registered(state, 'CL'); markEntered(state, 'CL', later(), true);
  const before = JSON.stringify(state); const raw = serialize(state, later()); const restored = deserialize(raw); assert.deepEqual(restored.state, JSON.parse(before)); assert.equal(stateOf(restored.state.cards.GC), 'signal'); assert.equal(restored.state.cards.GC.opportunity.zoneDraft, '未确认草稿'); assert.equal(restored.state.records.length, 1); assert.equal(stateOf(restored.state.cards.CL), 'position');
  assert.throws(() => deserialize('{"app":"bad"}')); const markdown = exportMarkdown(state, 'all', later()); assert.match(markdown, /登记时偏见/); assert.equal(JSON.stringify(state), before); assert.throws(() => validateEnvelope({ ...makeEnvelope(state), schemaVersion: 4 }));
});

test('M: 静态 UI 合约固定 GC → CL → ES 三卡，并为入场/平仓保留不同操作行', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(app, /ORDER\.map\(renderCard\)/); assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  const refinement = readFileSync(new URL('../refinement.css', import.meta.url), 'utf8');
  assert.match(app, /当前偏见/); assert.match(app, /当前 15M 市场结构/); assert.match(app, /交易方向/); assert.match(app, /disabled aria-disabled="true"/);
  assert.match(app, /let stages = '<div class="empty"[^]*?if \(opportunity && !holding\)[^]*?else if \(holding\) ending/);
  assert.match(refinement, /grid-template-rows:31px 43px 43px 49px 98px 112px 34px 36px 34px/);
  assert.match(refinement, /\.card \.field-label\{margin-bottom:5px;font-size:10px;line-height:12px/);
  assert.match(css, /\.stage-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:5px\}/);
  assert.match(refinement, /\.option:disabled\{cursor:not-allowed/); assert.match(refinement, /\.card \.task\{display:flex/);
});

test('N: 1,000 次随机操作后始终满足不变量、身份唯一和跨卡隔离边界', () => {
  const state = fresh(); let seed = 1337; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 1000; i += 1) {
    const symbol = ['GC', 'CL', 'ES'][Math.floor(rand() * 3)]; const action = Math.floor(rand() * 10); const card = state.cards[symbol];
    if (action === 0) changeStructure(state, symbol, ['unjudged', 'bullish', 'range', 'bearish'][Math.floor(rand() * 4)], later(), true);
    if (action === 1) changeDirection(state, symbol, ['none', 'long', 'short'][Math.floor(rand() * 3)], later(), true);
    if (action === 2) chooseSetup(state, symbol, ['pullback', 'range', 'reversal'][Math.floor(rand() * 3)], later());
    if (action === 3) updateDraft(state, symbol, `Z${i}`);
    if (action === 4 && card.opportunity) confirmPosition(state, symbol, later());
    if (action === 5) setStage(state, symbol, ['wait', 'signal'][Math.floor(rand() * 2)], later());
    if (action === 6) markEntered(state, symbol, later(), true);
    if (action === 7) markExited(state, symbol, later(), true);
    if (action === 8) endOpportunity(state, symbol, rand() > .5 ? 'invalid' : 'canceled', later());
    if (action === 9 && state.records.length) deleteRecord(state, state.records[Math.floor(rand() * state.records.length)].id);
    assertState(state); assert.equal(new Set(state.records.map(record => record.id)).size, state.records.length);
  }
});
