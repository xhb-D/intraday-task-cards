import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diagnosticFromError } from '../src/diagnostics.js';
import { assertState, createWorkspace } from '../src/model.js';
import { deserialize, serialize, validateEnvelope } from '../src/persistence.js';
import { loadInitialWorkspace } from '../src/startup.js';

const fixture = async () => readFile(new URL('./fixtures/schema-v2-idle-valid.json', import.meta.url), 'utf8');
const core = state => ({
  sequence: state.sequence, revision: state.revision,
  cards: Object.fromEntries(Object.entries(state.cards).map(([symbol, card]) => [symbol, {
    bias: card.bias, structure3m: card.structure3m, direction: card.direction,
    opportunity: card.opportunity, needsStructureReview: card.needsStructureReview
  }])), records: state.records
});

test('integrity: 现场 schema v2 idle fixture 可校验、恢复、序列化且不重复迁移', async () => {
  const raw = await fixture(); const before = JSON.parse(raw);
  const envelope = deserialize(raw); validateEnvelope(envelope); assertState(envelope.state);
  assert.deepEqual(core(envelope.state), core(before.state));
  const restored = loadInitialWorkspace({ getItem: () => raw }, before.savedAt);
  assert.equal(restored.mode, 'restored'); assert.equal(restored.state.cards.GC.bias, 'bullish');
  assert.equal(restored.state.cards.GC.structure3m, 'range'); assert.equal(restored.state.cards.GC.direction, 'none');
  assert.equal(restored.diagnostic, undefined);
  const roundTrip = deserialize(serialize(restored.state, before.savedAt));
  assert.deepEqual(core(roundTrip.state), core(before.state));
});

test('integrity: 合法 idle 组合通过；真正不兼容的空闲方向仍被拒绝并携带路径', () => {
  const state = createWorkspace(1); state.cards.GC.structure3m = 'range'; state.cards.GC.bias = 'bullish'; assert.doesNotThrow(() => assertState(state));
  state.cards.CL.direction = 'long'; assert.throws(() => assertState(state), error => error.code === 'STATE_VALIDATION_ERROR' && error.path === 'cards.CL.direction');
});

test('integrity: 真正不兼容的 schema v2 存档保留原始 JSON 并进入恢复保护态', async () => {
  const invalid = JSON.parse(await fixture()); invalid.state.cards.GC.structure3m = 'unjudged'; invalid.state.cards.GC.direction = 'long';
  const raw = JSON.stringify(invalid);
  const restored = loadInitialWorkspace({ getItem: () => raw }, invalid.savedAt);
  assert.equal(restored.mode, 'recovery-required'); assert.equal(restored.lastRaw, raw);
  assert.equal(restored.diagnostic.errorCode, 'STATE_VALIDATION_ERROR');
  assert.equal(restored.diagnostic.validationPath, 'cards.GC.direction');
});

test('integrity: 诊断对象保留启动、JSON 与状态校验阶段', () => {
  const json = diagnosticFromError(new SyntaxError('bad'), { phase: 'startup_restore' });
  assert.equal(json.errorCode, 'JSON_PARSE_ERROR'); assert.equal(json.phase, 'startup_restore');
  const state = diagnosticFromError(Object.assign(new Error('bad state'), { code: 'STATE_VALIDATION_ERROR', path: 'cards.GC.bias' }), { phase: 'interaction', relevantSymbol: 'GC' });
  assert.deepEqual(state, { errorCode: 'STATE_VALIDATION_ERROR', phase: 'interaction', message: 'bad state', cause: 'Error', relevantSymbol: 'GC', validationPath: 'cards.GC.bias' });
  for (const [errorCode, phase] of [['STORAGE_READ_ERROR', 'storage_read'], ['STORAGE_WRITE_ERROR', 'storage_write'], ['SCHEMA_ERROR', 'startup_restore'], ['MIGRATION_ERROR', 'migration'], ['INVARIANT_ERROR', 'runtime'], ['SERIALIZATION_ERROR', 'serialization'], ['REVISION_CONFLICT', 'confirmation'], ['EXTERNAL_WRITE_CONFLICT', 'external_write'], ['RENDER_STATE_ERROR', 'render']]) {
    const diagnostic = diagnosticFromError(Object.assign(new Error(errorCode), { code: errorCode }), { phase });
    assert.equal(diagnostic.errorCode, errorCode);
  }
});
