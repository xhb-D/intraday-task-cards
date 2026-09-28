import test from 'node:test';
import assert from 'node:assert/strict';
import { BIASES, DIRECTIONS, ORDER, SETUPS, STRUCTURES_3M, assertState, changeBias, changeDirection, changeStructure, chooseSetup, createWorkspace, deleteRecord, endOpportunity, markEntered, markExited, setStage, stateOf } from '../src/model.js';
import { deserialize, exportMarkdown, serialize, validateEnvelope } from '../src/persistence.js';

const T0 = 1_730_000_000_000;
const later = offset => T0 + offset;
const setupKeys = Object.keys(SETUPS);
const directionKeys = Object.keys(DIRECTIONS);
const biasKeys = Object.keys(BIASES);
const structureKeys = ['bullish', 'range', 'bearish'];

function fresh() { return createWorkspace(T0); }

function prepare(state, symbol = 'GC', { bias = 'neutral', structure = 'bullish', direction = 'long', type = 'mtf_pb', offset = 1 } = {}) {
  if (bias !== 'neutral') changeBias(state, symbol, bias, later(offset));
  changeStructure(state, symbol, structure, later(offset + 1));
  changeDirection(state, symbol, direction, later(offset + 2));
  return chooseSetup(state, symbol, type, later(offset + 3));
}

test('model: 三种偏见均独立允许做多、做空和暂无交易方向', () => {
  for (const bias of biasKeys) for (const direction of directionKeys) {
    const state = fresh();
    changeBias(state, 'GC', bias, later(1));
    const result = changeDirection(state, 'GC', direction, later(2));
    assert.equal(result.changed, direction !== 'none');
    assert.equal(state.cards.GC.bias, bias);
    assert.equal(state.cards.GC.direction, direction);
    assertState(state);
  }
});

test('model: 选择市场结构后，做多和做空均可选择三个新机会', () => {
  for (const structure of structureKeys) for (const direction of ['long', 'short']) for (const type of setupKeys) {
    const state = fresh();
    changeStructure(state, 'GC', structure, later(1));
    changeDirection(state, 'GC', direction, later(2));
    const result = chooseSetup(state, 'GC', type, later(3));
    assert.equal(result.changed, true, `${structure}/${direction}/${type}`);
    assert.equal(state.cards.GC.opportunity.type, type);
    assert.equal(state.records.length, 1);
    assertState(state);
  }
});

test('model: 暂无交易方向或未判断结构时不能登记机会', () => {
  const state = fresh();
  assert.equal(chooseSetup(state, 'GC', 'mtf_pb', later(1)).changed, false);
  changeDirection(state, 'GC', 'long', later(2));
  assert.equal(chooseSetup(state, 'GC', 'mtf_pb', later(3)).changed, false);
  assert.equal(state.records.length, 0);
  assertState(state);
});

test('model: 选择机会立即登记快照，重复选择同一机会无副作用', () => {
  const state = fresh();
  const first = prepare(state, 'GC', { bias: 'bearish', structure: 'range', direction: 'short', type: 'htf_pb' });
  const revision = state.revision;
  const id = state.cards.GC.opportunity.id;
  assert.equal(first.changed, true);
  assert.equal(state.records.length, 1);
  assert.deepEqual(state.records[0], state.cards.GC.opportunity);
  assert.equal(state.records[0].zone, null);
  assert.equal(state.records[0].biasAtRegistration, 'bearish');
  assert.equal(state.records[0].structure3mAtRegistration, 'range');
  assert.equal(state.records[0].direction, 'short');
  assert.equal(state.records[0].type, 'htf_pb');
  assert.equal(chooseSetup(state, 'GC', 'htf_pb', later(20)).changed, false);
  assert.equal(state.revision, revision);
  assert.equal(state.cards.GC.opportunity.id, id);
  assertState(state);
});

test('model: 同一商品切换机会先取消旧记录，再登记新记录', () => {
  const state = fresh();
  prepare(state, 'GC', { type: 'mtf_pb' });
  const oldId = state.cards.GC.opportunity.id;
  const switched = chooseSetup(state, 'GC', 'htf_bof', later(20));
  assert.equal(switched.changed, true);
  assert.equal(state.records.length, 2);
  assert.equal(state.records[0].id, oldId);
  assert.equal(state.records[0].reason, 'canceled');
  assert.equal(state.records[0].endedAt, later(20));
  assert.equal(state.records[1].type, 'htf_bof');
  assert.equal(state.records[1].endedAt, null);
  assert.equal(state.cards.GC.opportunity.id, state.records[1].id);
  assert.equal(Object.values(state.cards).filter(card => card.opportunity).length, 1);
  assertState(state);
});

test('model: 新机会无需关键位置即可等待、找信号、入场和平仓', () => {
  const state = fresh();
  prepare(state, 'CL', { type: 'htf_pb' });
  assert.equal(state.cards.CL.opportunity.zone, null);
  assert.equal(Object.hasOwn(state.cards.CL.opportunity, 'zoneDraft'), false);
  assert.equal(setStage(state, 'CL', 'signal', later(10)), true);
  assert.equal(markEntered(state, 'CL', later(11), true).changed, true);
  assert.equal(stateOf(state.cards.CL), 'position');
  assert.equal(markExited(state, 'CL', later(12), true).changed, true);
  assert.equal(state.cards.CL.opportunity, null);
  assert.equal(state.records[0].reason, 'closed');
  assert.equal(state.records[0].zone, null);
  assertState(state);
});

test('model: 活动机会改变方向需要确认；偏见和结构变化不再自动结束机会', () => {
  const state = fresh();
  prepare(state, 'ES', { bias: 'bullish', structure: 'bullish', direction: 'long', type: 'mtf_pb' });
  const id = state.cards.ES.opportunity.id;
  assert.deepEqual(changeDirection(state, 'ES', 'short', later(10)), { changed: false, needsConfirmation: true });
  assert.equal(changeBias(state, 'ES', 'bearish', later(11)).changed, true);
  assert.equal(changeStructure(state, 'ES', 'bearish', later(12)).changed, true);
  assert.equal(state.cards.ES.opportunity.id, id);
  const changed = changeDirection(state, 'ES', 'short', later(13), true);
  assert.equal(changed.changed, true);
  assert.equal(state.cards.ES.opportunity, null);
  assert.equal(state.records[0].reason, 'direction');
  assert.equal(state.cards.ES.direction, 'short');
  assertState(state);
});

test('model: 结束非持仓机会保留方向；删除历史不会复活活动机会', () => {
  const state = fresh();
  prepare(state, 'GC', { type: 'mtf_pb' });
  const id = state.cards.GC.opportunity.id;
  assert.equal(endOpportunity(state, 'GC', 'invalid', later(10)), true);
  assert.equal(state.cards.GC.direction, 'long');
  assert.equal(deleteRecord(state, id), true);
  assert.equal(state.cards.GC.opportunity, null);
  assert.equal(deleteRecord(state, id), false);
  assertState(state);
});

test('model: GC、CL、ES 状态和历史彼此隔离', () => {
  const state = fresh();
  prepare(state, 'GC', { type: 'mtf_pb' });
  prepare(state, 'CL', { direction: 'short', type: 'htf_pb', offset: 20 });
  assert.equal(state.cards.ES.opportunity, null);
  assert.equal(state.records.length, 2);
  assert.equal(state.cards.GC.opportunity.symbol, 'GC');
  assert.equal(state.cards.CL.opportunity.symbol, 'CL');
  assertState(state);
});

test('persistence: V4 当前状态往返，新历史记录导出关键位置为 —', () => {
  const state = fresh();
  prepare(state, 'GC', { type: 'htf_bof' });
  const raw = serialize(state, later(30));
  const restored = deserialize(raw);
  assert.equal(restored.schemaVersion, 4);
  assert.deepEqual(restored.state, state);
  assert.match(exportMarkdown(state, 'all', later(30)), /HTF BOF/);
  assert.match(exportMarkdown(state, 'all', later(30)), /—/);
  assertState(restored.state);
  assert.throws(() => validateEnvelope({ ...restored, schemaVersion: 3 }), /V4/);
});

test('model: 多次随机操作后仍满足 V4 状态不变量', () => {
  let state = fresh();
  let seed = 17;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 160; i += 1) {
    const symbol = ORDER[Math.floor(rand() * ORDER.length)];
    const time = later(100 + i);
    const action = Math.floor(rand() * 6);
    if (action === 0) changeBias(state, symbol, biasKeys[Math.floor(rand() * biasKeys.length)], time);
    if (action === 1) changeStructure(state, symbol, ['unjudged', ...structureKeys][Math.floor(rand() * 4)], time);
    if (action === 2) changeDirection(state, symbol, directionKeys[Math.floor(rand() * directionKeys.length)], time, true);
    if (action === 3) chooseSetup(state, symbol, setupKeys[Math.floor(rand() * setupKeys.length)], time);
    if (action === 4) setStage(state, symbol, ['wait', 'signal'][Math.floor(rand() * 2)], time);
    if (action === 5) {
      const card = state.cards[symbol];
      if (stateOf(card) !== 'position') markEntered(state, symbol, time, true);
      else markExited(state, symbol, time, true);
    }
    assertState(state);
  }
});
