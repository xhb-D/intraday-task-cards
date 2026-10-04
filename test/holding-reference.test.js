import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, changeDirection, changeStructure, chooseSetup, setStage, markEntered, recordInitialStop, recordBofToPb, revertBofToPb, stateOf, assertState, SCHEMA_VERSION } from '../src/model.js';
import { serialize, deserialize, makeEnvelope } from '../src/persistence.js';
import { makeUnified, validateUnified } from '../src/unified-persistence.js';
import { HOLDING_REFERENCE_V1, managementReferenceFor, renderHoldingReference } from '../src/holding-reference.js';

function referenceState(type, status) {
  const state = createWorkspace(1);
  changeDirection(state, 'GC', 'long', 2);
  changeStructure(state, 'GC', 'range', 3);
  if (type) chooseSetup(state, 'GC', type, 4);
  if (status === 'signal') setStage(state, 'GC', status, 5);
  if (status === 'position') markEntered(state, 'GC', 6, true);
  return state;
}

const cases = [
  ['none with direction only', null, 'none', null],
  ['wait MTF PB', 'mtf_pb', 'wait', 'PB'],
  ['signal MTF PB', 'mtf_pb', 'signal', 'PB'],
  ['wait MTF BOF', 'htf_pb', 'wait', 'BOF'],
  ['signal HTF BOF', 'htf_bof', 'signal', 'BOF'],
  ['position PB', 'mtf_pb', 'position', 'PB'],
  ['position BOF', 'htf_pb', 'position', 'BOF']
];
for (const [name, type, status, management] of cases) {
  test(`Holding reference: ${name}`, () => {
    const state = referenceState(type, status);
    const opportunity = state.cards.GC.opportunity;
    assert.equal(stateOf(state.cards.GC), status);
    const result = managementReferenceFor(opportunity, status);
    if (!management) { assert.equal(result, null); assert.equal(renderHoldingReference(opportunity, status), ''); return; }
    assert.deepEqual(result, { label: status === 'position' ? '当前管理' : '计划管理', management, pbRange: '6–10R', bofRange: '3–6R' });
    const html = renderHoldingReference(opportunity, status);
    assert.match(html, /持仓参考/);
    assert.match(html, /PB 重点区间：<strong>6–10R/);
    assert.match(html, /BOF 参考区间：<strong>3–6R/);
    assert.doesNotMatch(html, /当前 R|实时 R|浮盈 R|目标价|MTF|HTF|原始机会/);
  });
}

test('Holding reference: nested config is read-only', () => {
  assert.deepEqual(HOLDING_REFERENCE_V1, { version: 1, PB: { minR: 6, maxR: 10 }, BOF: { minR: 3, maxR: 6 } });
  for (const value of [HOLDING_REFERENCE_V1, HOLDING_REFERENCE_V1.PB, HOLDING_REFERENCE_V1.BOF]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { HOLDING_REFERENCE_V1.PB.minR = 7; }, TypeError);
});

test('Holding reference: requires an opportunity and an eligible status', () => {
  for (const status of ['wait', 'signal', 'position']) assert.equal(managementReferenceFor(null, status), null);
  const opportunity = referenceState('htf_bof', 'position').cards.GC.opportunity;
  for (const status of ['none', 'closed', undefined]) assert.equal(managementReferenceFor(opportunity, status), null);
});

test('Holding reference: both ranges remain fixed for every setup and visible status', () => {
  for (const type of ['mtf_pb', 'htf_pb', 'htf_bof']) {
    for (const status of ['wait', 'signal', 'position']) {
      const { pbRange, bofRange } = managementReferenceFor(referenceState(type, status).cards.GC.opportunity, status);
      assert.equal(pbRange, '6–10R'); assert.equal(bofRange, '3–6R');
    }
  }
});

test('Holding reference: conversion derives PB while pre-entry remains planned BOF', () => {
  const state = referenceState('htf_bof', 'position');
  recordBofToPb(state, 'GC', 7);
  const opportunity = state.cards.GC.opportunity;
  assert.equal(managementReferenceFor(opportunity, 'position').management, 'PB');
  assert.equal(managementReferenceFor(opportunity, 'wait').management, 'BOF');
  assert.equal(managementReferenceFor(opportunity, 'signal').management, 'BOF');
  assert.equal(opportunity.type, 'htf_bof');
});

test('Holding reference: undo derives BOF and preserves the recorded conversion', () => {
  const state = referenceState('htf_pb', 'position');
  recordBofToPb(state, 'GC', 7);
  const original = structuredClone(state.cards.GC.opportunity.researchCapture.manualEvents[0]);
  revertBofToPb(state, 'GC', 8);
  assert.equal(managementReferenceFor(state.cards.GC.opportunity, 'position').management, 'BOF');
  assert.deepEqual(state.cards.GC.opportunity.researchCapture.manualEvents[0], original);
  assert.equal(state.cards.GC.opportunity.researchCapture.manualEvents.length, 2);
});

test('Holding reference: helper and rendering never mutate state or manual events', () => {
  for (const [name, type, status] of cases) {
    const state = referenceState(type, status);
    if (status === 'position') { recordInitialStop(state, 'GC', 3974, 7); if (type === 'htf_pb') recordBofToPb(state, 'GC', 8); }
    const before = structuredClone(state);
    // Deep-freeze inputs to catch writes even when their eventual value is unchanged.
    const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(state);
    for (let i = 0; i < 2; i++) {
      managementReferenceFor(state.cards.GC.opportunity, stateOf(state.cards.GC));
      renderHoldingReference(state.cards.GC.opportunity, stateOf(state.cards.GC));
    }
    assert.deepEqual(state, before, name); assertState(state);
  }
});

test('Holding reference: V5 and Unified V2 JSON round-trip has exactly the same fields and events', () => {
  const state = referenceState('htf_pb', 'position');
  recordInitialStop(state, 'GC', 3974, 7); recordBofToPb(state, 'GC', 8); revertBofToPb(state, 'GC', 9);
  const before = structuredClone(state);
  renderHoldingReference(state.cards.GC.opportunity, 'position');
  assert.equal(SCHEMA_VERSION, 5);
  assert.deepEqual(deserialize(serialize(state, 10)).state, before);
  const unified = makeUnified(makeEnvelope(state, 10));
  const raw = JSON.stringify(unified);
  const roundTrip = JSON.parse(raw);
  assert.equal(roundTrip.schemaVersion, 2); validateUnified(roundTrip);
  assert.deepEqual(roundTrip, unified);
  assert.deepEqual(roundTrip.sections.intraday.state, before);
  assert.doesNotMatch(raw, /holdingReference|referenceR|plannedManagement|currentManagement|referenceVersion/);
});
