import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/model.js';
import { makeEnvelope } from '../src/persistence.js';
import { LEGACY_RISK_KEY, PRE_IMPORT_KEY, UNIFIED_KEY, classifyBackup, commitUnified, loadUnified, makeUnified, normalizeImport, validateRisk } from '../src/unified-persistence.js';

const store = values => { const map = new Map(Object.entries(values || {})); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), map }; };
const risk = () => ({ schemaVersion: 2, selectedAccountId: null, accounts: [] });

test('C03/C04: legacy risk migrates into a blank intraday section and canonical wins', () => {
  const s = store({ [LEGACY_RISK_KEY]: JSON.stringify(risk()) });
  const loaded = loadUnified(s); assert.equal(loaded.source, 'legacy-risk'); assert.deepEqual(loaded.state.sections.riskManager, risk()); assert.deepEqual(Object.keys(loaded.state.sections.intraday.state.cards), ['GC', 'CL', 'ES']);
  const canonical = makeUnified(makeEnvelope(createWorkspace(2), 2), risk()); s.setItem(UNIFIED_KEY, JSON.stringify(canonical)); s.setItem(LEGACY_RISK_KEY, JSON.stringify({ schemaVersion: 2, selectedAccountId: 'bad', accounts: [] }));
  assert.equal(loadUnified(s).source, 'canonical');
});

test('C02/C13: old standalone intraday is rejected without changing the current state; risk import remains partial', () => {
  const current = makeUnified(makeEnvelope(createWorkspace(1), 1), risk(), { appearance: 'dark' });
  const before = JSON.stringify(current); const standalone = makeEnvelope(createWorkspace(2), 2); assert.throws(() => normalizeImport(standalone, current), /不支持旧版独立日内状态卡备份/); assert.equal(JSON.stringify(current), before);
  const riskImported = normalizeImport(risk(), current).state; assert.deepEqual(riskImported.sections.intraday, current.sections.intraday); assert.deepEqual(riskImported.preferences, current.preferences);
});

test('C19/C20/C21/C22/C23/C24: classifier and strict risk validation fail closed', () => {
  assert.throws(() => classifyBackup({}), /无法识别/); assert.throws(() => classifyBackup({ app: 'intraday-task-cards', state: {}, schemaVersion: 2, accounts: [], selectedAccountId: null }), /不支持旧版独立日内状态卡备份/);
  const duplicate = { schemaVersion: 2, selectedAccountId: 'a', accounts: [{ id: 'a', currentSession: { id: 's', startedAt: 'invalid', previousEodBalance: 1, sessionStartBalance: 1, balanceEvents: [] } }, { id: 'a', currentSession: { id: 's', startedAt: '2020-01-01T00:00:00.000Z', previousEodBalance: 1, sessionStartBalance: 1, balanceEvents: [] } }] };
  assert.throws(() => validateRisk(duplicate));
  const broken = { schemaVersion: 2, selectedAccountId: 'a', accounts: [{ id: 'a', currentSession: { id: 's', startedAt: '2020-01-01T00:00:00.000Z', previousEodBalance: 1, sessionStartBalance: 1, balanceEvents: [{ id: 'e', timestamp: '2020-01-01T00:00:00.000Z', previousBalance: 2, newBalance: 3, delta: 2 }] } }] };
  assert.throws(() => validateRisk(broken));
});

test('C28/C29: import commit preserves a pre-import snapshot and reads back', () => {
  const s = store(); const initial = commitUnified(s, makeUnified()); const before = s.getItem(UNIFIED_KEY); const next = commitUnified(s, initial, { preImport: true });
  assert.equal(s.getItem(PRE_IMPORT_KEY), before); assert.equal(JSON.parse(s.getItem(UNIFIED_KEY)).revision, next.revision);
});
