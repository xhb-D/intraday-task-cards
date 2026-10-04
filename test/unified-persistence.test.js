import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/model.js';
import { makeEnvelope, migrateEnvelope } from '../src/persistence.js';
import { CHIME_LEGACY_KEY } from '../src/natural-chime/model.js';
import { LEGACY_RISK_KEY, PRE_IMPORT_KEY, PRE_UPGRADE_KEY, UNIFIED_KEY, CHIME_LEGACY_RECOVERY_MESSAGE, classifyBackup, commitUnified, continueLegacyChimeRecovery, loadUnified, makeUnified, normalizeImport, validateRisk } from '../src/unified-persistence.js';
import { goldenFixtures } from './fixtures/compatibility/golden-fixtures.js';

const store = values => { const map = new Map(Object.entries(values || {})); return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value), map }; };
const risk = () => ({ schemaVersion: 2, selectedAccountId: null, accounts: [] });

test('C03/C04: legacy risk migrates into a blank intraday section and canonical wins', () => {
  const s = store({ [LEGACY_RISK_KEY]: JSON.stringify(risk()) });
  const loaded = loadUnified(s); assert.equal(loaded.source, 'legacy-risk'); assert.deepEqual(loaded.state.sections.riskManager, risk()); assert.deepEqual(Object.keys(loaded.state.sections.intraday.state.cards), ['GC', 'CL', 'ES']);
  const canonical = makeUnified(makeEnvelope(createWorkspace(2), 2), risk()); s.setItem(UNIFIED_KEY, JSON.stringify(canonical)); s.setItem(LEGACY_RISK_KEY, JSON.stringify({ schemaVersion: 2, selectedAccountId: 'bad', accounts: [] }));
  assert.equal(loadUnified(s).source, 'canonical');
});

test('C04a: 本地 unified V1 启动时快照并一次性迁移到 schema 2，只吸收 legacy V1', () => {
  const legacy = goldenFixtures['unified-v1-active'].value;
  const raw = JSON.stringify(legacy);
  const legacyChimeRaw = JSON.stringify({ preset: '5', minutes: '5', early: '30', voice: true, notify: false });
  const reads = [];
  const data = new Map([[UNIFIED_KEY, raw], [CHIME_LEGACY_KEY, legacyChimeRaw]]);
  const s = { getItem(key) { reads.push(key); return data.has(key) ? data.get(key) : null; }, setItem(key, value) { data.set(key, String(value)); }, map: data };
  const loaded = loadUnified(s);
  assert.equal(loaded.source, 'canonical-migrated');
  assert.equal(loaded.state.sections.intraday.schemaVersion, 5);
  assert.equal(loaded.state.sections.intraday.state.cards.GC.opportunity, null);
  assert.equal(loaded.state.sections.intraday.state.migrationAudit[0].reason, 'opportunity_taxonomy_upgrade');
  const migratedRaw = s.getItem(UNIFIED_KEY); const migrated = JSON.parse(migratedRaw);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.revision, legacy.revision + 1); assert.equal(migrated.savedAt, legacy.savedAt);
  assert.deepEqual(migrated.sections.intraday, migrateEnvelope(legacy.sections.intraday).envelope);
  assert.deepEqual(migrated.sections.riskManager, legacy.sections.riskManager); assert.deepEqual(migrated.preferences, legacy.preferences);
  assert.equal(migrated.sections.chime.legacyImport.status, 'legacy-v1'); assert.equal(migrated.sections.chime.legacyImport.sourceVersion, 1);
  assert.equal(s.getItem(PRE_UPGRADE_KEY), raw); assert.equal(s.getItem(CHIME_LEGACY_KEY), legacyChimeRaw);
  const readCount = reads.filter(key => key === CHIME_LEGACY_KEY).length;
  assert.equal(loadUnified(s).source, 'canonical');
  assert.equal(reads.filter(key => key === CHIME_LEGACY_KEY).length, readCount);
  assert.equal(s.getItem(UNIFIED_KEY), migratedRaw);
});

test('C04b/C04d/C04e: legacy version 2 remains byte-exact until explicit ignore migration', () => {
  const legacy = goldenFixtures['unified-v1-active'].value; const raw = JSON.stringify(legacy);
  const legacyChimeRaw = '{"version":2,"schedules":[{"uninspected":"bytes"}],"voice":true,"notify":false}';
  const s = store({ [UNIFIED_KEY]: raw, [CHIME_LEGACY_KEY]: legacyChimeRaw });
  const recovery = loadUnified(s);
  assert.equal(recovery.source, 'chime-recovery'); assert.equal(recovery.state.sections.intraday.schemaVersion, 5);
  assert.equal(CHIME_LEGACY_RECOVERY_MESSAGE, '旧版报时设置无法识别，报时已停用；原始存档与旧键均未修改。请恢复有效统一备份，或明确选择“忽略旧报时设置并使用默认值继续”。');
  assert.equal(s.getItem(UNIFIED_KEY), raw); assert.equal(s.getItem(CHIME_LEGACY_KEY), legacyChimeRaw); assert.equal(s.getItem(PRE_UPGRADE_KEY), null);
  const result = continueLegacyChimeRecovery(s, { expectedRaw: raw, expectedLegacyRaw: legacyChimeRaw });
  const migratedRaw = s.getItem(UNIFIED_KEY); const migrated = JSON.parse(migratedRaw);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.revision, legacy.revision + 1);
  assert.equal(migrated.sections.chime.legacyImport.status, 'recovery-default'); assert.equal(result.state.schemaVersion, 2);
  assert.equal(s.getItem(PRE_UPGRADE_KEY), raw); assert.equal(s.getItem(CHIME_LEGACY_KEY), legacyChimeRaw);
  assert.equal(loadUnified(s).source, 'canonical'); assert.equal(s.getItem(UNIFIED_KEY), migratedRaw);
});

test('C04f: no-canonical bootstrap never reads the old chime key', () => {
  const reads = []; const s = { getItem(key) { reads.push(key); return key === CHIME_LEGACY_KEY ? '{bad' : null; }, setItem() {} };
  const loaded = loadUnified(s);
  assert.equal(loaded.source, 'blank'); assert.equal(loaded.state.schemaVersion, 2);
  assert.equal(reads.includes(CHIME_LEGACY_KEY), false);
});

test('C04d/C20: failed pre-upgrade snapshot leaves canonical V1 byte-exact', () => {
  const raw = JSON.stringify(goldenFixtures['unified-v1-active'].value);
  const data = new Map([[UNIFIED_KEY, raw]]);
  const s = { getItem: key => data.has(key) ? data.get(key) : null, setItem(key, value) { if (key === PRE_UPGRADE_KEY) throw new Error('quota'); data.set(key, String(value)); } };
  const loaded = loadUnified(s);
  assert.equal(loaded.source, 'recovery-required'); assert.equal(s.getItem(UNIFIED_KEY), raw);
});

test('Unified import: a write that mutates then throws rolls canonical back to its exact prior bytes', () => {
  const base = store(); const initial = commitUnified(base, makeUnified()); const priorRaw = base.getItem(UNIFIED_KEY);
  let failAfterWrite = true;
  const guarded = {
    getItem: key => base.getItem(key),
    setItem(key, value) {
      if (key === UNIFIED_KEY && failAfterWrite) { failAfterWrite = false; base.setItem(key, value); throw new Error('simulated interrupted write'); }
      base.setItem(key, value);
    }
  };
  const candidate = makeUnified(initial.sections.intraday, initial.sections.riskManager, initial.preferences);
  candidate.sections.chime.notifyEnabled = true;
  assert.throws(() => commitUnified(guarded, candidate, { preImport: true, expectedRaw: priorRaw }), error => error.code === 'CANONICAL_WRITE_FAILED' && error.rolledBack === true);
  assert.equal(base.getItem(UNIFIED_KEY), priorRaw);
  assert.equal(base.getItem(PRE_IMPORT_KEY), priorRaw);
  assert.equal(candidate.sections.chime.notifyEnabled, true);
});

test('Legacy chime explicit-ignore raw guard rejects changed canonical or legacy bytes before snapshot', () => {
  const original = JSON.stringify(goldenFixtures['unified-v1-active'].value); const legacyRaw = '{"version":2}';
  const s = store({ [UNIFIED_KEY]: original, [CHIME_LEGACY_KEY]: legacyRaw });
  assert.equal(loadUnified(s).source, 'chime-recovery');
  s.setItem(CHIME_LEGACY_KEY, '{"version":3}'); const changedLegacy = s.getItem(CHIME_LEGACY_KEY);
  assert.throws(() => continueLegacyChimeRecovery(s, { expectedRaw: original, expectedLegacyRaw: legacyRaw }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(s.getItem(UNIFIED_KEY), original); assert.equal(s.getItem(CHIME_LEGACY_KEY), changedLegacy); assert.equal(s.getItem(PRE_UPGRADE_KEY), null);
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
