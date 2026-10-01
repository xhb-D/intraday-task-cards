import test from 'node:test';
import assert from 'node:assert/strict';
import { BIASES, DIRECTIONS, SETUPS, STRUCTURES_3M, assertState, changeBias, changeDirection, changeStructure, chooseSetup, createWorkspace, holdingConflictWarning, isDirectionAllowed, isSetupAllowed, markEntered, markExited, stateOf } from '../src/model.js';
import { deserialize, exportMarkdown, serialize } from '../src/persistence.js';

const T0 = 1_740_000_000_000;
const time = offset => T0 + offset;

test('revision: 冻结文案和 opportunity key 使用新分类', () => {
  assert.deepEqual(BIASES, { bullish: '偏多', neutral: '无偏见', bearish: '偏空' });
  assert.deepEqual(DIRECTIONS, { long: '做多', short: '做空', none: '暂无交易方向' });
  assert.deepEqual(SETUPS, { mtf_pb: 'MTF PB', htf_pb: 'MTF BOF（趋势走弱 1次）', htf_bof: 'HTF BOF' });
  assert.equal(holdingConflictWarning(), '');
});

test('revision: 偏见与交易方向完全解耦', () => {
  for (const bias of Object.keys(BIASES)) for (const direction of Object.keys(DIRECTIONS)) assert.equal(isDirectionAllowed(bias, direction), true);
});

test('revision: 方向非暂无且市场结构已选时三个机会均允许', () => {
  for (const direction of ['long', 'short']) for (const structure of ['bullish', 'range', 'bearish']) for (const type of Object.keys(SETUPS)) {
    assert.equal(isSetupAllowed(direction, structure, type), true, `${direction}/${structure}/${type}`);
  }
  for (const type of Object.keys(SETUPS)) {
    assert.equal(isSetupAllowed('none', 'bullish', type), false);
    assert.equal(isSetupAllowed('long', 'unjudged', type), false);
  }
});

test('revision: 偏见或结构变化不再按旧矩阵自动失效活动机会', () => {
  const state = createWorkspace(T0);
  changeBias(state, 'GC', 'bullish', time(1));
  changeStructure(state, 'GC', 'bullish', time(2));
  changeDirection(state, 'GC', 'long', time(3));
  chooseSetup(state, 'GC', 'mtf_pb', time(4));
  const id = state.cards.GC.opportunity.id;
  changeBias(state, 'GC', 'bearish', time(5));
  changeStructure(state, 'GC', 'range', time(6));
  assert.equal(state.cards.GC.opportunity.id, id);
  assert.equal(state.records[0].endedAt, null);
  assertState(state);
});

test('revision: 平仓保留方向，活动机会仍只能由方向改变或显式结束结束', () => {
  const state = createWorkspace(T0);
  changeStructure(state, 'GC', 'bullish', time(1));
  changeDirection(state, 'GC', 'long', time(2));
  chooseSetup(state, 'GC', 'htf_pb', time(3));
  markEntered(state, 'GC', time(4), true);
  assert.equal(stateOf(state.cards.GC), 'position');
  assert.deepEqual(markExited(state, 'GC', time(5), true), { changed: true, directionReset: false });
  assert.equal(state.cards.GC.direction, 'long');
  assert.equal(state.cards.GC.opportunity, null);
  assertState(state);
});

test('revision: 交易方向快照和历史记录不因当前偏见变化而回写', () => {
  const state = createWorkspace(T0);
  changeBias(state, 'CL', 'bullish', time(1));
  changeStructure(state, 'CL', 'range', time(2));
  changeDirection(state, 'CL', 'short', time(3));
  chooseSetup(state, 'CL', 'htf_bof', time(4));
  changeBias(state, 'CL', 'neutral', time(5));
  assert.equal(state.records[0].biasAtRegistration, 'bullish');
  assert.equal(state.records[0].direction, 'short');
  assert.equal(state.cards.CL.opportunity.biasAtRegistration, 'bullish');
  assert.equal(state.cards.CL.opportunity.zone, null);
  assertState(state);
});

test('revision: 新机会阶段流转不需要关键位置字段', () => {
  const state = createWorkspace(T0);
  changeStructure(state, 'ES', 'bearish', time(1));
  changeDirection(state, 'ES', 'short', time(2));
  chooseSetup(state, 'ES', 'mtf_pb', time(3));
  state.cards.ES.opportunity.attention = 'wait';
  markEntered(state, 'ES', time(4), true);
  assert.equal(state.cards.ES.opportunity.zone, null);
  assert.equal(state.records[0].zone, null);
  assert.equal(stateOf(state.cards.ES), 'position');
  assertState(state);
});

test('revision: V4 序列化和 Markdown 使用新机会名', () => {
  const state = createWorkspace(T0);
  changeStructure(state, 'GC', 'bullish', time(1));
  changeDirection(state, 'GC', 'long', time(2));
  chooseSetup(state, 'GC', 'mtf_pb', time(3));
  const restored = deserialize(serialize(state, time(4))).state;
  assert.deepEqual(restored, state);
  const markdown = exportMarkdown(state, 'all', time(4));
  assert.match(markdown, /MTF PB/);
  assert.match(markdown, /做多/);
  assert.match(markdown, /—/);
  assert.doesNotMatch(markdown, /趋势回调/);
  assertState(restored);
});
