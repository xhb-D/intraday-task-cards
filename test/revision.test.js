import test from 'node:test';
import assert from 'node:assert/strict';
import { BIASES, STRUCTURES_3M, createWorkspace, assertState, changeBias, changeStructure, changeDirection, chooseSetup, updateDraft, confirmPosition, markEntered, markExited, stateOf } from '../src/model.js';
import { APP_ID, deserialize, exportMarkdown, makeEnvelope, serialize } from '../src/persistence.js';

let clock = 1_800_000_000_000;
const later = () => (clock += 1_000);
const fresh = () => createWorkspace(later());
function active(state, symbol = 'GC', structure = 'bullish', direction = 'long') {
  assert.equal(changeStructure(state, symbol, structure, later()).changed, true);
  assert.equal(changeDirection(state, symbol, direction, later()).changed, true);
  assert.equal(chooseSetup(state, symbol, 'pullback', later()).changed, true);
  return state.cards[symbol].opportunity;
}
function registered(state, symbol = 'GC', structure = 'bullish', direction = 'long') {
  active(state, symbol, structure, direction); updateDraft(state, symbol, '测试关键位置');
  assert.equal(confirmPosition(state, symbol, later()), true);
  return state.cards[symbol].opportunity;
}
function legacyEnvelope(state) {
  const envelope = makeEnvelope(state, later()); envelope.schemaVersion = 1; envelope.state.schemaVersion = 1;
  for (const card of Object.values(envelope.state.cards)) {
    delete card.bias; delete card.structure3m; delete card.needsStructureReview;
    if (card.opportunity) { delete card.opportunity.biasAtRegistration; delete card.opportunity.structure3mAtRegistration; delete card.opportunity.invalidReason; }
  }
  for (const record of envelope.state.records) { delete record.biasAtRegistration; delete record.structure3mAtRegistration; delete record.invalidReason; }
  return JSON.stringify(envelope);
}

test('revision: 偏见为独立三态，允许持仓期间更新且不改写方向、结构、机会', () => {
  const state = fresh(); const opportunity = registered(state); markEntered(state, 'GC', later(), true);
  const before = { direction: state.cards.GC.direction, structure: state.cards.GC.structure3m, id: opportunity.id, enteredAt: opportunity.enteredAt };
  assert.equal(changeBias(state, 'GC', 'neutral'), false); assert.equal(changeBias(state, 'GC', 'bullish'), true); assert.equal(changeBias(state, 'GC', 'bearish'), true);
  assert.equal(state.cards.GC.bias, 'bearish'); assert.deepEqual({ direction: state.cards.GC.direction, structure: state.cards.GC.structure3m, id: state.cards.GC.opportunity.id, enteredAt: state.cards.GC.opportunity.enteredAt }, before);
  assert.equal(state.cards.CL.bias, 'neutral'); assertState(state);
});

test('revision: 3M 结构矩阵在 UI 之外由业务层强制执行', () => {
  const expected = { unjudged: ['none'], bullish: ['long', 'none'], bearish: ['short', 'none'], range: ['long', 'short', 'none'] };
  for (const structure of Object.keys(STRUCTURES_3M)) {
    for (const direction of ['long', 'short', 'none']) {
      const state = fresh(); changeStructure(state, 'GC', structure, later());
      const result = changeDirection(state, 'GC', direction, later());
      assert.equal(state.cards.GC.direction, expected[structure].includes(direction) ? direction : 'none', `${structure}/${direction}`);
      assert.equal(result.reason === 'structure', !expected[structure].includes(direction), `${structure}/${direction} guard`);
      assertState(state);
    }
  }
});

test('revision: 无机会结构变更立即生效；不兼容方向自动归无，且不产生历史', () => {
  const state = fresh(); changeStructure(state, 'GC', 'bullish', later()); changeDirection(state, 'GC', 'long', later());
  assert.equal(changeStructure(state, 'GC', 'bearish', later()).changed, true);
  assert.equal(state.cards.GC.direction, 'none'); assert.equal(state.records.length, 0); assert.equal(stateOf(state.cards.GC), 'none'); assertState(state);
});

test('revision: 未入场活跃机会遇到不兼容结构需确认；确认后以结构变更失效', () => {
  const state = fresh(); const opportunity = registered(state); const recordId = state.records[0].id;
  const preview = changeStructure(state, 'GC', 'bearish', later());
  assert.equal(preview.needsConfirmation, true); assert.equal(state.cards.GC.opportunity.id, opportunity.id); assert.equal(state.cards.GC.structure3m, 'bullish');
  const result = changeStructure(state, 'GC', 'bearish', later(), true);
  assert.deepEqual(result, { changed: true, invalidated: true }); assert.equal(state.cards.GC.opportunity, null); assert.equal(state.cards.GC.direction, 'none');
  assert.equal(state.records[0].id, recordId); assert.equal(state.records[0].reason, 'invalid'); assert.equal(state.records[0].invalidReason, 'structure_change'); assertState(state);
});

test('revision: 持仓期间结构可冲突且不自动退出；平仓后重新校验方向', () => {
  const state = fresh(); registered(state); markEntered(state, 'GC', later(), true);
  assert.equal(changeStructure(state, 'GC', 'bearish', later()).changed, true); assert.equal(stateOf(state.cards.GC), 'position'); assert.equal(state.cards.GC.direction, 'long');
  assert.equal(markExited(state, 'GC', later(), true).changed, true); assert.equal(state.cards.GC.direction, 'none');
  const retained = fresh(); registered(retained); markEntered(retained, 'GC', later(), true); changeStructure(retained, 'GC', 'range', later()); markExited(retained, 'GC', later(), true);
  assert.equal(retained.cards.GC.direction, 'long'); assertState(state); assertState(retained);
});

test('revision: 未判断与不兼容结构不能创建机会；迁移审查完成前同样禁止执行', () => {
  const state = fresh(); assert.equal(chooseSetup(state, 'GC', 'pullback', later()).changed, false);
  changeStructure(state, 'GC', 'bullish', later()); assert.equal(changeDirection(state, 'GC', 'short', later()).reason, 'structure'); assert.equal(chooseSetup(state, 'GC', 'pullback', later()).changed, false);
  const oldActive = fresh(); active(oldActive); const migrated = deserialize(legacyEnvelope(oldActive)).state;
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.cards.GC.needsStructureReview, true); assert.equal(chooseSetup(migrated, 'GC', 'range', later()).changed, false);
  assert.equal(changeStructure(migrated, 'GC', 'bullish', later()).changed, true); assert.equal(migrated.cards.GC.needsStructureReview, false); assertState(migrated);
});

test('revision: 登记快照不可被随后偏见、结构或位置再确认改写，并在 JSON/Markdown 中保留', () => {
  const state = fresh(); const opportunity = registered(state); const snapshot = { bias: opportunity.biasAtRegistration, structure: opportunity.structure3mAtRegistration };
  changeBias(state, 'GC', 'bearish'); changeStructure(state, 'GC', 'range', later()); updateDraft(state, 'GC', '更新后的关键位置'); confirmPosition(state, 'GC', later());
  assert.deepEqual({ bias: opportunity.biasAtRegistration, structure: opportunity.structure3mAtRegistration }, snapshot); assert.deepEqual({ bias: state.records[0].biasAtRegistration, structure: state.records[0].structure3mAtRegistration }, snapshot);
  assert.deepEqual(deserialize(serialize(state, later())).state.records[0].biasAtRegistration, snapshot.bias); assert.match(exportMarkdown(state, 'all', later()), /登记时偏见 \/ 3M结构/); assertState(state);
});

test('revision: v1 迁移保留持仓和旧方向；无机会归无方向；旧活跃机会必须先审查结构', () => {
  const blank = fresh(); changeStructure(blank, 'CL', 'bullish', later()); changeDirection(blank, 'CL', 'long', later());
  const blankMigratedEnvelope = deserialize(legacyEnvelope(blank)); const blankMigrated = blankMigratedEnvelope.state; assert.equal(blankMigratedEnvelope.schemaVersion, 3); assert.equal(blankMigrated.cards.CL.bias, 'neutral'); assert.equal(blankMigrated.cards.CL.structure3m, 'unjudged'); assert.equal(blankMigrated.cards.CL.direction, 'none');
  const holding = fresh(); registered(holding); markEntered(holding, 'GC', later(), true); const heldMigrated = deserialize(legacyEnvelope(holding)).state;
  assert.equal(stateOf(heldMigrated.cards.GC), 'position'); assert.equal(heldMigrated.cards.GC.direction, 'long'); assert.equal(heldMigrated.cards.GC.structure3m, 'unjudged');
  const oldActive = fresh(); active(oldActive); const activeMigrated = deserialize(legacyEnvelope(oldActive)).state;
  assert.equal(activeMigrated.cards.GC.needsStructureReview, true); assert.equal(activeMigrated.cards.GC.opportunity.direction, 'long'); assert.equal(APP_ID, 'intraday-task-cards'); assertState(heldMigrated); assertState(activeMigrated);
});
