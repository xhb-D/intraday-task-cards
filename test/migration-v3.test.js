import test from 'node:test';
import assert from 'node:assert/strict';
import { assertState, LEGACY_SCHEMA_VERSION, SCHEMA_VERSION } from '../src/model.js';
import { deserialize, makeEnvelope, migrateEnvelope, serialize } from '../src/persistence.js';
import { fixtureTimes, goldenFixtures } from './fixtures/compatibility/golden-fixtures.js';

test('migration: 当前 V4 状态往返，不重复迁移', () => {
  const state = JSON.parse(serialize({ schemaVersion: 4, sequence: 0, revision: 0, lastSavedAt: null, cards: Object.fromEntries(['GC', 'CL', 'ES'].map(symbol => [symbol, { symbol, bias: 'neutral', structure3m: 'unjudged', needsStructureReview: false, direction: 'none', opportunity: null, idleSince: 1 }])), records: [], migrationAudit: [] }, 2)).state;
  const envelope = makeEnvelope(state, 2);
  const result = migrateEnvelope(envelope);
  assert.equal(result.migrated, false);
  assert.deepEqual(result.envelope, envelope);
  assert.deepEqual(deserialize(serialize(state, 2)).state, state);
});

test('migration: 独立 V1/V2/V3 存档 fail-closed，不能绕过统一存档入口', () => {
  for (const version of [1, 2, 3]) {
    const legacy = goldenFixtures[version === 1 ? 'intraday-v1-active' : version === 2 ? 'intraday-v2-near' : 'intraday-v3-holding'].value;
    assert.throws(() => deserialize(JSON.stringify(legacy)), error => error.code === 'SCHEMA_ERROR');
  }
});

test('migration: 统一 V3 日内活动机会确定性结束，保留旧名称、关键位置和审计原因', () => {
  const legacy = goldenFixtures['unified-v1-active'].value.sections.intraday;
  const legacyCardOpportunity = legacy.state.cards.GC.opportunity;
  const legacyActiveRecord = legacy.state.records.find(record => record.id === 'op-legacy-gc');
  assert.equal(legacyCardOpportunity.enteredAt, fixtureTimes.T4);
  assert.deepEqual(legacyCardOpportunity.stages, [
    { state: 'wait', start: fixtureTimes.T3, end: fixtureTimes.T4 },
    { state: 'position', start: fixtureTimes.T4, end: null }
  ]);
  assert.deepEqual(legacyActiveRecord.stages, legacyCardOpportunity.stages);
  const first = migrateEnvelope(legacy);
  const second = migrateEnvelope(legacy);
  assert.equal(first.migrated, true);
  assert.equal(first.envelope.schemaVersion, SCHEMA_VERSION);
  assert.equal(first.envelope.state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(first.envelope, second.envelope);
  assert.deepEqual(first.audits, second.audits);
  assert.equal(first.audits.length, 1);
  assert.equal(first.audits[0].legacyType, 'pullback');
  assert.equal(first.audits[0].legacyTypeLabel, '趋势回调');
  assert.equal(first.audits[0].zone, '50,000–50,010');
  assert.equal(first.audits[0].reason, 'opportunity_taxonomy_upgrade');
  assert.equal(first.envelope.state.cards.GC.opportunity, null);
  const oldRecord = first.envelope.state.records.find(record => record.id === 'op-legacy-gc');
  assert.equal(oldRecord.type, 'pullback');
  assert.equal(oldRecord.zone, '50,000–50,010');
  assert.equal(oldRecord.enteredAt, fixtureTimes.T4);
  assert.deepEqual(oldRecord.stages, [
    { state: 'wait', start: fixtureTimes.T3, end: fixtureTimes.T4 },
    { state: 'position', start: fixtureTimes.T4, end: first.migratedAt }
  ]);
  assert.equal(oldRecord.stages.at(-1).end, oldRecord.endedAt);
  assert.equal(oldRecord.reason, 'rules_upgrade');
  assert.equal(oldRecord.migrationReason, 'opportunity_taxonomy_upgrade');
  assert.equal(first.audits[0].originalStage, 'position');
  assert.equal(first.audits[0].hadRecord, true);
  const oldHistory = first.envelope.state.records.find(record => record.id === 'op-legacy-cl');
  assert.equal(oldHistory.type, 'reversal');
  assert.equal(oldHistory.zone, '74.20–74.30');
  assertState(first.envelope.state);
});

test('migration: rules_upgrade 也可安全结束旧等待机会并保持非持仓约束', () => {
  const legacy = JSON.parse(JSON.stringify(goldenFixtures['unified-v1-active'].value.sections.intraday));
  const opportunity = legacy.state.cards.GC.opportunity;
  const record = legacy.state.records.find(candidate => candidate.id === 'op-legacy-gc');
  opportunity.enteredAt = null;
  opportunity.stageSince = fixtureTimes.T3;
  opportunity.stages = [{ state: 'wait', start: fixtureTimes.T3, end: null }];
  record.enteredAt = null;
  record.stageSince = fixtureTimes.T3;
  record.stages = [{ state: 'wait', start: fixtureTimes.T3, end: null }];
  const result = migrateEnvelope(legacy);
  const migrated = result.envelope.state.records.find(candidate => candidate.id === 'op-legacy-gc');
  assert.equal(result.envelope.state.cards.GC.opportunity, null);
  assert.equal(migrated.enteredAt, null);
  assert.deepEqual(migrated.stages, [{ state: 'wait', start: fixtureTimes.T3, end: result.migratedAt }]);
  assert.equal(migrated.reason, 'rules_upgrade');
  assert.equal(migrated.migrationReason, 'opportunity_taxonomy_upgrade');
  assertState(result.envelope.state);
});

test('migration: 没有旧历史记录的活动机会不伪造普通历史，只写完整审计', () => {
  const legacy = JSON.parse(JSON.stringify(goldenFixtures['unified-v1-active'].value.sections.intraday));
  legacy.state.records = legacy.state.records.filter(record => record.id !== 'op-legacy-gc');
  const result = migrateEnvelope(legacy);
  assert.equal(result.audits.length, 1);
  assert.equal(result.audits[0].hadRecord, false);
  assert.equal(result.audits[0].recordId, null);
  assert.equal(result.envelope.state.cards.GC.opportunity, null);
  assert.equal(result.envelope.state.records.some(record => record.id === 'op-legacy-gc'), false);
  assertState(result.envelope.state);
});

test('migration: 损坏或未知 V3 结构拒绝且不猜测', () => {
  const legacy = JSON.parse(JSON.stringify(goldenFixtures['unified-v1-active'].value.sections.intraday));
  legacy.state.cards.GC.opportunity.type = 'unknown-old-type';
  assert.throws(() => migrateEnvelope(legacy), /V3/);
  assert.equal(legacy.schemaVersion, LEGACY_SCHEMA_VERSION);
});
