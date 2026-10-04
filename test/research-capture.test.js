import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, LEGACY_SCHEMA_VERSION, V4_SCHEMA_VERSION, assertState, assertV4State, assertLegacyState,
  createWorkspace, changeBias, changeDirection, changeStructure, chooseSetup, markEntered, markExited, deleteRecord, copy,
  migrateV3Workspace, migrateV4Workspace, researchSetupClass, effectiveInitialStop, derivedManagementState,
  recordInitialStop, correctInitialStop, recordBofToPb, revertBofToPb
} from '../src/model.js';
import { makeEnvelope, migrateEnvelope, exportMarkdown, timeText } from '../src/persistence.js';
import { makeUnified, migrateUnified, normalizeImport, commitUnified, loadUnified, validateUnified, UNIFIED_KEY, PRE_UPGRADE_KEY, CHIME_LEGACY_RECOVERY_MESSAGE } from '../src/unified-persistence.js';
import { CHIME_LEGACY_KEY } from '../src/natural-chime/model.js';
import { goldenFixtures } from './fixtures/compatibility/golden-fixtures.js';

const T = 1_750_000_000_000;
function position(type = 'htf_pb', symbol = 'GC', direction = 'long') {
  const state = createWorkspace(T);
  changeBias(state, symbol, 'bearish', T + 1);
  changeStructure(state, symbol, 'range', T + 2);
  changeDirection(state, symbol, direction, T + 3);
  chooseSetup(state, symbol, type, T + 4);
  markEntered(state, symbol, T + 5, true);
  return state;
}
function v4Envelope(state = position()) {
  const envelope = makeEnvelope(state, T + 100);
  envelope.schemaVersion = 4; envelope.state.schemaVersion = 4;
  for (const card of Object.values(envelope.state.cards)) if (card.opportunity) delete card.opportunity.researchCapture;
  for (const record of envelope.state.records) delete record.researchCapture;
  assertV4State(envelope.state); return envelope;
}
function unifiedV4() {
  const unified = makeUnified();
  unified.sections.intraday = v4Envelope();
  unified.sections.riskManager = copy(goldenFixtures['risk-v2-multi-history'].value);
  unified.preferences.appearance = 'dark';
  unified.revision = 10;
  return unified;
}
const store = initial => {
  const map = new Map(Object.entries(initial || {})); const writes = [];
  return { map, writes, getItem: key => map.get(key) ?? null, setItem: (key, value) => { writes.push(key); map.set(key, value); } };
};
function withoutCapture(item) { const next = copy(item); delete next.researchCapture; return next; }

test('V5: fresh state, opportunities and records contain empty capture; schema constants remain distinct', () => {
  assert.equal(createWorkspace(T).schemaVersion, 5);
  assert.deepEqual([LEGACY_SCHEMA_VERSION, V4_SCHEMA_VERSION, SCHEMA_VERSION], [3, 4, 5]);
  const state = position();
  assert.deepEqual(state.cards.GC.opportunity.researchCapture, { eventSequence: 0, manualEvents: [] });
  assert.deepEqual(state.records[0].researchCapture, state.cards.GC.opportunity.researchCapture);
  assertState(state);
});

test('V4 -> V5: active and closed records only gain empty capture, all trading facts deeply unchanged', () => {
  const state = position(); markExited(state, 'GC', T + 20, true);
  changeDirection(state, 'CL', 'short', T + 21);
  changeStructure(state, 'CL', 'bearish', T + 22); chooseSetup(state, 'CL', 'htf_bof', T + 23);
  const old = v4Envelope(state); const before = copy(old); const next = migrateEnvelope(old).envelope;
  assert.deepEqual(old, before);
  assert.equal(next.schemaVersion, 5);
  for (const [i, record] of next.state.records.entries()) {
    assert.deepEqual(withoutCapture(record), old.state.records[i]);
    assert.deepEqual(record.researchCapture, { eventSequence: 0, manualEvents: [] });
  }
  assert.deepEqual(withoutCapture(next.state.cards.CL.opportunity), old.state.cards.CL.opportunity);
  const stripped = copy(next); stripped.schemaVersion = 4; stripped.state.schemaVersion = 4;
  delete stripped.state.cards.CL.opportunity.researchCapture;
  stripped.state.records.forEach(record => delete record.researchCapture);
  assert.deepEqual(stripped, old);
  assert.deepEqual(migrateEnvelope(next), { envelope: next, migrated: false, audits: [] });
  assert.deepEqual(migrateEnvelope(old).envelope, next);
});

test('V3 -> V4 -> V5: validators and stages are explicit; ended V3 history remains unchanged', () => {
  const old = copy(goldenFixtures['unified-v1-active'].value.sections.intraday); const before = copy(old);
  assertLegacyState(old.state);
  const v4 = migrateV3Workspace(old.state, old.savedAt);
  assert.equal(v4.state.schemaVersion, 4); assertV4State(v4.state);
  const next = migrateV4Workspace(v4.state);
  assert.deepEqual(next, migrateEnvelope(old).envelope.state);
  assert.deepEqual(withoutCapture(next.records[1]), { ...old.state.records[1], migrationReason: null });
  assert.deepEqual(next.migrationAudit, v4.state.migrationAudit);
  assert.equal(next.migrationAudit[0].toSchemaVersion, 4);
  assert.deepEqual(old, before);
  assert.throws(() => assertState(v4.state));
  assert.throws(() => assertV4State(next));
});

test('Unified V2 + V4: import stays V2 and preserves risk/chime/preferences/header fields', () => {
  const old = unifiedV4(); const before = copy(old);
  const result = normalizeImport(old, makeUnified());
  assert.equal(result.state.schemaVersion, 2); assert.equal(result.state.sections.intraday.schemaVersion, 5);
  assert.equal(result.migration.migrated, true);
  for (const key of ['riskManager', 'chime']) assert.deepEqual(result.state.sections[key], old.sections[key]);
  for (const key of ['app', 'revision', 'savedAt', 'timezone', 'preferences']) assert.deepEqual(result.state[key], old[key]);
  assert.deepEqual(old, before);
  assert.deepEqual(migrateUnified(result.state).state, result.state);
  assert.equal(migrateUnified(result.state).migrated, false);
});

test('Unified V2 + V4: startup snapshots raw, writes once, increments revision once and is idempotent', () => {
  const old = unifiedV4(); const raw = JSON.stringify(old);
  const s = store({ [UNIFIED_KEY]: raw, [CHIME_LEGACY_KEY]: 'malformed legacy must be ignored' });
  const loaded = loadUnified(s);
  assert.equal(loaded.source, 'canonical-migrated'); assert.equal(loaded.state.revision, 11);
  assert.equal(s.getItem(PRE_UPGRADE_KEY), raw);
  assert.equal(s.writes.filter(key => key === UNIFIED_KEY).length, 1);
  assert.equal(loaded.state.savedAt, old.savedAt);
  assert.equal(s.getItem(CHIME_LEGACY_KEY), 'malformed legacy must be ignored');
  const after = s.getItem(UNIFIED_KEY);
  assert.equal(loadUnified(s).source, 'canonical'); assert.equal(s.getItem(UNIFIED_KEY), after);
  assert.equal(s.writes.filter(key => key === UNIFIED_KEY).length, 1);
});

test('Unified V1 + V4: old envelope chain adds chime and V5 without changing history or risk', () => {
  const old = unifiedV4(); old.schemaVersion = 1; delete old.sections.chime;
  const next = normalizeImport(old, makeUnified()).state;
  assert.equal(next.schemaVersion, 2); assert.equal(next.sections.intraday.schemaVersion, 5);
  assert.deepEqual(next.sections.riskManager, old.sections.riskManager);
  assert.deepEqual(withoutCapture(next.sections.intraday.state.records[0]), old.sections.intraday.state.records[0]);
});

test('Unified V2 + V3: compatibility chain preserves original taxonomy audit and ended history', () => {
  const old = makeUnified(); old.sections.intraday = copy(goldenFixtures['unified-v1-active'].value.sections.intraday);
  const migrated = migrateUnified(old);
  assert.equal(migrated.state.schemaVersion, 2); assert.equal(migrated.state.sections.intraday.schemaVersion, 5);
  assert.equal(migrated.audits[0].toSchemaVersion, 4);
  assert.deepEqual(withoutCapture(migrated.state.sections.intraday.state.records[1]), { ...old.sections.intraday.state.records[1], migrationReason: null });
});

test('V4 corrupt/unknown migrations fail closed, preserving exact raw before any write', () => {
  for (const corrupt of [
    value => { value.sections.intraday.state.records[0].type = 'unknown'; },
    value => { value.sections.intraday.state.schemaVersion = 5; },
    value => { value.sections.intraday.schemaVersion = 99; },
    value => { value.sections.riskManager.selectedAccountId = 'missing'; },
    value => { value.sections.chime.slots = []; },
    value => { value.sections.intraday.state.cards.GC.opportunity.researchCapture = { manualEvents: [] }; }
  ]) {
    const old = unifiedV4(); corrupt(old); const raw = JSON.stringify(old); const s = store({ [UNIFIED_KEY]: raw });
    assert.equal(loadUnified(s).source, 'recovery-required'); assert.equal(s.getItem(UNIFIED_KEY), raw);
    assert.deepEqual(s.writes, []);
    assert.throws(() => normalizeImport(old, makeUnified()));
  }
});

test('V4 startup migration uses existing conflict and snapshot protections', () => {
  const raw = JSON.stringify(unifiedV4()); let reads = 0; let writes = 0;
  const raced = { getItem(key) { return key === UNIFIED_KEY ? (++reads > 1 ? 'external-write' : raw) : null; }, setItem() { writes++; } };
  const result = loadUnified(raced);
  assert.equal(result.source, 'recovery-required'); assert.equal(result.error.code, 'REVISION_CONFLICT'); assert.equal(writes, 0);
  const failing = store({ [UNIFIED_KEY]: raw });
  failing.setItem = () => { throw new Error('quota'); };
  assert.equal(loadUnified(failing).source, 'recovery-required'); assert.equal(failing.getItem(UNIFIED_KEY), raw);
});

test('V4 startup failed canonical write restores raw and verifies rollback', () => {
  const raw = JSON.stringify(unifiedV4()); const map = new Map([[UNIFIED_KEY, raw]]); let attemptedRaw = null; let tamperOnce = false;
  const storage = {
    getItem(key) { if (key === UNIFIED_KEY && tamperOnce) { tamperOnce = false; return 'bad readback'; } return map.get(key) ?? null; },
    setItem(key, value) { map.set(key, value); if (key === UNIFIED_KEY && value !== raw) { attemptedRaw = value; tamperOnce = true; } }
  };
  const result = loadUnified(storage);
  assert.ok(attemptedRaw); assert.equal(result.source, 'recovery-required');
  assert.equal(result.error.code, 'CANONICAL_UPGRADE_FAILED'); assert.equal(result.error.rolledBack, true);
  assert.equal(map.get(UNIFIED_KEY), raw);
});

test('Initial Stop: all mutations reject idle/wait/signal/closed without changing state', () => {
  for (const stage of ['idle', 'wait', 'signal', 'closed']) {
    const state = position();
    if (stage === 'closed') markExited(state, 'GC', T + 10, true);
    else if (stage === 'idle') { state.cards.GC.opportunity = null; state.records = []; }
    else {
      const op = state.cards.GC.opportunity; op.enteredAt = null; op.attention = stage; op.stageSince = T + 4;
      op.stages = [{ state: stage, start: T + 4, end: null }]; state.records[0] = copy(op);
    }
    const before = copy(state);
    for (const action of [recordInitialStop, correctInitialStop]) assert.throws(() => action(state, 'GC', 3974, T + 20), /持仓/);
    for (const action of [recordBofToPb, revertBofToPb]) assert.throws(() => action(state, 'GC', T + 20), /持仓/);
    assert.deepEqual(state, before);
  }
});

test('Initial Stop: first event records times, source, price, stable ID, revision and history', () => {
  const state = position(); const revision = state.revision; const result = recordInitialStop(state, 'GC', 3974, T + 10);
  assert.equal(result.changed, true); assert.equal(state.revision, revision + 1);
  assert.deepEqual(result.event, { id: `${state.cards.GC.opportunity.id}:manual-1`, type: 'INITIAL_STOP_RECORDED', recordedAt: T + 10, effectiveAt: T + 10, source: 'manual_intraday', payload: { stopPrice: 3974 } });
  assert.equal(effectiveInitialStop(state.cards.GC.opportunity), 3974);
  assert.deepEqual(state.records[0], state.cards.GC.opportunity);
  const before = copy(state); assert.throws(() => recordInitialStop(state, 'GC', 3973, T + 11), /修正/); assert.deepEqual(state, before);
});

for (const price of [NaN, Infinity, -Infinity, 0, -1, '3974', '', null, undefined]) {
  test(`Initial Stop: reject invalid number ${String(price)} for first and correction without mutation`, () => {
    const state = position(); const before = copy(state);
    assert.throws(() => recordInitialStop(state, 'GC', price, T + 10), /有限数字/); assert.deepEqual(state, before);
    recordInitialStop(state, 'GC', 3974, T + 10); const recorded = copy(state);
    assert.throws(() => correctInitialStop(state, 'GC', price, T + 11), /有限数字/); assert.deepEqual(state, recorded);
  });
}

test('Initial Stop: corrections append without replacing old events; current stop derives from chain', () => {
  const state = position(); recordInitialStop(state, 'GC', 3974, T + 10);
  const original = copy(state.cards.GC.opportunity.researchCapture.manualEvents[0]);
  correctInitialStop(state, 'GC', 3973.5, T + 11);
  const capture = state.cards.GC.opportunity.researchCapture;
  assert.equal(capture.eventSequence, 2); assert.deepEqual(capture.manualEvents[0], original);
  assert.deepEqual(capture.manualEvents[1].payload, { oldValue: 3974, newValue: 3973.5 });
  assert.equal(capture.manualEvents[1].type, 'INITIAL_STOP_CORRECTED'); assert.equal(effectiveInitialStop(state.records[0]), 3973.5);
  const revision = state.revision; assert.equal(correctInitialStop(state, 'GC', 3973.5, T + 12).changed, false); assert.equal(state.revision, revision);
  assert.equal(new Set(capture.manualEvents.map(event => event.id)).size, 2);
  assert.equal(Object.hasOwn(state.cards.GC.opportunity, 'initialStop'), false);
});

test('Initial Stop: late event is explicit, earlier effectiveAt never silently inferred from entry', () => {
  const state = position(); recordInitialStop(state, 'GC', 3974, T + 10, T + 6);
  const event = state.records[0].researchCapture.manualEvents[0];
  assert.equal(event.type, 'INITIAL_STOP_LATE_RECORDED'); assert.equal(event.recordedAt, T + 10); assert.equal(event.effectiveAt, T + 6);
  assert.equal(effectiveInitialStop(state.records[0]), 3974); assertState(state);
});

test('Initial Stop: invalid timestamps reject before state mutation and correction needs a first event', () => {
  for (const [recordedAt, effectiveAt] of [[T + 4, T + 4], [T + 10, T + 11], [T + 10, T + 4], [NaN, T + 6], [T + 10, -1]]) {
    const state = position(); const before = copy(state);
    assert.throws(() => recordInitialStop(state, 'GC', 3974, recordedAt, effectiveAt)); assert.deepEqual(state, before);
  }
  const state = position(); assert.throws(() => correctInitialStop(state, 'GC', 3974, T + 10), /尚未记录/);
});

test('Initial Stop: blank capture never blocks entry or exit', () => {
  const state = position(); assert.equal(effectiveInitialStop(state.cards.GC.opportunity), null);
  assert.equal(markExited(state, 'GC', T + 10, true).changed, true); assert.deepEqual(state.records[0].researchCapture.manualEvents, []);
});

test('Research setup mapping preserves historical htf_pb key and rejects PB conversion', () => {
  assert.equal(researchSetupClass('mtf_pb'), 'PB'); assert.equal(researchSetupClass('htf_pb'), 'BOF'); assert.equal(researchSetupClass('htf_bof'), 'BOF');
  const state = position('mtf_pb'); const before = copy(state);
  assert.equal(derivedManagementState(state.records[0]), 'PB'); assert.throws(() => recordBofToPb(state, 'GC', T + 10), /仅 BOF/); assert.deepEqual(state, before);
});

for (const type of ['htf_pb', 'htf_bof']) {
  test(`BOF -> PB: ${type} conversion/duplicate/undo only append, original setup never changes`, () => {
    const state = position(type); const originalFacts = withoutCapture(state.records[0]); const revision = state.revision;
    assert.equal(derivedManagementState(state.records[0]), 'BOF');
    assert.equal(recordBofToPb(state, 'GC', T + 10).changed, true); assert.equal(state.revision, revision + 1);
    assert.equal(derivedManagementState(state.records[0]), 'PB'); assert.equal(state.cards.GC.opportunity.type, type);
    assert.deepEqual(withoutCapture(state.cards.GC.opportunity), originalFacts);
    const recorded = copy(state); assert.equal(recordBofToPb(state, 'GC', T + 11).changed, false); assert.deepEqual(state, recorded);
    assert.equal(revertBofToPb(state, 'GC', T + 12).changed, true);
    assert.deepEqual(state.records[0].researchCapture.manualEvents[0], recorded.records[0].researchCapture.manualEvents[0]);
    assert.equal(state.records[0].researchCapture.manualEvents[1].type, 'BOF_TO_PB_REVERTED');
    assert.equal(derivedManagementState(state.records[0]), 'BOF');
    const undone = copy(state); assert.equal(revertBofToPb(state, 'GC', T + 13).changed, false); assert.deepEqual(state, undone);
    recordBofToPb(state, 'GC', T + 14); assert.equal(derivedManagementState(state.records[0]), 'PB');
    assert.equal(state.records[0].researchCapture.eventSequence, 3);
    assert.equal(Object.hasOwn(state.records[0], 'currentManagementState'), false);
  });
}

test('Closed history preserves every interleaved stop, correction, conversion and undo event', () => {
  const state = position(); recordInitialStop(state, 'GC', 3974, T + 10); recordBofToPb(state, 'GC', T + 11);
  correctInitialStop(state, 'GC', 3973.5, T + 12); revertBofToPb(state, 'GC', T + 13);
  const capture = copy(state.cards.GC.opportunity.researchCapture);
  markExited(state, 'GC', T + 14, true);
  assert.deepEqual(state.records[0].researchCapture, capture); assert.equal(effectiveInitialStop(state.records[0]), 3973.5);
  assert.equal(derivedManagementState(state.records[0]), 'BOF'); assertState(state);
});

test('Research Capture respects GC/CL/ES isolation and deleted-record non-resurrection', () => {
  const state = position(); const untouched = copy({ CL: state.cards.CL, ES: state.cards.ES });
  recordInitialStop(state, 'GC', 3974, T + 10); recordBofToPb(state, 'GC', T + 11);
  assert.deepEqual({ CL: state.cards.CL, ES: state.cards.ES }, untouched);
  deleteRecord(state, state.records[0].id); correctInitialStop(state, 'GC', 3973.5, T + 12); revertBofToPb(state, 'GC', T + 13);
  markExited(state, 'GC', T + 14, true); assert.equal(state.records.length, 0);
});

test('Unified JSON export -> import -> export preserves complete manual audit data including closed records', () => {
  const state = position(); recordInitialStop(state, 'GC', 3974, T + 10, T + 6); correctInitialStop(state, 'GC', 3973.5, T + 11);
  recordBofToPb(state, 'GC', T + 12); revertBofToPb(state, 'GC', T + 13); recordBofToPb(state, 'GC', T + 14);
  markExited(state, 'GC', T + 15, true);
  const original = makeUnified(makeEnvelope(state, T + 20)); const raw = JSON.stringify(original);
  const restored = normalizeImport(JSON.parse(raw), makeUnified()).state;
  assert.equal(JSON.stringify(restored), raw); validateUnified(restored);
  const s = store(); const saved = commitUnified(s, restored);
  assert.deepEqual(loadUnified(s).state.sections.intraday, original.sections.intraday);
  assert.deepEqual(saved.sections.intraday.state.records[0].researchCapture, state.records[0].researchCapture);
});

test('Markdown summaries show initial/corrected stop and only active BOF -> PB, never the full log', () => {
  const state = position(); recordInitialStop(state, 'GC', 3974, T + 10);
  assert.match(exportMarkdown(state, 'all', T + 20), /Initial Stop：3974\.0/);
  correctInitialStop(state, 'GC', 3973.5, T + 11); recordBofToPb(state, 'GC', T + 12);
  markExited(state, 'GC', T + 13, true);
  const markdown = exportMarkdown(state, 'all', T + 20);
  assert.match(markdown, /Initial Stop：3973\.5（已修正）/);
  assert.ok(markdown.includes(`管理变化：BOF → PB（${timeText(T + 12).slice(0, 5)}）`));
  assert.doesNotMatch(markdown, /manualEvents|manual-1|recordedAt|INITIAL_STOP_CORRECTED/);
  const undone = position(); recordBofToPb(undone, 'GC', T + 10); revertBofToPb(undone, 'GC', T + 11);
  assert.doesNotMatch(exportMarkdown(undone, 'all', T + 20), /管理变化/);
});

test('V5 validator rejects corrupted IDs, sequence, timestamps, price, old value, source and impossible transitions', () => {
  const source = position(); recordInitialStop(source, 'GC', 3974, T + 10); correctInitialStop(source, 'GC', 3973.5, T + 11);
  recordBofToPb(source, 'GC', T + 12); revertBofToPb(source, 'GC', T + 13);
  for (const corrupt of [
    op => delete op.researchCapture,
    op => { op.researchCapture.eventSequence = 3; },
    op => { op.researchCapture.manualEvents[1].id = op.researchCapture.manualEvents[0].id; },
    op => { op.researchCapture.manualEvents[0].recordedAt = -1; },
    op => { op.researchCapture.manualEvents[0].effectiveAt = T + 4; },
    op => { op.researchCapture.manualEvents[0].source = 'automatic'; },
    op => { op.researchCapture.manualEvents[0].payload.stopPrice = 0; },
    op => { op.researchCapture.manualEvents[1].payload.oldValue = 99; },
    op => { op.researchCapture.manualEvents[3].payload.revertedEventId = 'missing'; },
    op => { op.type = 'mtf_pb'; },
    op => { op.researchCapture.manualEvents[2].type = 'UNKNOWN'; }
  ]) {
    const state = copy(source); corrupt(state.cards.GC.opportunity); state.records[0] = copy(state.cards.GC.opportunity);
    assert.throws(() => assertState(state), error => error.code === 'STATE_VALIDATION_ERROR');
  }
});
