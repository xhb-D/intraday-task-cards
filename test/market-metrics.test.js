import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRisk, rAtPrice, thresholdPrice } from '../src/exit-research/r-math.js';
import { planMarketDataRequests } from '../src/exit-research/market-request.js';
import { resolveContextMarket } from '../src/exit-research/market-config.js';
import { validateMarketDataBundle, marketSeriesFingerprint, marketBundleFingerprint } from '../src/exit-research/market-data.js';
import { calculateMarketMetrics } from '../src/exit-research/market-metrics.js';
import { buildResearchTrades } from '../src/exit-research/research-trade.js';
import { createWorkspace, changeDirection, changeStructure, chooseSetup, markEntered, recordInitialStop, markExited } from '../src/model.js';
import { parseTradovateFillsCsv } from '../src/exit-research/tradovate-csv.js';
import { reconstructLogicalTrades } from '../src/exit-research/logical-trade.js';
import { fillRow, fillsCsv } from './fixtures/tradovate/synthetic.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const T = Date.UTC(2035, 0, 1), M = 60000, P = 5 * M;
const clone = value => structuredClone(value);
function trade(extra = {}) { return { researchTradeId: 'rt:SYNTHETIC', researchFamily: 'GC', contextSymbol: null, executionProduct: 'MGC', executionContract: 'MGCZ9',
  direction: 'LONG', actualEntryTime: T, actualExitTime: T + 3 * P, actualEntryPrice: 100, actualExitPrice: 100, initialStop: 99, qualityStatus: 'READY', qualityReasons: [], ...extra }; }
function bar(time, high = 102, low = 99, extra = {}) { return { openTime: time, open: 100, high, low, close: 100, volume: 10, ...extra }; }
function series(bars = [bar(T, 102, 99), bar(T + P, 106, 98), bar(T + 2 * P, 110, 99)], extra = {}) {
  const timeframeMs = extra.timeframeMs ?? P;
  return { seriesId: 'SYNTHETIC-PRIMARY', role: 'EXECUTION_PRIMARY', provider: 'SYNTHETIC', providerSymbol: 'SYNTH:MGCZ9', researchFamily: 'GC', product: 'MGC', contract: 'MGCZ9',
    priceSourceMode: 'EXACT_EXECUTION_CONTRACT', timeframeMs, timestampSemantics: 'BAR_OPEN_TIME', timezone: 'UTC',
    coverageStart: bars[0]?.openTime ?? T, coverageEnd: bars.length ? bars.at(-1).openTime + timeframeMs : T + 3 * P, bars, ...extra };
}
function bundle(s = series(), extra = {}) { return { schemaVersion: 1, source: 'SYNTHETIC-POC', sourceVersion: '1', createdAt: T + 100 * P, series: Array.isArray(s) ? s : [s], ...extra }; }
const metric = (tr = trade(), bu = bundle(), opts = {}) => calculateMarketMetrics(tr, bu, opts);
function detailData({ high = 120, low = 80, midHigh = 102, midLow = 99 } = {}) {
  const fine = Array.from({ length: 5 }, (_, i) => bar(T + i * M, i === 0 ? high : midHigh, i === 0 ? low : midLow));
  const primary = series([bar(T, Math.max(high, midHigh), Math.min(low, midLow))]);
  const detail = series(fine, { seriesId: 'SYNTHETIC-DETAIL', role: 'EXECUTION_DETAIL', timeframeMs: M });
  return bundle([primary, detail]);
}

test('S4A 01 LONG 1R: entry=0R, original initial stop=-1R', () => {
  const t = trade(); assert.equal(initialRisk(t).initialRiskPoints, 1); assert.equal(rAtPrice(t, 100), 0); assert.equal(rAtPrice(t, 99), -1); assert.equal(rAtPrice(t, 104), 4);
});
test('S4A 02 SHORT 1R: unified R coordinate', () => { const t = trade({ direction: 'SHORT', initialStop: 101 }); assert.equal(initialRisk(t).initialRiskPoints, 1); assert.equal(rAtPrice(t, 100), 0); assert.equal(rAtPrice(t, 101), -1); assert.equal(rAtPrice(t, 96), 4); });
test('S4A 03 invalid LONG stop blocks without changing stop', () => { const t = trade({ initialStop: 102 }); assert.ok(metric(t).qualityReasons.includes('INITIAL_STOP_INVALID')); assert.equal(t.initialStop, 102); });
test('S4A 04 invalid SHORT stop blocks', () => assert.equal(metric(trade({ direction: 'SHORT', initialStop: 99 })).qualityStatus, 'BLOCKED'));
test('S4A 05 zero risk is invalid', () => assert.equal(initialRisk(trade({ initialStop: 100 })).valid, false));
test('S4A 06 milestone threshold prices are 2/4/6/8/10R in both directions', () => {
  for (const n of [2, 4, 6, 8, 10]) { assert.equal(thresholdPrice(trade(), n), 100 + n); assert.equal(thresholdPrice(trade({ direction: 'SHORT', initialStop: 101 }), n), 100 - n); }
});
test('S4A 07 LONG MFE uses favorable high and R', () => { const r = metric(); assert.equal(r.mfe.confirmedR, 10); assert.equal(r.mfe.confirmedPrice, 110); });
test('S4A 08 SHORT MFE uses favorable low', () => { const r = metric(trade({ direction: 'SHORT', initialStop: 101 }), bundle(series([bar(T, 101, 90), bar(T + P), bar(T + 2 * P)]))); assert.equal(r.mfe.confirmedR, 10); assert.equal(r.mfe.confirmedPrice, 90); });
test('S4A 09 LONG MAE retains positive magnitude and signed worstR', () => { const r = metric(); assert.equal(r.mae.confirmedR, 2); assert.equal(r.mae.worstR, -2); });
test('S4A 10 SHORT MAE uses adverse high', () => { const r = metric(trade({ direction: 'SHORT', initialStop: 101 })); assert.equal(r.mae.confirmedR, 10); assert.equal(r.mae.worstR, -10); });
test('S4A 11 fully contained bars produce exact complete holding metrics', () => { const r = metric(); assert.equal(r.coverageStatus, 'COMPLETE'); assert.equal(r.qualityStatus, 'READY'); assert.equal(r.mfe.exact, true); assert.equal(r.mae.exact, true); assert.equal(r.statisticsEligible, true); });
test('S4A 12 entry exactly bar open admits that bar extremes', () => { const r = metric(trade({ actualExitTime: T + P }), bundle(series([bar(T, 105, 98)]))); assert.equal(r.mfe.confirmedR, 5); assert.ok(!r.qualityReasons.includes('INTRABAR_BOUNDARY_AMBIGUOUS')); });
test('S4A 13 exit exactly bar close excludes the next bar high/low', () => {
  const r = metric(trade({ actualExitTime: T + P }), bundle(series([bar(T, 103), bar(T + P, 150, 50)]))); assert.equal(r.mfe.confirmedR, 3); assert.equal(r.mfe.possibleMaxR, 3);
});
test('S4A 14 entry mid-bar has confirmed lower bound and possible pre-entry extreme', () => {
  const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + P }), bundle(series([bar(T, 120, 80)])));
  assert.equal(r.mfe.confirmedR, 0); assert.equal(r.mfe.possibleMaxR, 20); assert.equal(r.mfe.exact, false); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED');
});
test('S4A 15 exit mid-bar high/low only contributes possible bounds', () => {
  const r = metric(trade({ actualExitTime: T + P + M }), bundle(series([bar(T, 102, 99), bar(T + P, 120, 80)])));
  assert.equal(r.mfe.confirmedR, 2); assert.equal(r.mfe.possibleMaxR, 20); assert.equal(r.mae.confirmedR, 1); assert.equal(r.mae.possibleMaxR, 20);
});
test('S4A 16 same-bar entry/exit never promotes whole bar high/low to confirmed', () => {
  const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + 2 * M }), bundle(series([bar(T, 120, 80)])));
  assert.equal(r.mfe.confirmedR, 0); assert.equal(r.mae.confirmedR, 0); assert.equal(r.mfe.possibleMaxR, 20); assert.equal(r.mae.possibleMaxR, 20);
});
test('S4A 17 full 1M detail removes pre-entry 5M extremes at minute-aligned boundary', () => {
  const tr = trade({ actualEntryTime: T + M, actualExitTime: T + P }); const b = detailData();
  assert.equal(metric(tr, bundle(b.series[0])).mfe.possibleMaxR, 20);
  const r = metric(tr, b); assert.equal(r.mfe.confirmedR, 2); assert.equal(r.mfe.possibleMaxR, 2); assert.equal(r.mae.possibleMaxR, 1); assert.equal(r.detailModeUsed, 'ON_DEMAND'); assert.equal(r.qualityStatus, 'READY');
});
test('S4A 18 entry within 1M retains intraminute ambiguity', () => {
  const b = detailData({ midHigh: 105, midLow: 95 });
  for (let i = 2; i < 5; i++) b.series[1].bars[i] = bar(T + i * M, 102, 99);
  const r = metric(trade({ actualEntryTime: T + M + 22000, actualExitTime: T + P }), b);
  assert.equal(r.mfe.confirmedR, 2); assert.equal(r.mfe.possibleMaxR, 5); assert.equal(r.mae.confirmedR, 1); assert.equal(r.mae.possibleMaxR, 5); assert.ok(r.qualityReasons.includes('INTRABAR_BOUNDARY_AMBIGUOUS'));
});
test('S4A 19 confirmed milestone retains first bar interval, not a fabricated second', () => {
  const m = metric().milestones['4R']; assert.equal(m.status, 'CONFIRMED_REACHED'); assert.equal(m.firstReachedBarOpen, T + P); assert.equal(m.firstReachedBarClose, T + 2 * P); assert.equal(m.firstReachConfirmed, true); assert.ok(!Object.hasOwn(m, 'firstReachedAt'));
});
test('S4A 20 boundary-only milestone is possible, not confirmed', () => { const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + P }), bundle(series([bar(T, 104, 99)]))); assert.equal(r.milestones['4R'].status, 'POSSIBLE_BOUNDARY_REACHED'); assert.equal(r.milestones['4R'].firstReachConfirmed, false); });
test('S4A 21 several milestones in one bar share interval without invented order', () => { const r = metric(); assert.equal(r.milestones['4R'].firstReachedBarOpen, r.milestones['6R'].firstReachedBarOpen); assert.equal(r.milestones['8R'].firstReachedBarOpen, r.milestones['10R'].firstReachedBarOpen); });
test('S4A 22 missing market window blocks formal metrics and never substitutes last bar for exit', () => {
  const tr = trade(), r = metric(tr, bundle(series([bar(T, 101)]))); assert.equal(r.coverageStatus, 'INCOMPLETE'); assert.equal(r.qualityStatus, 'BLOCKED'); assert.equal(r.holdingWindow.endAt, tr.actualExitTime); assert.equal(r.mfe.partial, true); assert.equal(r.mfe.possibleMaxR, null); assert.equal(r.milestones['2R'].status, 'DATA_INCOMPLETE');
});
test('S4A 23 gap inside holding window is explicit and incomplete', () => {
  const r = metric(trade(), bundle(series([bar(T, 101), bar(T + 2 * P, 101)]))); assert.ok(r.qualityReasons.includes('MARKET_DATA_GAP')); assert.equal(r.coverageStatus, 'INCOMPLETE'); assert.equal(r.coverageGaps.length, 1);
});
test('S4A 24 exact execution source keeps normal research quality', () => { const r = metric(); assert.equal(r.priceSourceMode, 'EXACT_EXECUTION_CONTRACT'); assert.equal(r.metricQuality, 'EXACT'); assert.equal(r.provenance.primary.contract, 'MGCZ9'); });
test('S4A 25 same-expiry large proxy is flagged and excluded from formal exact statistics', () => {
  const s = series(undefined, { product: 'GC', contract: 'GCZ9', providerSymbol: 'SYNTH:GCZ9', priceSourceMode: 'SAME_EXPIRY_LARGE_CONTRACT_PROXY', proxyForContract: 'MGCZ9' });
  const r = metric(trade(), bundle(s)); assert.equal(r.metricQuality, 'PROXY'); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED'); assert.ok(r.qualityReasons.includes('PRICE_SOURCE_PROXY')); assert.equal(r.statisticsEligible, false);
});
test('S4A 26 continuous proxy keeps both required flags', () => {
  const s = series(undefined, { product: 'GC', contract: 'GC1!', providerSymbol: 'SYNTH:GC1!', priceSourceMode: 'CONTINUOUS_CONTRACT_PROXY', proxyForContract: 'MGCZ9' });
  const r = metric(trade(), bundle(s)); assert.ok(r.qualityReasons.includes('CONTINUOUS_CONTRACT_PROXY')); assert.ok(r.qualityReasons.includes('PRICE_SOURCE_PROXY'));
});
test('S4A 27 context series never contributes to execution MFE or substitutes execution path', () => {
  const context = series([bar(T, 200, 1), bar(T + P, 200, 1), bar(T + 2 * P, 200, 1)], { seriesId: 'SYNTH-CONTEXT', role: 'CONTEXT', product: 'GC', contract: 'GC1!', providerSymbol: 'SYNTH:GC1!', priceSourceMode: 'CONTEXT_MARKET' });
  assert.equal(metric(trade(), bundle([series(), context])).mfe.confirmedR, 10); assert.equal(metric(trade(), bundle(context)).qualityStatus, 'BLOCKED');
});
test('S4A 28 wrong-market detail is rejected, never mixed into micro execution path', () => {
  const b = detailData(); b.series[1].product = 'GC'; b.series[1].contract = 'GC1!'; b.series[1].providerSymbol = 'SYNTH:GC1!';
  assert.ok(metric(trade(), b).qualityReasons.includes('DETAIL_MARKET_MISMATCH'));
});
test('S4A 29 duplicate bar times are rejected without deduplication', () => { const b = bundle(); b.series[0].bars[1].openTime = T; assert.ok(validateMarketDataBundle(b).qualityReasons.includes('DUPLICATE_BAR_OPEN_TIME')); });
test('S4A 30 unsorted bars are rejected without sorting', () => { const b = bundle(), before = clone(b); [b.series[0].bars[0], b.series[0].bars[1]] = [b.series[0].bars[1], b.series[0].bars[0]]; const dirty = clone(b); assert.ok(validateMarketDataBundle(b).qualityReasons.includes('UNSORTED_MARKET_BARS')); assert.deepEqual(b, dirty); assert.notDeepEqual(b, before); });
test('S4A 31 impossible OHLC is rejected without repair', () => { const b = bundle(); b.series[0].bars[0].high = 99; assert.ok(metric(trade(), b).qualityReasons.includes('MARKET_BAR_OHLC_INVALID')); });
test('S4A 32 negative volume is rejected', () => { const b = bundle(); b.series[0].bars[0].volume = -1; assert.ok(validateMarketDataBundle(b).qualityReasons.includes('MARKET_BAR_VOLUME_INVALID')); });
test('S4A 33 deterministic content fingerprint changes for changed bars or metadata', () => {
  const a = series(), b = clone(a); assert.equal(marketSeriesFingerprint(a), marketSeriesFingerprint(b)); b.bars[0].high += 1; assert.notEqual(marketSeriesFingerprint(a), marketSeriesFingerprint(b)); b.bars = clone(a.bars); b.provider = 'SYNTH-OTHER'; assert.notEqual(marketSeriesFingerprint(a), marketSeriesFingerprint(b));
});
test('S4A 34 createdAt and external artifact IDs do not change content identity', () => { const a = bundle(), b = clone(a); b.createdAt++; b.series[0].seriesId = 'SYNTH-REIMPORT'; assert.equal(marketBundleFingerprint(a), marketBundleFingerprint(b)); });
test('S4A 35 calculation repeated 100 times is byte-identical', () => { const t = trade(), b = detailData(), expected = JSON.stringify(metric(t, b)); for (let n = 0; n < 100; n++) assert.equal(JSON.stringify(metric(t, b)), expected); });
test('S4A 36 deep-frozen inputs unchanged, result provenance owns mutable data', () => {
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const t = freeze(trade()), b = freeze(bundle()), before = JSON.stringify([t, b]); const r = metric(t, b); r.provenance.primary.contract = 'SYNTH-EDIT'; r.holdingWindow.endAt++; assert.equal(JSON.stringify([t, b]), before); planMarketDataRequests(t); validateMarketDataBundle(b);
});
test('S4A 37 Step3 BLOCKED cannot be washed into READY by perfect market bars', () => { const r = metric(trade({ qualityStatus: 'BLOCKED', qualityReasons: ['INITIAL_STOP_MISSING_BEFORE_CORRECTION'] })); assert.equal(r.qualityStatus, 'BLOCKED'); assert.ok(r.qualityReasons.includes('STEP3_BLOCKED')); });
test('S4A 38 explicit context wins, research resolution never alters raw context', () => { const t = trade({ contextSymbol: 'SYNTH:EXPLICIT' }), p = planMarketDataRequests(t); assert.equal(p.requests[1].resolvedContextSymbol, 'SYNTH:EXPLICIT'); assert.equal(p.requests[1].contextSymbolSource, 'TASK_CARD_EXPLICIT'); assert.equal(t.contextSymbol, 'SYNTH:EXPLICIT'); });
test('S4A 39 null context resolves research default without mutating trade', () => { const t = trade(), r = resolveContextMarket(t); assert.equal(r.resolvedContextSymbol, 'GC1!'); assert.equal(r.contextSymbolSource, 'DEFAULT_RESEARCH_CONFIG'); assert.equal(t.contextSymbol, null); assert.equal(planMarketDataRequests(t).requests[0].providerSymbol, null); });
test('S4A 40 GC ES CL default context mapping is correct', () => { for (const family of ['GC', 'ES', 'CL']) assert.equal(resolveContextMarket(trade({ researchFamily: family })).resolvedContextSymbol, `${family}1!`); });

test('S4A risk ticks are opt-in trusted metadata; display decimals do not supply a tick', () => { assert.equal(metric().initialRiskTicks, null); assert.equal(metric(trade(), bundle(), { executionTickSize: .25 }).initialRiskTicks, 4); assert.equal(metric(trade(), bundle(), { executionTickSize: 0 }).qualityStatus, 'BLOCKED'); });
test('S4A gap outside holding window is recorded but does not invalidate complete metrics', () => {
  const s = series([bar(T - 2 * P), bar(T), bar(T + P), bar(T + 2 * P)]); const b = bundle(s);
  assert.ok(validateMarketDataBundle(b).series[0].qualityFlags.includes('MARKET_DATA_GAP')); const r = metric(trade(), b); assert.equal(r.coverageStatus, 'COMPLETE'); assert.equal(r.qualityStatus, 'READY');
});
test('S4A partial detail falls back to conservative primary bounds', () => {
  const b = detailData(); b.series[1] = series(b.series[1].bars.slice(0, 3), { role: 'EXECUTION_DETAIL', seriesId: 'SYNTHETIC-DETAIL', timeframeMs: M });
  const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + P }), b); assert.equal(r.mfe.possibleMaxR, 20); assert.ok(r.qualityReasons.includes('DETAIL_COVERAGE_INCOMPLETE'));
});
test('S4A detail aggregate contradictions block metrics', () => { const b = detailData(); b.series[1].bars[0].high = 150; assert.ok(metric(trade(), b).qualityReasons.includes('DETAIL_AGGREGATION_CONFLICT')); });
test('S4A primary and detail provenance are separate content identities', () => { const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + P }), detailData()); assert.notEqual(r.provenance.primary.fingerprint, r.provenance.detail.fingerprint); assert.equal(r.provenance.detail.timeframeMs, M); });
test('S4A wrong expiry proxy rejected and exact source prioritized over proxy', () => {
  const wrong = series(undefined, { product: 'GC', contract: 'GCH9', providerSymbol: 'SYNTH:GCH9', priceSourceMode: 'SAME_EXPIRY_LARGE_CONTRACT_PROXY', proxyForContract: 'MGCZ9' });
  assert.equal(metric(trade(), bundle(wrong)).qualityStatus, 'BLOCKED'); wrong.contract = 'GCZ9'; wrong.seriesId = 'SYNTH-PROXY';
  assert.equal(metric(trade(), bundle([wrong, series()])).priceSourceMode, 'EXACT_EXECUTION_CONTRACT');
});
test('S4A multiple equal priority execution series require an explicit selection', () => {
  const a = series(), b = clone(a); b.seriesId = 'SYNTH-SECOND'; b.bars[0].high += 1;
  assert.ok(metric(trade(), bundle([a, b])).qualityReasons.includes('EXECUTION_SERIES_AMBIGUOUS'));
  assert.equal(metric(trade(), bundle([a, b]), { primarySeriesId: a.seriesId }).qualityStatus, 'READY');
});
test('S4A milestone confirmed later does not falsely assert first boundary hit was confirmed', () => {
  const s = series([bar(T, 104), bar(T + P, 104)]), r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + 2 * P }), bundle(s)).milestones['4R'];
  assert.equal(r.status, 'CONFIRMED_REACHED'); assert.equal(r.firstReachedBarOpen, T); assert.equal(r.firstConfirmedBarOpen, T + P); assert.equal(r.firstReachConfirmed, false);
});
test('S4A fine detail narrows milestone interval on a full primary bar', () => {
  const b = detailData({ high: 102, low: 99, midHigh: 104 }); for (let i = 1; i < 3; i++) b.series[1].bars[i].high = 102;
  const m = metric(trade({ actualExitTime: T + P }), b).milestones['4R']; assert.equal(m.firstReachedBarOpen, T + 3 * M); assert.equal(m.firstReachedBarClose, T + 4 * M);
});
test('S4A missing path never uses context or promotes Step3 REVIEW_REQUIRED', () => { assert.equal(metric(trade(), bundle([])).qualityStatus, 'BLOCKED'); assert.equal(metric(trade({ qualityStatus: 'REVIEW_REQUIRED', qualityReasons: ['ENTRY_REVIEW_WINDOW'] })).qualityStatus, 'REVIEW_REQUIRED'); });
test('S4A nonfinite price, naive time, schema drift, overlapping bars and metadata lies rejected', () => {
  const variants = [b => b.series[0].bars[0].open = Infinity, b => b.series[0].bars[0].openTime = '01/01/2035 00:00', b => b.unexpected = true,
    b => b.series[0].coverageEnd += P, b => b.series[0].bars[1].openTime = T + M, b => b.series[0].bars[0] = null];
  for (const mutate of variants) { const b = bundle(); mutate(b); assert.equal(validateMarketDataBundle(b).valid, false); }
});
test('S4A bounded numerical math refuses overflow rather than reporting zero R', () => {
  const t = trade({ actualEntryPrice: 1e-300, actualExitPrice: 1e-300, initialStop: 5e-301 });
  assert.ok(metric(t, bundle(series([bar(T, 1e308, 1e-301, { open: 1e-300, close: 1e-300 })]))).qualityReasons.includes('R_NUMERIC_OVERFLOW'));
});
test('S4A all new browser modules are pure and frozen modules remain separate', () => {
  for (const file of ['market-config', 'market-request', 'market-data', 'r-math', 'path-metrics', 'milestones', 'market-metrics']) {
    const code = readFileSync(`src/exit-research/${file}.js`, 'utf8'); assert.ok(!/\b(?:fetch|localStorage|document|window)\b|Date\.now|Math\.random/.test(code), file);
  }
});

test('S4A CLI synthetic POC is read-only, deterministic, aggregate-only and keeps private facts out of stdout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'market-metrics-poc-'));
  try {
    const t = trade({ accountId: 'SYNTH-PRIVATE-ACCOUNT', fillIds: ['SYNTH-PRIVATE-FILL'] }), b = bundle();
    const paths = [join(dir, 'trade.json'), join(dir, 'bundle.json')]; [t, b].forEach((value, i) => writeFileSync(paths[i], JSON.stringify(value)));
    const bytes = paths.map(path => readFileSync(path));
    const result = spawnSync(process.execPath, ['scripts/qa-market-metrics.mjs', ...paths], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); const output = JSON.parse(result.stdout);
    assert.equal(output.qualityStatus, 'READY'); assert.equal(output.mfe.confirmedR, 10); assert.equal(output.deterministicRepeats, 100);
    for (const secret of ['SYNTH-PRIVATE-ACCOUNT', 'SYNTH-PRIVATE-FILL', t.researchTradeId, '2035', 'SYNTH:MGCZ9', 'market-series-v1:']) assert.ok(!result.stdout.includes(secret));
    paths.forEach((path, i) => assert.deepEqual(readFileSync(path), bytes[i]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('S4A absolute epoch metrics do not change across host timezones', () => {
  const code = `import { calculateMarketMetrics } from './src/exit-research/market-metrics.js'; console.log(JSON.stringify(calculateMarketMetrics(${JSON.stringify(trade())},${JSON.stringify(bundle())})));`;
  const outputs = ['UTC', 'America/Chicago', 'Asia/Shanghai'].map(TZ => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ } });
    assert.equal(run.status, 0, run.stderr); return run.stdout;
  }); assert.equal(outputs[0], outputs[1]); assert.equal(outputs[1], outputs[2]);
});
test('S4A SHORT milestone statuses use lows, not favorable LONG highs', () => {
  const b = bundle(series([bar(T, 101, 90)])); const r = metric(trade({ direction: 'SHORT', initialStop: 101, actualExitTime: T + P }), b);
  assert.ok(Object.values(r.milestones).every(m => m.status === 'CONFIRMED_REACHED'));
});
test('S4A actual exit price may confirm milestone but its exact timestamp is not asserted as first reach', () => {
  const t = trade({ actualEntryTime: T + M, actualExitTime: T + 2 * M, actualExitPrice: 104 });
  const r = metric(t, bundle(series([bar(T, 106, 98)]))).milestones['4R'];
  assert.equal(r.status, 'CONFIRMED_REACHED'); assert.equal(r.confirmedObservationAt, t.actualExitTime); assert.equal(r.firstReachConfirmed, false); assert.equal(r.firstReachedBarOpen, T);
});
test('S4A trust boundary rejects missing Step3 quality, missing stop and unsupported timing semantics', () => {
  assert.equal(metric(trade({ qualityStatus: undefined })).qualityStatus, 'BLOCKED');
  assert.ok(metric(trade({ initialStop: null })).qualityReasons.includes('INITIAL_STOP_MISSING'));
  const b = bundle(); b.series[0].timestampSemantics = 'BAR_CLOSE_TIME'; assert.equal(validateMarketDataBundle(b).valid, false);
});
test('S4A integration consumes frozen model/parser/reconstruction/Research Trade without changing their facts', () => {
  const state = createWorkspace(T - 1000);
  changeStructure(state, 'GC', 'range', T - 999); changeDirection(state, 'GC', 'long', T - 998); chooseSetup(state, 'GC', 'mtf_pb', T - 997);
  markEntered(state, 'GC', T, true); recordInitialStop(state, 'GC', 99, T + 1); markExited(state, 'GC', T + 3 * P, true);
  const rows = [fillRow({ product: 'MGC', contract: 'MGCZ9', price: 100, time: new Date(T).toISOString() }),
    fillRow({ fillId: '900000000000002', orderId: '900000000001002', product: 'MGC', contract: 'MGCZ9', side: 'Sell', price: 100, time: new Date(T + 3 * P).toISOString() })];
  const trades = reconstructLogicalTrades(parseTradovateFillsCsv(fillsCsv(rows)).rows, { assumeFlatAtStart: true }).closedTrades;
  const rt = buildResearchTrades(state.records, trades).researchTrades[0], before = clone(rt), result = metric(rt);
  assert.equal(result.initialRiskPoints, 1); assert.equal(result.mfe.confirmedR, 10); assert.equal(result.qualityStatus, 'REVIEW_REQUIRED');
  assert.equal(rt.contextSymbol, null); assert.deepEqual(rt, before); assert.ok(result.qualityReasons.includes('STEP3_REVIEW_REQUIRED'));
});
test('S4A request includes overlapping boundary bars and unknown family is blocked', () => {
  const t = trade({ actualEntryTime: T + 22000 }), plan = planMarketDataRequests(t);
  assert.equal(plan.requests[0].requiredStartAt, t.actualEntryTime); assert.equal(plan.requests[0].includeOverlappingBars, true);
  assert.equal(planMarketDataRequests(trade({ researchFamily: 'UNKNOWN', executionProduct: null })).status, 'BLOCKED');
});
test('S4A boundary open/close without trade-print timestamps never fabricate confirmed excursions', () => {
  const s = series([bar(T, 110, 90, { open: 110, close: 110 })]);
  const r = metric(trade({ actualEntryTime: T + M, actualExitTime: T + P }), bundle(s));
  assert.equal(r.mfe.confirmedR, 0); assert.equal(r.mfe.possibleMaxR, 10); assert.equal(r.milestones['4R'].status, 'POSSIBLE_BOUNDARY_REACHED');
});
test('S4A independent per-second path oracle stays within reported LONG/SHORT excursion bounds', () => {
  const prices = Array.from({ length: 1200 }, (_, i) => 100 + ((i * 37 + Math.floor(i / 11)) % 29 - 14) / 10);
  const bars = Array.from({ length: 4 }, (_, i) => {
    const values = prices.slice(i * 300, (i + 1) * 300);
    return bar(T + i * P, Math.max(...values), Math.min(...values), { open: values[0], close: values.at(-1) });
  });
  const b = bundle(series(bars));
  for (const [start, end] of [[0, 1199], [22, 1199], [300, 899], [322, 742], [599, 600], [60, 121], [301, 599], [777, 777]]) {
    for (const direction of ['LONG', 'SHORT']) {
      const entry = prices[start], t = trade({ direction, actualEntryTime: T + start * 1000, actualExitTime: T + end * 1000,
        actualEntryPrice: entry, actualExitPrice: prices[end], initialStop: entry + (direction === 'LONG' ? -1 : 1) });
      const r = metric(t, b), values = prices.slice(start, end + 1).map(price => direction === 'LONG' ? price - entry : entry - price);
      const trueMfe = Math.max(0, ...values), trueMae = Math.max(0, ...values.map(value => -value));
      assert.ok(r.mfe.confirmedR <= trueMfe + 1e-10); assert.ok(trueMfe <= r.mfe.possibleMaxR + 1e-10);
      assert.ok(r.mae.confirmedR <= trueMae + 1e-10); assert.ok(trueMae <= r.mae.possibleMaxR + 1e-10);
      for (const [key, m] of Object.entries(r.milestones)) {
        if (m.status === 'CONFIRMED_REACHED') assert.ok(trueMfe + 1e-10 >= Number.parseInt(key));
        if (m.status === 'NOT_REACHED') assert.ok(trueMfe < Number.parseInt(key));
      }
    }
  }
});
