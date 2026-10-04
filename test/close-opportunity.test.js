import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace, changeStructure, changeDirection, chooseSetup, setStage,
  markEntered, markExited, endOpportunity, assertState,
  recordInitialStop, correctInitialStop, recordBofToPb, revertBofToPb
} from '../src/model.js';

const T = 1000;
function opportunity(stage = 'position') {
  const state = createWorkspace(T);
  changeStructure(state, 'GC', 'range', T + 1);
  changeDirection(state, 'GC', 'long', T + 2);
  chooseSetup(state, 'GC', 'htf_pb', T + 3);
  if (stage === 'signal') setStage(state, 'GC', 'signal', T + 6);
  if (stage === 'position') markEntered(state, 'GC', T + 10, true);
  assertState(state);
  return state;
}
function rejectsWithoutMutation(state, action) {
  const before = structuredClone(state);
  assert.throws(action, /结束机会时间无效/);
  assert.deepEqual(state, before);
  assertState(state);
}
function capture(state) {
  recordInitialStop(state, 'GC', 3974, T + 12);
  recordBofToPb(state, 'GC', T + 15);
  correctInitialStop(state, 'GC', 3973.5, T + 20);
  revertBofToPb(state, 'GC', T + 30);
}

test('Close preflight: exit before latest manual event rejects with state unchanged and valid', () => {
  const state = opportunity();
  capture(state);
  rejectsWithoutMutation(state, () => markExited(state, 'GC', T + 25, true));
});

test('Close preflight: exit before position stage start rejects with state unchanged and valid', () => {
  const state = opportunity();
  rejectsWithoutMutation(state, () => markExited(state, 'GC', T + 9, true));
});

test('Close preflight: legal exit at or after latest event preserves complete capture and behavior', () => {
  for (const closeTime of [T + 30, T + 31]) {
    const state = opportunity();
    capture(state);
    const before = structuredClone(state.cards.GC.opportunity);
    const revision = state.revision;
    assert.deepEqual(markExited(state, 'GC', closeTime, true), { changed: true, directionReset: false });
    assert.equal(state.cards.GC.opportunity, null);
    assert.equal(state.cards.GC.direction, 'long');
    assert.equal(state.cards.GC.idleSince, closeTime);
    assert.equal(state.revision, revision + 1);
    const expected = structuredClone(before);
    expected.stages.at(-1).end = closeTime;
    expected.endedAt = closeTime;
    expected.reason = 'closed';
    assert.deepEqual(state.records[0], expected);
    assertState(state);
  }
});

test('Close preflight: non-integer, non-finite and non-number exit times reject without mutation', () => {
  for (const closeTime of [NaN, Infinity, -Infinity, -1, T + 10.5, Number.MAX_SAFE_INTEGER + 1, '1030', null]) {
    const state = opportunity();
    rejectsWithoutMutation(state, () => markExited(state, 'GC', closeTime, true));
  }
});

const endings = [
  { name: 'canceled', reason: 'canceled', action: (state, time) => endOpportunity(state, 'GC', 'canceled', time) },
  { name: 'invalid', reason: 'invalid', action: (state, time) => endOpportunity(state, 'GC', 'invalid', time) },
  { name: 'direction-change', reason: 'direction', action: (state, time) => changeDirection(state, 'GC', 'short', time, true) },
  { name: 'setup-replacement', reason: 'canceled', action: (state, time) => chooseSetup(state, 'GC', 'htf_bof', time) }
];
for (const stage of ['wait', 'signal']) {
  for (const ending of endings) {
    test(`Close preflight: ${ending.name} from ${stage} rejects backwards time atomically and accepts stage start`, () => {
      const state = opportunity(stage);
      const closeTime = state.cards.GC.opportunity.stages.at(-1).start;
      rejectsWithoutMutation(state, () => ending.action(state, closeTime - 1));
      const revision = state.revision;
      ending.action(state, closeTime);
      assert.equal(state.records[0].reason, ending.reason);
      assert.equal(state.records[0].endedAt, closeTime);
      assert.equal(state.records[0].stages.at(-1).end, closeTime);
      assert.equal(state.revision, revision + 1);
      assertState(state);
    });
  }
}
