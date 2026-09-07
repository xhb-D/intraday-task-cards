import test from 'node:test';
import assert from 'node:assert/strict';
import { changeDirection, changeStructure, chooseSetup, confirmPosition, createWorkspace, recordSnapshot, updateDraft } from '../src/model.js';
import { deserialize, makeEnvelope, serialize } from '../src/persistence.js';

let clock = 1_900_000_000_000;
const later = () => (clock += 1_000);

function registeredWorkspace() {
  const state = createWorkspace(later());
  changeStructure(state, 'GC', 'bullish', later());
  changeDirection(state, 'GC', 'long', later());
  chooseSetup(state, 'GC', 'pullback', later());
  updateDraft(state, 'GC', '3535–3540 / 3M FVG');
  confirmPosition(state, 'GC', later());
  return state;
}

function v2Envelope(state) {
  const envelope = makeEnvelope(state, later());
  envelope.schemaVersion = 2;
  envelope.state.schemaVersion = 2;
  return envelope;
}

function setLegacyTimeline(envelope, stages, attention) {
  const opportunity = envelope.state.cards.GC.opportunity;
  opportunity.stages = stages;
  opportunity.attention = attention;
  opportunity.stageSince = stages.at(-1).start;
  envelope.state.records[0] = recordSnapshot(opportunity);
}

test('v3 migration: v2 wait → near → signal maps and merges without losing active-record identity', () => {
  const envelope = v2Envelope(registeredWorkspace());
  const [first, second, third] = [later(), later(), later()];
  setLegacyTimeline(envelope, [
    { state: 'wait', start: first, end: second },
    { state: 'near', start: second, end: third },
    { state: 'signal', start: third, end: null }
  ], 'signal');
  const restored = deserialize(JSON.stringify(envelope));
  const opportunity = restored.state.cards.GC.opportunity;
  assert.equal(restored.schemaVersion, 3); assert.equal(restored.state.schemaVersion, 3);
  assert.deepEqual(opportunity.stages, [{ state: 'wait', start: first, end: third }, { state: 'signal', start: third, end: null }]);
  assert.equal(opportunity.stageSince, third); assert.equal(opportunity.attention, 'signal');
  assert.deepEqual(restored.state.records[0], recordSnapshot(opportunity));
  assert.deepEqual({ id: opportunity.id, direction: opportunity.direction, type: opportunity.type, zone: opportunity.zone, bias: opportunity.biasAtRegistration, structure: opportunity.structure3mAtRegistration }, {
    id: envelope.state.cards.GC.opportunity.id, direction: 'long', type: 'pullback', zone: '3535–3540 / 3M FVG', bias: 'neutral', structure: 'bullish'
  });
});

test('v3 migration: v2 signal → near → wait maps and merges to one final wait stage', () => {
  const envelope = v2Envelope(registeredWorkspace());
  const [first, second, third] = [later(), later(), later()];
  setLegacyTimeline(envelope, [
    { state: 'signal', start: first, end: second },
    { state: 'near', start: second, end: third },
    { state: 'wait', start: third, end: null }
  ], 'wait');
  const restored = deserialize(JSON.stringify(envelope));
  const opportunity = restored.state.cards.GC.opportunity;
  assert.deepEqual(opportunity.stages, [{ state: 'signal', start: first, end: second }, { state: 'wait', start: second, end: null }]);
  assert.equal(opportunity.stageSince, second); assert.deepEqual(restored.state.records[0], recordSnapshot(opportunity));
});

test('v3 migration: active v2 near maps its open final segment and matching record to wait', () => {
  const envelope = v2Envelope(registeredWorkspace());
  const [first, second] = [later(), later()];
  setLegacyTimeline(envelope, [
    { state: 'signal', start: first, end: second },
    { state: 'near', start: second, end: null }
  ], 'near');
  const before = envelope.state.cards.GC.opportunity;
  const restored = deserialize(JSON.stringify(envelope));
  const opportunity = restored.state.cards.GC.opportunity;
  assert.equal(opportunity.attention, 'wait'); assert.equal(opportunity.stageSince, second);
  assert.deepEqual(opportunity.stages, [{ state: 'signal', start: first, end: second }, { state: 'wait', start: second, end: null }]);
  assert.equal(opportunity.id, before.id); assert.equal(opportunity.zone, before.zone);
  assert.deepEqual(restored.state.records[0], recordSnapshot(opportunity));
});

test('v3 migration: valid v3 round-trip is unchanged and an illegal near stage is rejected', () => {
  const state = registeredWorkspace();
  const raw = serialize(state, later());
  assert.deepEqual(deserialize(raw).state, state);
  const invalid = makeEnvelope(state, later());
  invalid.state.cards.GC.opportunity.stages[0].state = 'near';
  assert.throws(() => deserialize(JSON.stringify(invalid)), error => error.code === 'STATE_VALIDATION_ERROR');
});
