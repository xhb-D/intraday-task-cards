import test from 'node:test';
import assert from 'node:assert/strict';
import { BIASES, DIRECTIONS, STRUCTURES_3M, VISIBLE_STRUCTURES_3M, SETUPS, createWorkspace, assertState, changeBias, changeStructure, changeDirection, chooseSetup, updateDraft, confirmPosition, markEntered, markExited, stateOf, holdingConflictWarning, isDirectionAllowed, isSetupAllowed } from '../src/model.js';
import { deserialize, exportMarkdown, makeEnvelope, serialize } from '../src/persistence.js';

let clock = 1_800_000_000_000;
const later = () => (clock += 1_000);
const fresh = () => createWorkspace(later());
function active(state, symbol = 'GC', structure = 'bullish', direction = 'long', type = 'pullback') {
  assert.equal(changeStructure(state, symbol, structure, later()).changed, true);
  assert.equal(changeDirection(state, symbol, direction, later()).changed, true);
  assert.equal(chooseSetup(state, symbol, type, later()).changed, true);
  return state.cards[symbol].opportunity;
}
function registered(state, symbol = 'GC', structure = 'bullish', direction = 'long', type = 'pullback') {
  active(state, symbol, structure, direction, type); updateDraft(state, symbol, '测试关键位置');
  assert.equal(confirmPosition(state, symbol, later()), true);
  return state.cards[symbol].opportunity;
}
test('revision: 交易方向只由偏见约束，结构不会反向限制方向', () => {
  const expected = { bullish: ['long', 'none'], neutral: ['long', 'short', 'none'], bearish: ['short', 'none'] };
  for (const bias of Object.keys(BIASES)) for (const direction of Object.keys(DIRECTIONS)) {
    const state = fresh(); changeBias(state, 'GC', bias, later());
    const result = changeDirection(state, 'GC', direction, later());
    assert.equal(state.cards.GC.direction, expected[bias].includes(direction) ? direction : 'none', `${bias}/${direction}`);
    assert.equal(result.reason === 'bias', !expected[bias].includes(direction), `${bias}/${direction} guard`);
    assert.equal(isDirectionAllowed(bias, direction), expected[bias].includes(direction)); assertState(state);
  }
  const state = fresh(); changeBias(state, 'GC', 'bullish', later()); changeDirection(state, 'GC', 'long', later());
  assert.equal(changeStructure(state, 'GC', 'bearish', later()).changed, true); assert.equal(state.cards.GC.direction, 'long'); assertState(state);
});

test('revision: 方向与 3M 结构矩阵在业务层强制机会选择', () => {
  const expected = {
    long: { bullish: ['pullback', 'range'], range: ['range'], bearish: ['range', 'reversal'] },
    short: { bullish: ['range', 'reversal'], range: ['range'], bearish: ['pullback', 'range'] }
  };
  for (const [direction, structures] of Object.entries(expected)) for (const [structure, allowed] of Object.entries(structures)) for (const type of Object.keys(SETUPS)) {
    const state = fresh(); changeDirection(state, 'GC', direction, later()); changeStructure(state, 'GC', structure, later());
    const result = chooseSetup(state, 'GC', type, later());
    assert.equal(result.changed, allowed.includes(type), `${direction}/${structure}/${type}`);
    assert.equal(isSetupAllowed(direction, structure, type), allowed.includes(type)); assertState(state);
  }
  const blank = fresh(); assert.equal(chooseSetup(blank, 'GC', 'range', later()).changed, false);
  changeDirection(blank, 'GC', 'long', later()); assert.equal(chooseSetup(blank, 'GC', 'range', later()).changed, false);
  assert.equal(isSetupAllowed('long', 'unjudged', 'range'), false);
});

test('revision: 未入场结构变化先确认失效机会，但保留交易方向', () => {
  const state = fresh(); const opportunity = registered(state); const recordId = state.records[0].id;
  const preview = changeStructure(state, 'GC', 'bearish', later());
  assert.equal(preview.needsConfirmation, true); assert.equal(state.cards.GC.opportunity.id, opportunity.id);
  const result = changeStructure(state, 'GC', 'bearish', later(), true);
  assert.deepEqual(result, { changed: true, invalidated: true }); assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.GC.direction, 'long');
  assert.equal(state.records[0].id, recordId); assert.equal(state.records[0].reason, 'invalid'); assert.equal(state.records[0].invalidReason, 'structure_change'); assertState(state);
});

test('revision: 偏见冲突在未入场机会确认后失效并重置方向', () => {
  const state = fresh(); const opportunity = registered(state); const recordId = state.records[0].id;
  const preview = changeBias(state, 'GC', 'bearish', later());
  assert.equal(preview.needsConfirmation, true); assert.equal(state.cards.GC.bias, 'neutral'); assert.equal(state.cards.GC.opportunity.id, opportunity.id);
  const result = changeBias(state, 'GC', 'bearish', later(), true);
  assert.equal(result.changed, true); assert.equal(result.invalidated, true); assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.GC.direction, 'none');
  assert.equal(state.records[0].id, recordId); assert.equal(state.records[0].invalidReason, 'bias_change'); assertState(state);
});

test('revision: 持仓冲突只警告不自动退出，偏见冲突平仓后强制重选方向', () => {
  const state = fresh(); registered(state); markEntered(state, 'GC', later(), true);
  const result = changeBias(state, 'GC', 'bearish', later());
  assert.equal(result.changed, true); assert.equal(result.holdingConflict, true); assert.equal(stateOf(state.cards.GC), 'position');
  assert.match(holdingConflictWarning(state.cards.GC), /偏见与本笔方向冲突/);
  assert.deepEqual(markExited(state, 'GC', later(), true), { changed: true, directionReset: true }); assert.equal(state.cards.GC.direction, 'none'); assertState(state);
  const structureConflict = fresh(); registered(structureConflict); markEntered(structureConflict, 'GC', later(), true); changeStructure(structureConflict, 'GC', 'bearish', later());
  assert.match(holdingConflictWarning(structureConflict.cards.GC), /当前市场结构/); assert.deepEqual(markExited(structureConflict, 'GC', later(), true), { changed: true, directionReset: false });
  assert.equal(structureConflict.cards.GC.direction, 'long'); assertState(structureConflict);
});

test('revision: 未判断只作当前统一格式中的内部安全态，不提供可选结构', () => {
  assert.deepEqual(Object.keys(VISIBLE_STRUCTURES_3M), ['bullish', 'range', 'bearish']); assert.ok(STRUCTURES_3M.unjudged);
  assert.equal(STRUCTURES_3M.range, '震荡（观察拍卖完成）'); assert.equal(VISIBLE_STRUCTURES_3M.range, '震荡（观察拍卖完成）');
  const state = fresh(); changeDirection(state, 'GC', 'long', later()); assert.equal(state.cards.GC.structure3m, 'unjudged'); assert.equal(chooseSetup(state, 'GC', 'range', later()).changed, false);
  const restored = deserialize(JSON.stringify(makeEnvelope(state, later()))).state;
  assert.equal(restored.schemaVersion, 3); assert.equal(restored.cards.GC.structure3m, 'unjudged');
  assert.equal(chooseSetup(restored, 'GC', 'range', later()).changed, false); assert.equal(changeStructure(restored, 'GC', 'bullish', later()).changed, true); assertState(restored);
});

test('revision: 登记快照不可被随后偏见、结构或位置再确认改写，并在 JSON/Markdown 中保留', () => {
  const state = fresh(); const opportunity = registered(state); const snapshot = { bias: opportunity.biasAtRegistration, structure: opportunity.structure3mAtRegistration };
  changeBias(state, 'GC', 'bullish', later()); changeStructure(state, 'GC', 'range', later()); updateDraft(state, 'GC', '更新后的关键位置'); confirmPosition(state, 'GC', later());
  assert.deepEqual({ bias: opportunity.biasAtRegistration, structure: opportunity.structure3mAtRegistration }, snapshot); assert.deepEqual({ bias: state.records[0].biasAtRegistration, structure: state.records[0].structure3mAtRegistration }, snapshot);
  assert.deepEqual(deserialize(serialize(state, later())).state.records[0].biasAtRegistration, snapshot.bias); assert.match(exportMarkdown(state, 'all', later()), /登记时偏见 \/ 市场结构/); assertState(state);
  const rangeState = fresh(); registered(rangeState, 'GC', 'range', 'long', 'range'); const markdown = exportMarkdown(rangeState, 'all', later());
  assert.match(markdown, /市场结构：震荡 \|/); assert.doesNotMatch(markdown, /观察拍卖完成/);
});
