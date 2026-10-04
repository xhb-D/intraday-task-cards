import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildResearchTrades } from '../src/exit-research/research-trade.js';
import { createWorkspace, changeDirection, changeStructure, chooseSetup, markEntered, recordInitialStop, recordBofToPb, markExited } from '../src/model.js';
import { parseTradovateFillsCsv } from '../src/exit-research/tradovate-csv.js';
import { reconstructLogicalTrades } from '../src/exit-research/logical-trade.js';
import { fillRow, fillsCsv } from './fixtures/tradovate/synthetic.js';
import { readFileSync } from 'node:fs';
import { replayExitPolicy } from '../src/exit-research/replay-engine.js';
import { POLICIES_V1 } from '../src/exit-research/policies-v1.js';
import { validateExitPolicy, stageAtMfe } from '../src/exit-research/policy-schema.js';
import { calculateProtectionR, protectionAtR } from '../src/exit-research/protection.js';
import { stopFill } from '../src/exit-research/execution-model.js';
import { auditReplayLookahead } from '../src/exit-research/lookahead-qa.js';
import { planReplayMarketDataRequests } from '../src/exit-research/replay-request.js';
import { planMarketDataRequests } from '../src/exit-research/market-request.js';
const T = Date.UTC(2037, 0, 1), P = 300000, M = 60000;
const clone = structuredClone;
function trade(extra = {}) { return { researchTradeId: 'rt:SYNTHETIC-REPLAY', researchFamily: 'GC', contextSymbol: null,
  executionProduct: 'MGC', executionContract: 'MGCZ9', direction: 'LONG', actualEntryTime: T, actualEntryPrice: 100,
  actualExitTime: T + P, actualExitPrice: 100, initialStop: 99, originalSetup: 'mtf_pb', researchSetupClass: 'PB', manualEvents: [], qualityStatus: 'READY', qualityReasons: [], ...extra }; }
const bar = (i, high = 101, low = 99.5, open = 100, close = 100) => ({ openTime: T + i * P, open, high, low, close, volume: 10 });
function series(bars, extra = {}) { const timeframeMs = extra.timeframeMs ?? P; return { seriesId: 'SYNTHETIC-P', role: 'EXECUTION_PRIMARY', provider: 'SYNTHETIC', providerSymbol: 'SYNTH:MGCZ9', researchFamily: 'GC', product: 'MGC', contract: 'MGCZ9',
  priceSourceMode: 'EXACT_EXECUTION_CONTRACT', timeframeMs, timestampSemantics: 'BAR_OPEN_TIME', timezone: 'UTC', coverageStart: bars[0].openTime,
  coverageEnd: bars.at(-1).openTime + timeframeMs, bars, ...extra }; }
const bundle = bars => ({ schemaVersion: 1, source: 'SYNTHETIC', sourceVersion: '1', createdAt: T, series: [series(bars)] });
const defaults = () => [bar(0), bar(1), bar(2)];
const run = (tr = trade(), bars = defaults(), opts = {}) => replayExitPolicy(tr, Array.isArray(bars) ? bundle(bars) : bars, {
  policyId: tr.researchSetupClass === 'BOF' ? 'BOF_BASELINE_V1' : 'PB_BASELINE_V1', replayHardEndAt: T + 3 * P, executionTickSize: .1, ...opts });
const bof = extra => trade({ originalSetup: 'htf_bof', researchSetupClass: 'BOF', ...extra });
const switchEvent = (at = T + P + 20000) => ({ id: 'synthetic:manual-1', type: 'BOF_TO_PB_RECORDED', recordedAt: at, effectiveAt: at, source: 'manual_intraday', payload: { from: 'BOF', to: 'PB' } });
const hasReason = (r, reason) => assert.ok(r.qualityReasons.includes(reason), JSON.stringify(r.qualityReasons));
const ok = r => { assert.equal(r.lookaheadQaStatus, 'PASS', JSON.stringify(r.lookaheadQaReasons)); assert.notEqual(r.qualityStatus, 'BLOCKED', JSON.stringify(r.qualityReasons)); return r; };
function rising(h = 7) { return [bar(0, h + 100, 99.5, 100, h + 100), bar(1, h + 101, h + 100, h + 100, h + 100), bar(2, h + 101, h + 100, h + 100, h + 100)]; }
const pb = POLICIES_V1.PB_BASELINE_V1, bf = POLICIES_V1.BOF_BASELINE_V1;
for (const [i, name, mfe] of [[1, 'INITIAL', 1.9], [2, 'RUNNER', 2], [3, 'PROTECT', 6], [4, 'EXTREME', 8], [5, 'SOFT_CEILING', 10]]) {
  test(`S4B ${String(i).padStart(2, '0')} PB ${name}`, () => assert.equal(stageAtMfe(pb, mfe).name, name));
}
test('S4B 06 BOF all stages and no automatic BE at 2R', () => { assert.deepEqual([0, 2, 4, 6, 8].map(m => stageAtMfe(bf, m).name), ['INITIAL', 'RUNNER', 'TARGET_REVIEW', 'EXTREME', 'SOFT_CEILING']); assert.equal(calculateProtectionR(-1, 3, bf.stages[1]), -1); });
for (const [i, pct, mfe, expected] of [[7, .3, 6, 4.2], [8, .25, 8, 6], [9, .2, 10, 8]]) test(`S4B ${String(i).padStart(2, '0')} giveback ${pct}`, () => assert.ok(Math.abs(calculateProtectionR(-1, mfe, { givebackPct: pct, minimumLockR: null }) - expected) < 1e-12));
test('S4B 10 tight variants only alter giveback strength', () => { for (const setup of ['PB', 'BOF']) { const a = POLICIES_V1[`${setup}_BASELINE_V1`], b = POLICIES_V1[`${setup}_TIGHT_GIVEBACK_V1`]; assert.deepEqual(a.stages.map(s => s.activateAtMfeR), b.stages.map(s => s.activateAtMfeR)); assert.deepEqual(b.stages.slice(2).map(s => s.givebackPct), [.25, .2, .15]); } assert.equal(ok(run(trade(), rising(7), { policyId: 'PB_TIGHT_GIVEBACK_V1' })).finalActiveProtectionR, 6.4); });
test('S4B 11 protection never loosens and optional minimum lock', () => { assert.equal(calculateProtectionR(6, 5, bf.stages[2]), 6); assert.equal(calculateProtectionR(-1, 3, { givebackPct: null, minimumLockR: .5 }), .5); });
test('S4B 12 high and low in same bar cannot hit newly calculated stop', () => { const r = ok(run(trade(), rising(7))); assert.equal(r.auditBars[0].activeProtectionR, -1); assert.equal(r.auditBars[0].next.protectionR, 4.8999999999999995); assert.equal(r.exitReason, 'REPLAY_HARD_END'); });
test('S4B 13 protection becomes effective on next bar', () => { const r = ok(run(trade(), [rising(7)[0], bar(1, 108, 103, 107, 104), bar(2)])); assert.equal(r.exitReason, 'STOP_TRIGGERED'); assert.equal(r.simulatedExitPrice, 104.9); assert.equal(r.simulatedExitTime, null); assert.deepEqual(r.simulatedExitTimeRange, { startAt: T + P, endAt: T + 2 * P, semantics: 'BAR_INTERVAL_END_EXCLUSIVE' }); });
test('S4B 14 LONG normal stop fill', () => assert.equal(stopFill('LONG', bar(0, 101, 98), 99, T + P).price, 99));
test('S4B 15 SHORT normal stop fill', () => assert.equal(stopFill('SHORT', bar(0, 102, 99), 101, T + P).price, 101));
test('S4B 16 LONG gap through uses adverse open', () => { const r = ok(run(trade(), [bar(0, 101, 97, 98), bar(1), bar(2)])); assert.equal(r.simulatedExitPrice, 98); assert.equal(r.exitReason, 'STOP_GAP_THROUGH'); });
test('S4B 17 SHORT gap through uses adverse open', () => { const r = ok(run(trade({ direction: 'SHORT', initialStop: 101 }), [bar(0, 103, 99, 102), bar(1), bar(2)])); assert.equal(r.simulatedExitPrice, 102); });
test('S4B 18 no extra slippage and equal-open stop', () => { const r = ok(run(trade(), [bar(0, 101, 98), bar(1), bar(2)])); assert.equal(r.simulatedExitPrice, 99); assert.equal(r.slippageModelVersion, 'NONE_V1'); assert.equal(stopFill('LONG', bar(0, 101, 98, 99), 99, T + P).reason, 'STOP_GAP_THROUGH'); });
test('S4B 19 LONG tick conservatively rounds down', () => assert.equal(protectionAtR(trade(), 4.34, .1).price, 104.30000000000001));
test('S4B 20 SHORT tick conservatively rounds up', () => assert.equal(protectionAtR(trade({ direction: 'SHORT', initialStop: 101 }), 4.34, .1).price, 95.7));
test('S4B 21 tick unavailable preserves theoretical price and review', () => { const r = ok(run(trade(), rising(7), { executionTickSize: null })); hasReason(r, 'TICK_ROUNDING_UNAVAILABLE'); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED'); });
function switched() { return run(bof({ manualEvents: [switchEvent()] }), [bar(0, 105, 99.5, 100, 105), bar(1, 105, 104, 105, 105), bar(2, 105, 104, 105, 105)]); }
test('S4B 22 BOF to PB retains frozen 1R', () => assert.equal(ok(switched()).initialRiskPoints, 1));
test('S4B 23 BOF to PB never resets known MFE', () => assert.equal(ok(switched()).maxKnownMfeR, 5));
test('S4B 24 BOF to PB inherits protection in PB RUNNER', () => { const r = ok(switched()); assert.equal(r.finalPolicyId, 'PB_BASELINE_V1'); assert.equal(r.finalStage, 'RUNNER'); assert.equal(r.finalActiveProtectionR, 3.5); });
test('S4B 25 midbar manual transition only effective at following 5M open', () => { const r = ok(switched()); const e = r.trace.find(e => e.type === 'POLICY_SWITCH_EFFECTIVE'); assert.equal(e.at, T + 2 * P); assert.equal(r.auditBars[1].activePolicyId, 'BOF_BASELINE_V1'); });
test('S4B 26 FIXED_INITIAL_SETUP ignores conversion but trace retains fact', () => { const tr = bof({ manualEvents: [switchEvent()] }); const r = ok(run(tr, [bar(0, 105, 99.5, 100, 105), bar(1, 105, 104, 105, 105), bar(2, 105, 104, 105, 105)], { setupStateSource: 'FIXED_INITIAL_SETUP' })); assert.equal(r.finalPolicyId, 'BOF_BASELINE_V1'); assert.equal(r.trace.find(e => e.type === 'BOF_TO_PB_MANUAL_RECORDED').ignoredForPolicy, true); });
test('S4B 27 original setup/events remain byte equivalent', () => { const tr = bof({ manualEvents: [switchEvent()] }), before = clone(tr); run(tr); assert.deepEqual(tr, before); });
test('S4B 28 Hard Ceiling exits at next bar open', () => { const r = ok(run(trade(), rising(11), { policyId: 'PB_HARD_CEILING_V1' })); assert.equal(r.exitReason, 'HARD_CEILING'); assert.equal(r.simulatedExitTime, T + P); assert.equal(r.simulatedExitPrice, 111); });
test('S4B 29 Hard Ceiling cannot same-bar backfill at threshold', () => { const r = ok(run(trade(), [bar(0, 112, 99.5, 100, 112), bar(1, 114, 110, 113, 112), bar(2)], { policyId: 'PB_HARD_CEILING_V1' })); assert.equal(r.simulatedExitPrice, 113); assert.notEqual(r.simulatedExitPrice, 110); });
test('S4B 30 Soft Ceiling has no forced exit', () => { const r = ok(run(trade(), rising(11))); assert.equal(r.exitReason, 'REPLAY_HARD_END'); assert.ok(!r.trace.some(e => e.type === 'HARD_CEILING_CONFIRMED')); });
test('S4B 31 Actual Exit never terminates simulation or supplies a mark', () => { const a = ok(run()), b = ok(run(trade({ actualExitTime: T, actualExitPrice: 10000 }))); assert.equal(a.simulatedExitTime, T + 3 * P); assert.deepEqual(a, b); });
test('S4B 32 exact Hard End uses final complete primary close', () => { const r = ok(run(trade(), [bar(0), bar(1), bar(2, 103, 99.5, 100, 102)])); assert.equal(r.simulatedExitPrice, 102); assert.equal(r.exitReason, 'REPLAY_HARD_END'); });
test('S4B 33 midbar Hard End cannot read future close', () => { const r = run(trade(), defaults(), { replayHardEndAt: T + 2 * P + M }); assert.equal(r.qualityStatus, 'BLOCKED'); hasReason(r, 'HARD_END_BOUNDARY_AMBIGUOUS'); assert.equal(r.simulatedExitPrice, null); });
test('S4B 34 coverage must extend to configured Replay Hard End', () => { const r = run(trade(), [bar(0)]); hasReason(r, 'REPLAY_MARKET_DATA_INCOMPLETE'); assert.equal(r.simulatedExitPrice, null); });
test('S4B 35 possible entry boundary extreme cannot activate stage', () => { const r = ok(run(trade({ actualEntryTime: T + 22000 }), [bar(0, 120), bar(1), bar(2)])); assert.equal(r.maxKnownMfeR, 1); assert.equal(r.finalActiveProtectionR, -1); hasReason(r, 'ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION'); });
function detailBundle() { const fine = Array.from({ length: 15 }, (_, i) => ({ openTime: T + i * M, open: i < 5 ? 100 : 107, close: i < 5 ? 100 : 107, high: i < 1 ? 120 : i < 5 ? 107 : 108, low: i < 5 ? 99.5 : 107, volume: 10 })); const b = bundle([bar(0, 120), bar(1, 108, 107, 107, 107), bar(2, 108, 107, 107, 107)]); b.series.push(series(fine, { seriesId: 'SYNTHETIC-D', role: 'EXECUTION_DETAIL', timeframeMs: M })); return b; }
test('S4B 36 fully confirmed detail entry subset activates only at 5M close', () => { const r = ok(run(trade({ actualEntryTime: T + M }), detailBundle())); assert.equal(r.auditBars[0].knownMfeAfter, 7); assert.equal(r.auditBars[0].next.stage, 'PROTECT'); assert.equal(r.auditBars[1].activeStage, 'PROTECT'); assert.ok(r.trace.filter(e => e.type === 'PROTECTION_CALCULATED').every(e => (e.at - T) % P === 0)); });
test('S4B 37 several milestones share bar interval without fake seconds', () => { const r = ok(run(trade(), rising(11))); const m = r.trace.filter(e => e.type === 'MILESTONE_REACHED' && e.at === T + P); assert.equal(m.length, 5); assert.ok(m.every(e => e.firstReachedBarOpen === T && e.firstReachedBarClose === T + P)); });
test('S4B 38 trace cause confirmed before effect and stop check before updates', () => { const r = ok(run()); for (const e of r.trace) if (e.causeSequence !== null) assert.ok(e.causeSequence < e.sequence); assert.equal(r.trace[0].type, 'ENTRY'); assert.equal(r.trace[1].type, 'INITIAL_STOP_ACTIVE'); });
test('S4B 39 early trace contains no future or final fields', () => { const a = ok(run(trade(), defaults())), b = ok(run(trade(), [bar(0), bar(1), bar(2, 130)])); assert.deepEqual(a.trace.filter(e => e.at < T + 2 * P), b.trace.filter(e => e.at < T + 2 * P)); assert.ok(a.trace.every(e => !Object.hasOwn(e, 'finalExit'))); });
test('S4B 40 independent Lookahead audit passes legitimate run', () => assert.deepEqual(auditReplayLookahead(ok(run()), trade()), { status: 'PASS', reasons: [] }));
test('S4B 41 intentionally wrong same-bar and future fixtures fail QA', () => { const a = ok(run(trade(), rising(7))); for (const mutate of [r => r.auditBars[0].activeProtectionR = 4.9, r => r.auditBars[0].knownMfeBefore = 7, r => r.auditBars[0].next.effectiveAt = T, r => r.trace[0].finalExit = 99, r => r.auditBars[0].evidence[0].fullyContained = false, r => r.trace.find(e => e.type === 'PROTECTION_EFFECTIVE').at = T]) { const b = clone(a); mutate(b); assert.equal(auditReplayLookahead(b, trade()).status, 'FAIL'); } });
test('S4B 42 same input 100 repetitions deterministic', () => { const tr = trade(), b = bundle(rising(7)), opts = { policyId: 'PB_BASELINE_V1', replayHardEndAt: T + 3 * P, executionTickSize: .1 }; const expected = replayExitPolicy(tr, b, opts); for (let i = 0; i < 100; i++) assert.deepEqual(replayExitPolicy(tr, b, opts), expected); });
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
test('S4B 43 deep frozen inputs not mutated', () => ok(run(freeze(trade()), freeze(bundle(rising(7))), freeze({}))));
test('S4B 44 Step3 BLOCKED never upgraded', () => { const r = run(trade({ qualityStatus: 'BLOCKED', qualityReasons: ['MATCH_AMBIGUOUS'] })); hasReason(r, 'STEP3_BLOCKED'); assert.equal(r.qualityStatus, 'BLOCKED'); });
test('S4B 45 proxy quality propagates and execution tick remains caller supplied', () => { const b = bundle(defaults()); Object.assign(b.series[0], { product: 'GC', contract: 'GC1!', providerSymbol: 'SYNTH:GC1!', proxyForContract: 'MGCZ9', priceSourceMode: 'CONTINUOUS_CONTRACT_PROXY', tickSize: 10 }); const r = ok(run(trade(), b, { executionTickSize: null })); hasReason(r, 'PRICE_SOURCE_PROXY'); hasReason(r, 'CONTINUOUS_CONTRACT_PROXY'); hasReason(r, 'TICK_ROUNDING_UNAVAILABLE'); assert.equal(r.statisticsEligible, false); });
test('S4B 46 invalid policy fails closed', () => { const policies = clone(POLICIES_V1); policies.PB_BASELINE_V1.allowProtectionLoosening = true; const r = run(trade(), defaults(), { policies }); hasReason(r, 'POLICY_SCHEMA_INVALID'); assert.equal(r.simulatedExitPrice, null); });
test('S4B 47 invalid giveback rejected', () => { for (const givebackPct of [-1, 0, 1, NaN]) { const p = clone(pb); p.stages[2].givebackPct = givebackPct; assert.equal(validateExitPolicy(p).valid, false); } });
test('S4B 48 duplicate/overlapping thresholds and unknown range fields rejected', () => { for (const mutate of [p => p.stages[2].activateAtMfeR = 2, p => p.stages[2].endAtMfeR = 8, p => p.stages[2].name = 'RUNNER']) { const p = clone(pb); mutate(p); assert.equal(validateExitPolicy(p).valid, false); } });
test('S4B 49 missing/invalid Hard End fails before run', () => { for (const replayHardEndAt of [undefined, T, T - 1, NaN, '2037']) hasReason(run(trade(), defaults(), { replayHardEndAt }), 'REPLAY_HARD_END_INVALID'); });
test('S4B 50 RESEARCH_TRANSITION_RULE explicitly not configured', () => hasReason(run(trade(), defaults(), { setupStateSource: 'RESEARCH_TRANSITION_RULE' }), 'RESEARCH_TRANSITION_RULE_NOT_CONFIGURED'));
test('S4B 51 separate Replay request leaves Actual Holding request unchanged', () => { const tr = trade(), before = planMarketDataRequests(tr), replay = planReplayMarketDataRequests(tr, { replayHardEndAt: T + 10 * P }); assert.equal(replay.requests[0].requiredEndAt, T + 10 * P); assert.equal(replay.requests[0].providerSymbol, null); assert.equal(replay.purpose, 'POLICY_REPLAY'); assert.deepEqual(planMarketDataRequests(tr), before); assert.equal(before.requests[0].requiredEndAt, T + P); });
test('S4B 52 manual recorded at exact 5M open belongs new bar', () => { const r = ok(run(bof({ manualEvents: [switchEvent(T + P)] }))); const e = r.trace.find(e => e.type === 'POLICY_SWITCH_EFFECTIVE'); assert.equal(e.at, T + 2 * P); });
test('S4B 53 manual revert is chronological and never retroactive', () => { const event = switchEvent(T + 20000), at = T + P + 20000; const revert = { id: 'synthetic:manual-2', type: 'BOF_TO_PB_REVERTED', recordedAt: at, effectiveAt: at, source: 'manual_intraday', payload: { from: 'PB', to: 'BOF', revertedEventId: event.id } }; const r = ok(run(bof({ manualEvents: [event, revert] }))); assert.deepEqual(r.auditBars.map(b => b.activePolicyId), ['BOF_BASELINE_V1', 'PB_BASELINE_V1', 'BOF_BASELINE_V1']); });
test('S4B 54 ambiguous entry stop is blocked rather than pre-entry fill', () => { const r = run(trade({ actualEntryTime: T + M }), [bar(0, 103, 98), bar(1), bar(2)]); hasReason(r, 'ENTRY_STOP_BOUNDARY_AMBIGUOUS'); assert.equal(r.simulatedExitPrice, null); });
test('S4B 55 ambiguous hard end stop is blocked rather than post-end fill', () => hasReason(run(trade(), [bar(0), bar(1), bar(2, 101, 98)], { replayHardEndAt: T + 2 * P + M }), 'HARD_END_STOP_BOUNDARY_AMBIGUOUS'));
test('S4B 56 detail-aligned Hard End uses completed 1M close', () => { const r = ok(run(trade({ actualEntryTime: T + M }), detailBundle(), { replayHardEndAt: T + 2 * P + M })); assert.equal(r.simulatedExitTime, T + 2 * P + M); assert.equal(r.simulatedExitPrice, 107); });
test('S4B 57 explicit Hard End mark is independently identified', () => { const r = ok(run(trade(), defaults(), { replayHardEndAt: T + 2 * P + 20000, hardEndMark: { at: T + 2 * P + 20000, price: 100.5, seriesId: 'SYNTHETIC-P', source: 'SYNTHETIC-MARK' } })); assert.equal(r.simulatedExitPrice, 100.5); assert.equal(r.simulatedExitTimeRange.semantics, 'EXPLICIT_MARK'); hasReason(r, 'HARD_END_EXPLICIT_MARK'); });
test('S4B 58 detail identity/conflict and inside-window gap block', () => { const b = detailBundle(); b.series[1].contract = 'MGCZ8'; hasReason(run(trade(), b), 'DETAIL_MARKET_MISMATCH'); const c = detailBundle(); c.series[1].bars[1].high = 121; hasReason(run(trade(), c), 'DETAIL_AGGREGATION_CONFLICT'); hasReason(run(trade(), [bar(0), bar(2)]), 'REPLAY_MARKET_DATA_INCOMPLETE'); });
test('S4B 59 short mirrored protection and stop replay', () => { const bars = [bar(0, 100.5, 93, 100, 93), bar(1, 97, 92, 93, 96), bar(2)]; const r = ok(run(trade({ direction: 'SHORT', initialStop: 101 }), bars)); assert.equal(r.simulatedExitPrice, 95.10000000000001); assert.equal(r.simulatedExitR, 4.8999999999999915); });
test('S4B 60 hard ceiling open gap stop precedence explicit', () => { const r = ok(run(trade(), [bar(0, 111, 99.5, 100, 111), bar(1, 101, 99, 100, 100), bar(2)], { policyId: 'PB_HARD_CEILING_V1' })); assert.equal(r.exitReason, 'STOP_GAP_THROUGH'); assert.equal(r.simulatedExitPrice, 100); });
test('S4B 61 invalid tick or off-grid frozen initial stop cannot be silently repaired', () => { hasReason(run(trade(), defaults(), { executionTickSize: -1 }), 'EXECUTION_TICK_SIZE_INVALID'); hasReason(run(trade({ initialStop: 99.03 })), 'INITIAL_STOP_OFF_EXECUTION_TICK'); });
test('S4B 62 modules pure and no production wiring', () => { for (const name of ['policy-schema', 'policies-v1', 'protection', 'execution-model', 'replay-trace', 'replay-request', 'replay-data', 'replay-engine', 'lookahead-qa', 'replay-quality']) { const src = readFileSync(new URL(`../src/exit-research/${name}.js`, import.meta.url), 'utf8'); assert.doesNotMatch(src, /\b(?:document|localStorage|fetch|XMLHttpRequest)\b|Date\.now|Math\.random/); } });

test('S4B 63 genuine early stop needs coverage only through its exit, future missing data not invented', () => {
  const r = ok(run(trade(), [bar(0, 101, 98)])); assert.equal(r.exitReason, 'STOP_TRIGGERED'); assert.equal(r.auditBars.length, 1);
});
test('S4B 64 coverage cannot skip leading path or an intermediate gap', () => {
  hasReason(run(trade(), [bar(1), bar(2)]), 'REPLAY_MARKET_DATA_INCOMPLETE');
  hasReason(run(trade(), [bar(0), bar(2)]), 'MARKET_DATA_GAP');
});
test('S4B 65 Step3 REVIEW never upgraded by exact market data', () => {
  const r = ok(run(trade({ qualityStatus: 'REVIEW_REQUIRED', qualityReasons: ['EXECUTION_QA_REVIEW'] }))); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED'); hasReason(r, 'EXECUTION_QA_REVIEW');
});
test('S4B 66 no same-bar MFE from the bar that triggers an existing stop', () => {
  const r = ok(run(trade(), [bar(0, 150, 98), bar(1), bar(2)])); assert.equal(r.maxKnownMfeR, 0); assert.ok(!r.trace.some(e => e.type === 'MFE_UPDATED'));
});
test('S4B 67 intraminute entry cannot use ambiguous extreme even with detail', () => {
  const b = detailBundle(); const r = ok(run(trade({ actualEntryTime: T + 22000 }), b));
  assert.equal(r.auditBars[0].knownMfeAfter, 7); assert.notEqual(r.auditBars[0].knownMfeAfter, 20); hasReason(r, 'ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION');
});
test('S4B 68 late manual facts have no influence on earlier trace or fixed setup', () => {
  const a = run(bof()), b = run(bof({ manualEvents: [switchEvent(T + 2 * P + 20000)] }));
  assert.deepEqual(a.trace.filter(e => e.at <= T + P), b.trace.filter(e => e.at <= T + P));
});
test('S4B 69 source evidence and fills independently checked by QA', () => {
  const tr = trade(), b = bundle(rising(7)), a = ok(run(tr, b));
  for (const mutate of [r => r.auditBars[0].evidence[0].high = 150, r => r.trace[0].payload = { finalExit: 99 }, r => r.simulatedExitPrice = 150,
    r => r.auditBars[0].executionSegments[0].high = 150, r => r.exitReason = 'ACTUAL_EXIT']) {
    const wrong = clone(a); mutate(wrong); assert.equal(auditReplayLookahead(wrong, tr, b).status, 'FAIL');
  }
});
test('S4B 70 all six named policies versioned, immutable and experimental', () => {
  assert.equal(Object.keys(POLICIES_V1).length, 6); for (const p of Object.values(POLICIES_V1)) { assert.equal(validateExitPolicy(p).valid, true); assert.ok(Object.isFrozen(p.stages)); assert.equal(p.classification, 'EXPERIMENTAL_BASELINE'); }
  assert.equal(ok(run(bof(), rising(9), { policyId: 'BOF_HARD_CEILING_V1' })).exitReason, 'HARD_CEILING');
});
test('S4B 71 post-exit and post-hard-end extremes cannot change earlier policy decisions', () => {
  const tr = trade(), bars = defaults(), a = ok(run(tr, bars)), b = ok(run(tr, [...bars, bar(3, 150, 50)])); assert.deepEqual(a.trace, b.trace);
  const stopBars = [bar(0, 101, 98), bar(1), bar(2)], stopA = ok(run(tr, stopBars)), stopB = ok(run(tr, [stopBars[0], bar(1, 150, 50), bar(2, 150, 50)])); assert.deepEqual(stopA.trace, stopB.trace);
});
test('S4B 72 lookahead QA catches early manual switch independently of declared effective field', () => {
  const tr = bof({ manualEvents: [switchEvent()] }), a = ok(switched()), e = a.trace.find(e => e.type === 'BOF_TO_PB_MANUAL_RECORDED');
  e.policyTransitionEffectiveAt = T + P; assert.equal(auditReplayLookahead(a, tr).status, 'FAIL');
});
test('S4B 73 missing hard end and malformed policy do not throw for ordinary absent input', () => {
  assert.equal(replayExitPolicy(null, null).qualityStatus, 'BLOCKED'); assert.equal(replayExitPolicy(trade(), bundle(defaults()), null).qualityStatus, 'BLOCKED');
  hasReason(run(trade(), defaults(), { policyId: 'UNKNOWN' }), 'POLICY_SCHEMA_INVALID');
});
test('S4B 74 explicit hard end mark rejects wrong series/time and inconsistent close', () => {
  hasReason(run(trade(), defaults(), { hardEndMark: { at: T + 3 * P, price: 101, seriesId: 'SYNTHETIC-P', source: 'SYNTHETIC' } }), 'HARD_END_MARK_CONFLICT');
  hasReason(run(trade(), defaults(), { hardEndMark: { at: T, price: 101, seriesId: 'SYNTHETIC-P', source: 'SYNTHETIC' } }), 'HARD_END_MARK_INVALID');
});
test('S4B 75 invalid risk and minimum lock schema rejected', () => {
  hasReason(run(trade({ initialStop: 101 })), 'INITIAL_STOP_INVALID');
  const p = clone(pb); p.stages[1].minimumLockR = 3; assert.equal(validateExitPolicy(p).valid, false);
});
test('S4B 76 gap stop is checked before a pending market ceiling intrabar stop', () => {
  const bars = [bar(0, 111, 99.5, 100, 111), bar(1, 112, 100, 110, 110), bar(2)];
  const r = ok(run(trade(), bars, { policyId: 'PB_HARD_CEILING_V1' })); assert.equal(r.exitReason, 'HARD_CEILING'); assert.equal(r.simulatedExitPrice, 110);
});

test('S4B 77 independent ordered synthetic path oracle across LONG/SHORT and six policies', () => {
  // Actual point paths, not derived engine states, are the fill oracle. Thresholds
  // below come directly from the frozen experimental table, independently of modules.
  for (let seed = 1; seed <= 16; seed++) for (const direction of ['LONG', 'SHORT']) for (const setup of ['PB', 'BOF']) for (const variant of ['BASELINE', 'TIGHT_GIVEBACK', 'HARD_CEILING']) {
    const sign = direction === 'LONG' ? 1 : -1, paths = [];
    for (let i = 0; i < 8; i++) {
      const center = i === 0 ? 0 : Math.min(15, i * (seed % 3 + 1)), up = center + 1 + seed % 4;
      const down = i === 0 ? -.5 : center - (seed % 5) - .5;
      paths.push([center, up, down, center + .5].map(r => 100 + sign * r));
    }
    const bars = paths.map((points, i) => bar(i, Math.max(...points), Math.min(...points), points[0], points.at(-1)));
    const tr = trade({ direction, initialStop: 100 - sign, originalSetup: setup === 'PB' ? 'mtf_pb' : 'htf_bof', researchSetupClass: setup });
    const policyId = `${setup}_${variant}_V1`, r = ok(run(tr, bars, { policyId, replayHardEndAt: T + 8 * P, executionTickSize: .5 }));
    let lockR = -1, known = 0, force = false, expectedPrice = null, expectedReason = null, activeR = -1;
    for (const points of paths) {
      activeR = lockR;
      const level = 100 + sign * lockR;
      if (sign * (points[0] - level) <= 0) { expectedPrice = points[0]; expectedReason = 'STOP_GAP_THROUGH'; break; }
      if (force) { expectedPrice = points[0]; expectedReason = 'HARD_CEILING'; break; }
      if (points.some(price => sign * (price - level) <= 0)) { expectedPrice = level; expectedReason = 'STOP_TRIGGERED'; break; }
      known = Math.max(known, ...points.map(price => sign * (price - 100)));
      const activation = setup === 'PB' ? 6 : 4, ceiling = setup === 'PB' ? 10 : 8;
      let pct = null;
      if (known >= activation) pct = known >= ceiling ? .2 : known >= activation + 2 ? .25 : .3;
      if (pct !== null && variant === 'TIGHT_GIVEBACK') pct -= .05;
      const theoreticalR = pct === null ? lockR : Math.max(lockR, known * (1 - pct));
      // Ordered-path oracle tracks the executable grid level. No next-bar stop
      // update is allowed to retroactively inspect these point prices.
      lockR = Math.floor((theoreticalR + 1e-10) / .5) * .5;
      force = variant === 'HARD_CEILING' && known >= ceiling;
    }
    if (expectedPrice === null) { expectedPrice = paths.at(-1).at(-1); expectedReason = 'REPLAY_HARD_END'; }
    assert.equal(r.simulatedExitPrice, expectedPrice, `${seed}/${direction}/${policyId}`);
    assert.equal(r.exitReason, expectedReason); assert.equal(r.maxKnownMfeR, known);
    assert.equal(r.finalRoundedProtectionR, activeR);
  }
});
test('S4B 78 malformed stage shapes rejected without exceptions', () => {
  for (const malformed of [null, undefined, 'stage', []]) { const p = clone(pb); p.stages[0] = malformed; assert.equal(validateExitPolicy(p).valid, false); }
});
test('S4B 79 no boundary activation without confirmed post-entry prints, even large possible MFE', () => {
  const tr = trade({ actualEntryTime: T + 10000 }), bars = [bar(0, 130, 99.5), bar(1), bar(2)];
  const a = ok(run(tr, bars)); bars[0].high = 10000; const b = ok(run(tr, bars)); assert.deepEqual(a.trace, b.trace);
});
test('S4B 80 invalid hard end request and explicit provider selection stay fail closed', () => {
  assert.equal(planReplayMarketDataRequests(trade()).status, 'BLOCKED');
  const b = bundle(defaults()); b.series.push({ ...clone(b.series[0]), seriesId: 'SYNTHETIC-P2' });
  hasReason(run(trade(), b), 'EXECUTION_SERIES_AMBIGUOUS'); assert.equal(ok(run(trade(), b, { primarySeriesId: 'SYNTHETIC-P2' })).provenance.primary.seriesId, 'SYNTHETIC-P2');
});

test('S4B 81 policies are data driven: custom activation and giveback affect engine, not hardcoded PB thresholds', () => {
  const policies = clone(POLICIES_V1); policies.PB_BASELINE_V1.stages[2].activateAtMfeR = 3; policies.PB_BASELINE_V1.stages[2].givebackPct = .6;
  const r = ok(run(trade(), rising(4), { policies })); assert.equal(r.auditBars[0].next.stage, 'PROTECT'); assert.equal(r.auditBars[0].next.protectionR, 1.6);
});
test('S4B 82 engine runner preserves initial stop rather than automatic break even', () => {
  const r = ok(run(trade(), [bar(0, 103), bar(1, 103), bar(2, 103)])); assert.equal(r.finalStage, 'RUNNER'); assert.equal(r.finalActiveProtectionR, -1);
});
test('S4B 83 already known pre-entry manual transition applies at entry without reset', () => {
  const r = ok(run(bof({ manualEvents: [switchEvent(T - P + 10000)] }))); assert.equal(r.auditBars[0].activePolicyId, 'PB_BASELINE_V1'); assert.equal(r.maxKnownMfeR, 1);
});
test('S4B 84 identity stable across createdAt and inputs host timezone independent', () => {
  const tr = trade(), b = bundle(defaults()), a = ok(run(tr, b)); b.createdAt += P; const c = ok(run(tr, b)); assert.equal(a.marketDataFingerprint, c.marketDataFingerprint); assert.deepEqual(a.trace, c.trace);
  const opts = { policyId: 'PB_BASELINE_V1', replayHardEndAt: T + 3 * P, executionTickSize: .1 };
  const code = `import { replayExitPolicy } from ${JSON.stringify(new URL('../src/exit-research/replay-engine.js', import.meta.url).href)}; process.stdout.write(JSON.stringify(replayExitPolicy(${JSON.stringify(tr)},${JSON.stringify(b)},${JSON.stringify(opts)})));`;
  const outputs = ['UTC', 'America/Chicago', 'Asia/Shanghai'].map(TZ => { const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ } }); assert.equal(child.status, 0, child.stderr); return child.stdout; });
  assert.ok(outputs.every(value => value === outputs[0]));
});
test('S4B 85 frozen Step1/2/3 real interfaces integrate without schema changes (synthetic facts)', () => {
  const state = createWorkspace(T - 1000); changeDirection(state, 'GC', 'long', T - 900); changeStructure(state, 'GC', 'range', T - 800); chooseSetup(state, 'GC', 'htf_bof', T - 700);
  markEntered(state, 'GC', T, true); recordInitialStop(state, 'GC', 99, T); recordBofToPb(state, 'GC', T + 20000); markExited(state, 'GC', T + P, true);
  const rows = [fillRow({ fillId: '900000000000001', orderId: '900000000001001', product: 'MGC', contract: 'MGCZ9', time: new Date(T).toISOString(), price: '100' }), fillRow({ fillId: '900000000000002', orderId: '900000000001002', product: 'MGC', contract: 'MGCZ9', time: new Date(T + P).toISOString(), side: 'Sell', price: '100' })];
  const parsed = parseTradovateFillsCsv(fillsCsv(rows));
  const logical = reconstructLogicalTrades(parsed.rows, { assumeFlatAtStart: true });
  const built = buildResearchTrades(state.records, logical.closedTrades).researchTrades[0];
  assert.equal(built.initialStop, 99); assert.equal(built.contextSymbol, null); assert.equal(built.actualEntryTime, T);
  const b = bundle(defaults()); b.series[0].contract = built.executionContract; b.series[0].providerSymbol = 'SYNTH:' + built.executionContract;
  const before = clone(built), r = ok(run(built, b)); assert.deepEqual(built, before); assert.equal(r.auditBars[1].activePolicyId, 'PB_BASELINE_V1');
});

test('S4B 86 normal stop time interval cannot be replaced with fabricated seconds', () => {
  const tr = trade(), b = bundle([bar(0, 101, 98), bar(1), bar(2)]), a = ok(run(tr, b));
  const wrong = clone(a); wrong.simulatedExitTimeRange.startAt += 17000;
  assert.equal(auditReplayLookahead(wrong, tr, b).status, 'FAIL');
});

test('S4B 87 malformed execution identity and invalid paired policies are structured blockers', () => {
  const b = bundle(defaults()); Object.assign(b.series[0], { product: 'GC', contract: 'GCZ9', providerSymbol: 'SYNTH:GCZ9', proxyForContract: true, priceSourceMode: 'SAME_EXPIRY_LARGE_CONTRACT_PROXY' });
  assert.equal(run(trade({ executionContract: true }), b).qualityStatus, 'BLOCKED');
  const policies = clone(POLICIES_V1); policies.BOF_BASELINE_V1.pairedPolicyId = 'UNKNOWN'; hasReason(run(trade(), defaults(), { policies }), 'PAIRED_POLICY_INVALID');
});
