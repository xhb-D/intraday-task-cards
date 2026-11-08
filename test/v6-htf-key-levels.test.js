import test from 'node:test';
import assert from 'node:assert/strict';
import { HTF_KEY_LEVELS, HTF_STRUCTURES_V3 } from '../src/model.js';
import { intradayV6 as v6 } from '../src/intraday-v6/index.js';
import { captureUi } from '../src/capture-ui.js';
import { makeEnvelope, serialize, deserialize, exportMarkdown } from '../src/capture-persistence.js';
import { makeUnified, loadUnified, normalizeImport, UNIFIED_KEY } from '../src/capture-unified.js';
import { assertArchiveRetention } from '../src/history-archive.js';
import { createWorkbenchController } from '../src/exit-research/ui/controller.js';
import { workbenchFixture, UI_T, UI_P } from './fixtures/exit-research-ui.js';
import { ready, historicalPending, T } from './fixtures/intraday-v6.js';

test('HTF key levels: exact five choices with stable, independent identities', () => {
  assert.deepEqual(Object.keys(HTF_KEY_LEVELS), ['htf_bull_breakout', 'htf_bull_pullback', 'htf_bear_breakout', 'htf_bear_cover', 'htf_range_v2']);
  assert.deepEqual(Object.values(HTF_KEY_LEVELS), ['多头突破', '多头回调', '空头突破', '空头回补', '震荡']);
  assert.equal(HTF_STRUCTURES_V3.breakout_strong_pullback_weak, '突破强&回调弱');
  assert.equal(HTF_STRUCTURES_V3.breakout_weak_pullback_strong, '突破弱&回调强');
});

for (const [key, label] of Object.entries(HTF_KEY_LEVELS)) for (const symbol of ['GC', 'CL', 'ES']) {
  test(`HTF ${symbol}/${label}: new capture round-trips while old open trade and events stay unchanged`, () => {
    const state = ready(symbol);
    const old = historicalPending(state, symbol, 'mtf_pb', T + 2).opportunity;
    v6.markEntered(state, old.id, T + 3, true);
    v6.recordInitialStop(state, old.id, 90, T + 4);
    const oldSnapshot = structuredClone(old), otherCards = structuredClone(state.cards);
    v6.changeStructure(state, symbol, key);
    assert.deepEqual(old, oldSnapshot);
    for (const other of ['GC', 'CL', 'ES'].filter(item => item !== symbol)) assert.deepEqual(state.cards[other], otherCards[other]);
    const fresh = v6.chooseSetup(state, symbol, 'cpb', T + 5).opportunity;
    assert.equal(fresh.structure3mAtRegistration, key);
    v6.markEntered(state, fresh.id, T + 6, true);
    v6.recordInitialStop(state, fresh.id, 92, T + 7);
    v6.recordEntryExpectation(state, fresh.id, { path: '合成测试预期', keyLevels: '', focus: '' }, 'key-level-test', T + 8);
    v6.markTradeExited(state, fresh.id, 'OTHER_EXIT', T + 9, true);
    assert.deepEqual(old, oldSnapshot);
    assert.deepEqual(deserialize(serialize(state, T + 10)).state, state);
    const markdown = exportMarkdown(state, 'all', T + 10);
    assert.ok(markdown.includes(`市场结构：${label}`));
    assert.ok(markdown.includes('市场结构：突破强&回调弱'));

    const unified = makeUnified(makeEnvelope(state, T + 10)), raw = JSON.stringify(unified);
    const writes = [], storage = { getItem: name => name === UNIFIED_KEY ? raw : null, setItem: (...args) => writes.push(args) };
    const restored = loadUnified(storage);
    assert.equal(restored.source, 'canonical');
    assert.deepEqual(restored.state.sections.intraday.state, state);
    assert.deepEqual(writes, [], 'Reading the current archive must not rewrite it');
    const imported = normalizeImport(JSON.parse(raw), unified).state.sections.intraday.state;
    assert.deepEqual(imported, state);
    assert.equal(assertArchiveRetention(state, imported), true);

    const before = JSON.stringify(state);
    const collapsed = captureUi.renderCard(state, symbol, { collapsed: true });
    assert.match(collapsed, /class="card-controls"><section class="classifier bias-field"/);
    assert.match(collapsed, /class="active-trades"[^>]* hidden>/);
    assert.match(collapsed, /class="new-opportunity" hidden>/);
    assert.match(collapsed, /日内偏见[^]*?HTF关键位[^]*?交易方向<\/span>/);
    assert.doesNotMatch(collapsed, /direction-note|小偏见方向|大偏见方向/);
    const expanded = captureUi.renderCard(state, symbol, { collapsed: false });
    assert.doesNotMatch(expanded, /class="active-trades"[^>]* hidden>|class="new-opportunity" hidden>/);
    assert.equal(JSON.stringify(state), before);
  });
}

test('HTF legacy archive: both earlier classifications remain readable without selecting a new meaning', () => {
  for (const key of ['breakout_strong_pullback_weak', 'breakout_weak_pullback_strong']) {
    const state = ready();
    v6.changeStructure(state, 'GC', key);
    const before = structuredClone(state);
    const output = captureUi.renderCard(state, 'GC');
    assert.ok(output.includes(`旧分类：${HTF_STRUCTURES_V3[key].replace(/&/g, '&amp;')}`));
    assert.doesNotMatch(output, /class="option structure selected"/);
    assert.deepEqual(deserialize(serialize(state, T + 1)).state, before);
  }
});

test('HTF key levels: read-only research preserves the context and keeps existing replay results', () => {
  const fixture = workbenchFixture();
  const original = v6.migrateV5ToV6(fixture.state, { migratedAt: UI_T }).state;
  const output = state => {
    const before = structuredClone(state), saved = new Map();
    const controller = createWorkbenchController({ getIntraday: () => state, storage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) } });
    for (const kind of ['fills', 'orders', 'positions']) controller.importFile(kind, fixture[kind]);
    controller.confirmFlat(true);
    controller.importFile('bundle', JSON.stringify(fixture.bundle));
    controller.select(fixture.ids.ES1);
    controller.setReplaySettings(fixture.ids.ES1, { replayHardEndAt: UI_T + 3600000 + 4 * UI_P, executionTickSize: .1 });
    const selected = controller.snapshot().selected;
    assert.equal(selected.matchingStatus, 'MATCHED');
    assert.equal(selected.replayStatus, 'EXECUTED');
    assert.deepEqual(state, before);
    return { metrics: selected.metrics, realizedR: selected.realizedR, replays: selected.replays };
  };
  const expected = output(original);
  for (const key of Object.keys(HTF_KEY_LEVELS)) {
    const candidate = structuredClone(original);
    for (const record of candidate.records) record.structure3mAtRegistration = key;
    assert.deepEqual(output(candidate), expected);
  }
});
