import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, changeDirection, changeStructure, chooseSetup, markEntered, markExited, recordInitialStop,
  correctInitialStop, recordBofToPb, revertBofToPb } from '../src/model.js';
import { makeUnified } from '../src/unified-persistence.js';
import { makeEnvelope } from '../src/persistence.js';
import { parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv } from '../src/exit-research/tradovate-csv.js';
import { reconstructLogicalTrades } from '../src/exit-research/logical-trade.js';
import { executionProductForFamily, researchFamilyForProduct } from '../src/exit-research/symbol-map.js';
import { reconcileOpportunities, DEFAULT_MATCHING_CONFIG } from '../src/exit-research/reconciliation.js';
import { assessExecutionQa } from '../src/exit-research/execution-qa.js';
import { buildResearchTrades } from '../src/exit-research/research-trade.js';
import { createResearchStore, applyManualMatch, applyManualReject, executionFingerprint } from '../src/exit-research/manual-matches.js';
import { epochMillis } from '../src/exit-research/research-common.js';
import { FILL_HEADERS, ORDER_HEADERS, POSITION_HEADERS, fillRow, orderRow, positionRow, makeCsv, fillsCsv } from './fixtures/tradovate/synthetic.js';

const T = Date.UTC(2035, 1, 3, 1, 2, 3, 100), MIN = 60000;
function execution({ key = 1, entry = T, exit = T + 20 * MIN, direction = 'LONG', product = 'MES', contract = `${product}Z9`, multiEntry = false, multiExit = false, onlyMulti = false } = {}) {
  const rawFills = [], entryPrice = direction === 'LONG' ? 103.25 : 104.25, exitPrice = direction === 'LONG' ? 104.25 : 103.25;
  const id = n => String(900000000000000 + key * 100 + n);
  function add(n, time, side, qty, price, order) { rawFills.push(fillRow({ fillId: id(n), orderId: id(order), product, contract, side, quantity: qty, price, time: new Date(time).toISOString() })); }
  const enterSide = direction === 'LONG' ? 'Buy' : 'Sell', exitSide = direction === 'LONG' ? 'Sell' : 'Buy';
  add(1, entry, enterSide, multiEntry ? 1 : 2, entryPrice, 11);
  if (multiEntry) add(2, entry + 1, enterSide, 1, entryPrice, 12);
  add(3, multiExit ? exit - 1 : exit, exitSide, multiExit ? 1 : 2, exitPrice, 13);
  if (multiExit) add(4, exit, exitSide, 1, exitPrice, 14);
  const fills = parseTradovateFillsCsv(fillsCsv(rawFills)).rows;
  const trade = reconstructLogicalTrades(fills, { assumeFlatAtStart: true }).closedTrades[0];
  if (onlyMulti) trade.qualityFlags = trade.qualityFlags.filter(f => f !== 'UNSUPPORTED_SCALE_PATTERN'); // Explicit independent input, never change frozen reconstruction.
  const rawOrders = fills.map(fill => orderRow({ orderId: fill.orderId, 'Order ID': fill.orderId, Contract: contract, Product: product,
    'B/S': fill.side === 'buy' ? 'Buy' : 'Sell', Quantity: String(fill.quantity), filledQty: String(fill.quantity), 'Filled Qty': String(fill.quantity),
    avgPrice: String(fill.price), 'Avg Fill Price': String(fill.price), decimalFillAvg: String(fill.price), Type: fill.side === 'buy' ? 'Limit' : 'Market' }));
  const orders = parseTradovateOrdersCsv(makeCsv(ORDER_HEADERS, rawOrders)).rows;
  const entries = fills.filter(fill => trade.entryFillIds.includes(fill.fillId)), exits = fills.filter(fill => trade.exitFillIds.includes(fill.fillId));
  const rawHistory = [];
  let ei = 0, xi = 0, er = entries[0].quantity, xr = exits[0].quantity;
  while (ei < entries.length && xi < exits.length) {
    const qty = Math.min(er, xr), buy = direction === 'LONG' ? entries[ei] : exits[xi], sell = direction === 'LONG' ? exits[xi] : entries[ei];
    rawHistory.push(positionRow({ 'Position ID': id(90), 'Pair ID': id(50 + rawHistory.length), 'Buy Fill ID': buy.fillId, 'Sell Fill ID': sell.fillId,
      Contract: contract, Product: product, 'Paired Qty': String(qty), 'Buy Price': String(buy.price), 'Sell Price': String(sell.price), 'P/L': String((sell.price - buy.price) * qty) }));
    er -= qty; xr -= qty;
    if (er === 0) { ei++; er = entries[ei]?.quantity; } if (xr === 0) { xi++; xr = exits[xi]?.quantity; }
  }
  const positionHistory = parseTradovatePositionHistoryCsv(makeCsv(POSITION_HEADERS, rawHistory)).rows;
  return { trade, fills, orders, positionHistory, rawFills, rawOrders, rawHistory };
}
function opportunity({ key = 1, entry = T + 18000, exit = T + 20 * MIN + 14000, symbol = 'ES', direction = 'long', stop = direction === 'long' ? 102 : 105, type = 'mtf_pb', transitions = false, correction = null } = {}) {
  const state = createWorkspace(entry - 1000);
  changeStructure(state, symbol, 'range', entry - 900); changeDirection(state, symbol, direction, entry - 800);
  chooseSetup(state, symbol, type, entry - 100 - key); markEntered(state, symbol, entry, true);
  if (stop !== null) recordInitialStop(state, symbol, stop, entry + 1);
  if (correction !== null) correctInitialStop(state, symbol, correction, entry + 2);
  if (transitions) { recordBofToPb(state, symbol, entry + 3); revertBofToPb(state, symbol, entry + 4); recordBofToPb(state, symbol, entry + 5); }
  if (exit !== null) markExited(state, symbol, exit, true);
  return state.records[0];
}
function batch(executions) { return { orders: executions.flatMap(e => e.orders), positionHistory: executions.flatMap(e => e.positionHistory), allExecutionFills: executions.flatMap(e => e.fills) }; }
function reconcile(record = opportunity(), e = execution(), extra = {}) { return reconcileOpportunities([record], [e.trade], { ...batch([e]), ...extra }).matches[0]; }
function research(record = opportunity(), e = execution(), extra = {}) { return buildResearchTrades([record], [e.trade], { ...batch([e]), ...extra }).researchTrades[0]; }

test('S3 01: fixed family mapping preserves exact execution contract and context symbol', () => {
  for (const [family, product] of Object.entries({ GC: 'MGC', ES: 'MES', CL: 'MCL' })) {
    assert.equal(executionProductForFamily(family), product); assert.equal(researchFamilyForProduct(product), family);
    const r = research(opportunity({ symbol: family }), execution({ product }));
    assert.equal(r.matchingStatus, 'MATCHED'); assert.equal(r.researchFamily, family); assert.equal(r.contextSymbol, family);
    assert.equal(r.executionContract, `${product}Z9`); assert.equal(r.executionProduct, product);
  }
  assert.equal(researchFamilyForProduct('GC'), null);
});
test('S3 02: family mismatch excludes candidate', () => assert.equal(reconcile(opportunity({ symbol: 'GC' })).matchingStatus, 'NO_MATCH'));
test('S3 03: direction mismatch excludes candidate', () => assert.equal(reconcile(opportunity({ direction: 'short' })).matchingStatus, 'NO_MATCH'));
test('S3 04: 18 second entry and 14 second exit produce unique strong match', () => {
  const m = reconcile(); assert.equal(m.matchingStatus, 'MATCHED'); assert.equal(m.entryDeltaMs, 18000); assert.equal(m.exitDeltaMs, 14000);
  assert.deepEqual(m.matchingReasons, ['FAMILY_DIRECTION_MATCH', 'ENTRY_STRONG', 'EXIT_STRONG', 'UNIQUE_ONE_TO_ONE']);
});
test('S3 05: seven minute entry difference requires review', () => { const m = reconcile(opportunity({ entry: T + 7 * MIN })); assert.equal(m.matchingStatus, 'REVIEW_REQUIRED'); assert.ok(m.matchingReasons.includes('ENTRY_REVIEW_WINDOW')); });
test('S3 06: entry beyond ten minutes is excluded', () => assert.equal(reconcile(opportunity({ entry: T + 10 * MIN + 1 })).matchingStatus, 'NO_MATCH'));
test('S3 07: exit validation uniquely resolves equally close entry times', () => {
  const a = execution({ key: 1, entry: T - 1000 }), b = execution({ key: 2, entry: T + 1000, exit: T + 25 * MIN });
  const m = reconcileOpportunities([opportunity({ entry: T })], [a.trade, b.trade], batch([a, b])).matches[0];
  assert.equal(m.logicalTradeId, a.trade.logicalTradeId); assert.equal(m.matchingStatus, 'MATCHED');
});
test('S3 08: identical evidence for two distinct candidates returns ambiguity without ID tie break', () => {
  const a = execution(), b = execution({ key: 2 }); const m = reconcileOpportunities([opportunity()], [a.trade, b.trade], batch([a, b])).matches[0];
  assert.equal(m.matchingStatus, 'MATCH_AMBIGUOUS'); assert.equal(m.logicalTradeId, null); assert.equal(m.candidateLogicalTradeIds.length, 2);
});
test('S3 09: global assignment solves greedy trap independent of record and trade input order', () => {
  const a = execution(), b = execution({ key: 2, entry: T + 12 * MIN });
  const r1 = opportunity({ key: 1, entry: T + 5 * MIN }), r2 = opportunity({ key: 2, entry: T + 1 * MIN });
  const expected = reconcileOpportunities([r1, r2], [a.trade, b.trade], batch([a, b]));
  assert.equal(expected.matches.find(m => m.opportunityId === r1.id).logicalTradeId, b.trade.logicalTradeId);
  assert.equal(expected.matches.find(m => m.opportunityId === r2.id).logicalTradeId, a.trade.logicalTradeId);
  assert.deepEqual(reconcileOpportunities([r2, r1], [b.trade, a.trade], batch([a, b])), expected);
});
test('S3 10: two equivalent cards competing for one trade are both ambiguous including unassigned outcome', () => {
  const e = execution(); const result = reconcileOpportunities([opportunity(), opportunity({ key: 2 })], [e.trade], batch([e]));
  assert.deepEqual(result.matches.map(m => m.matchingStatus), ['MATCH_AMBIGUOUS', 'MATCH_AMBIGUOUS']);
});
test('S3 11: manual confirmation JSON persistence reuses identical immutable execution facts', () => {
  const e = execution(), r = opportunity(); const empty = createResearchStore();
  const store = applyManualMatch(empty, r.id, e.trade, T + 30 * MIN);
  assert.equal(empty.sequence, 0); assert.equal(store.manualDecisions[0].action, 'MANUAL_CONFIRMED');
  const roundTrip = JSON.parse(JSON.stringify(store)); const reimport = execution();
  reimport.trade.fills.forEach(fill => { fill.sourceRowNumber += 20; });
  const m = reconcile(r, reimport, { manualStore: roundTrip }); assert.ok(m.matchingReasons.includes('MANUAL_CONFIRMED'));
});
test('S3 12: manual rejection excludes only its pair and preserves append-only confirmation history', () => {
  const e = execution(), r = opportunity(); let store = applyManualMatch(createResearchStore(), r.id, e.trade, T + 30 * MIN);
  store = applyManualReject(store, r.id, e.trade, T + 31 * MIN);
  assert.equal(store.manualDecisions.length, 2); assert.equal(reconcile(r, e, { manualStore: store }).matchingStatus, 'NO_MATCH');
});
test('S3 13: changed immutable ID or critical execution fact invalidates manual confirmation', () => {
  const e = execution(), r = opportunity(), store = applyManualMatch(createResearchStore(), r.id, e.trade, T + 30 * MIN);
  for (const changed of [execution({ key: 2 }), execution()]) {
    if (changed.trade.logicalTradeId === e.trade.logicalTradeId) changed.trade.entryVwap += .25;
    const m = reconcile(r, changed, { manualStore: store });
    assert.equal(m.matchingStatus, 'REVIEW_REQUIRED'); assert.ok(m.matchingReasons.includes('MANUAL_MATCH_SOURCE_CHANGED')); assert.equal(m.logicalTradeId, null);
    assert.equal(research(r, changed, { manualStore: store }).qualityStatus, 'BLOCKED');
    const refreshed = applyManualMatch(store, r.id, changed.trade, T + 31 * MIN);
    assert.ok(reconcile(r, changed, { manualStore: refreshed }).matchingReasons.includes('MANUAL_CONFIRMED'));
  }
});
test('S3 14: missing Initial Stop blocks Research Trade', () => { const r = research(opportunity({ stop: null })); assert.equal(r.qualityStatus, 'BLOCKED'); assert.ok(r.qualityReasons.includes('INITIAL_STOP_MISSING')); });
test('S3 15: LONG invalid stop blocks without modifying manual fact', () => { const op = opportunity({ stop: 105 }), r = research(op); assert.equal(r.initialStop, 105); assert.ok(r.qualityReasons.includes('INITIAL_STOP_INVALID')); assert.equal(op.researchCapture.manualEvents[0].payload.stopPrice, 105); });
test('S3 16: SHORT invalid stop blocks; valid short P/L direction passes pair QA', () => {
  const e = execution({ direction: 'SHORT' }), r = research(opportunity({ direction: 'short', stop: 103 }), e);
  assert.ok(r.qualityReasons.includes('INITIAL_STOP_INVALID')); assert.equal(r.executionQa.positionHistory.status, 'PASS');
});
test('S3 17: BOF original setup and all conversion/revert events remain intact', () => {
  const op = opportunity({ type: 'htf_bof', transitions: true }), r = research(op);
  assert.equal(r.originalSetup, 'htf_bof'); assert.equal(r.researchSetupClass, 'BOF');
  assert.deepEqual(r.manualEvents, op.researchCapture.manualEvents); assert.deepEqual(r.manualSetupTransitions.map(e => e.type), ['BOF_TO_PB_RECORDED', 'BOF_TO_PB_REVERTED', 'BOF_TO_PB_RECORDED']);
});
test('S3 18: multi entry orders link by IDs; only multi flag becomes informational after complete QA', () => {
  const e = execution({ multiEntry: true, onlyMulti: true }), r = research(opportunity(), e);
  assert.equal(r.executionQa.orders.entryOrderIds.length, 2); assert.equal(r.executionQa.orders.status, 'PASS');
  assert.equal(r.executionFlags[0].severity, 'informational'); assert.equal(r.qualityStatus, 'READY');
});
test('S3 19: multi exit orders link by IDs; incomplete pair QA retains review flag', () => {
  const e = execution({ multiExit: true, onlyMulti: true }); const r = research(opportunity(), e, { positionHistory: [] });
  assert.equal(r.executionQa.orders.exitOrderIds.length, 2); assert.equal(r.executionFlags[0].severity, 'review-required'); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED');
});
test('S3 20: frozen unsupported scale flag stays blocking even when Orders and History QA pass', () => {
  const e = execution({ multiEntry: true, multiExit: true }); const before = structuredClone(e.trade), r = research(opportunity(), e);
  assert.equal(r.matchingStatus, 'DATA_CONFLICT'); assert.equal(r.qualityStatus, 'BLOCKED'); assert.ok(r.qualityReasons.includes('UNSUPPORTED_SCALE_PATTERN')); assert.deepEqual(e.trade, before);
});
test('S3 21: missing Orders requires review and never rewrites Fills truth', () => {
  const e = execution(), before = structuredClone(e), r = research(opportunity(), e, { orders: [] });
  assert.equal(r.executionQa.orders.status, 'INSUFFICIENT_DATA'); assert.equal(r.qualityStatus, 'REVIEW_REQUIRED'); assert.deepEqual(e, before);
});
test('S3 22: missing Position History requires review and preserves Logical Trade boundaries', () => {
  const e = execution(), before = structuredClone(e.trade), r = research(opportunity(), e, { positionHistory: [] });
  assert.equal(r.executionQa.positionHistory.status, 'INSUFFICIENT_DATA'); assert.equal(r.actualExitTime, epochMillis(e.trade.exitCompletedAt)); assert.deepEqual(e.trade, before);
});
test('S3 23: same Position ID can cover two Logical Trades without merging boundaries', () => {
  const a = execution(), b = execution({ key: 2, entry: T + 30 * MIN, exit: T + 40 * MIN });
  b.positionHistory[0].positionId = a.positionHistory[0].positionId;
  const qa = assessExecutionQa([a.trade, b.trade], [...a.orders, ...b.orders], [...a.positionHistory, ...b.positionHistory]);
  assert.equal(Object.keys(qa).length, 2); for (const q of Object.values(qa)) { assert.equal(q.positionHistory.status, 'PASS'); assert.equal(q.positionHistory.matchedPairIds.length, 1); }
});
test('S3 24: cross-offset input time compares absolute epoch, not display time', () => {
  const e = execution(); e.rawFills[0]._timestamp = '2035-02-03T09:02:03.100+08:00';
  const fills = parseTradovateFillsCsv(fillsCsv(e.rawFills)).rows;
  e.trade = reconstructLogicalTrades(fills, { assumeFlatAtStart: true }).closedTrades[0]; e.fills = fills;
  assert.equal(reconcile(opportunity(), e).entryDeltaMs, 18000);
});
test('S3 25: complete matching and Research Trade output repeats 100 times byte-identically', () => {
  const e = execution(), op = opportunity(), options = batch([e]); const expected = JSON.stringify(buildResearchTrades([op], [e.trade], options));
  for (let n = 0; n < 100; n++) assert.equal(JSON.stringify(buildResearchTrades([op], [e.trade], options)), expected);
});
test('S3 26: nested frozen inputs never mutate and output owns all mutable arrays', () => {
  const e = execution(), op = opportunity({ type: 'htf_pb', transitions: true }), options = batch([e]);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const input = freeze({ records: [op], trades: [e.trade], options }); const before = JSON.stringify(input);
  const result = buildResearchTrades(input.records, input.trades, input.options);
  result.researchTrades[0].manualEvents[0].payload.stopPrice = 1; result.researchTrades[0].executionQa.orders.matchedOrderIds.push('SYNTHETIC');
  assert.equal(JSON.stringify(input), before);
});

test('S3: registeredAt does not determine matching; corrected stop uses frozen effective reducer', () => {
  const op = opportunity({ stop: 101, correction: 102 }); const r = research(op);
  assert.equal(r.initialStop, 102); assert.equal(r.manualEvents.length, 2); assert.equal(r.qualityStatus, 'READY');
  assert.equal(r.actualEntryPrice, 103.25); assert.equal(r.registeredAt, op.registeredAt);
});
test('S3: entry threshold endpoints are inclusive and configurable', () => {
  assert.equal(reconcile(opportunity({ entry: T + 2 * MIN })).matchingStatus, 'MATCHED');
  assert.equal(reconcile(opportunity({ entry: T + 10 * MIN })).matchingStatus, 'REVIEW_REQUIRED');
  assert.equal(reconcile(opportunity({ entry: T + 18000 }), execution(), { config: { strongEntryWindowMs: 10000 } }).matchingStatus, 'REVIEW_REQUIRED');
  assert.throws(() => reconcile(opportunity(), execution(), { config: { strongEntryWindowMs: 700000 } }), { code: 'INVALID_MATCHING_CONFIG' });
});
test('S3: exit conflict, missing exit, and unknown execution timezone never auto-match', () => {
  assert.equal(reconcile(opportunity({ exit: T + 31 * MIN })).matchingStatus, 'DATA_CONFLICT');
  assert.equal(reconcile(opportunity({ exit: null })).matchingStatus, 'REVIEW_REQUIRED');
  const e = execution(); e.rawFills.forEach(f => { delete f._timestamp; });
  const headers = FILL_HEADERS.filter(h => h !== '_timestamp'), fills = parseTradovateFillsCsv(makeCsv(headers, e.rawFills)).rows;
  e.trade = reconstructLogicalTrades(fills, { assumeFlatAtStart: true }).closedTrades[0]; e.fills = fills;
  assert.ok(reconcile(opportunity(), e).matchingReasons.includes('EXECUTION_TIMEZONE_UNCONFIRMED'));
});
test('S3: assignment cap fails closed as ambiguity', () => {
  const a = execution(), b = execution({ key: 2 });
  const m = reconcileOpportunities([opportunity()], [a.trade, b.trade], { ...batch([a, b]), config: { maxAssignmentSteps: 1 } }).matches[0];
  assert.equal(m.matchingStatus, 'MATCH_AMBIGUOUS'); assert.ok(m.matchingReasons.includes('ASSIGNMENT_LIMIT_REVIEW_REQUIRED'));
});
test('S3: manual confirmations respect hard filters and one-to-one ownership', () => {
  const e = execution(), a = opportunity(), b = opportunity({ key: 2 });
  let store = applyManualMatch(createResearchStore(), a.id, e.trade, T + 30 * MIN); store = applyManualMatch(store, b.id, e.trade, T + 31 * MIN);
  assert.ok(reconcileOpportunities([a, b], [e.trade], { ...batch([e]), manualStore: store }).matches.every(m => m.matchingStatus === 'DATA_CONFLICT'));
  const wrong = opportunity({ direction: 'short' }); store = applyManualMatch(createResearchStore(), wrong.id, e.trade, T + 30 * MIN);
  assert.equal(reconcile(wrong, e, { manualStore: store }).matchingStatus, 'DATA_CONFLICT');
});
test('S3: Orders conflict blocks; reported Stop never fills Initial Stop', () => {
  const e = execution(); e.orders[0].reportedStopPrice = 101;
  assert.equal(research(opportunity({ stop: null }), e).initialStop, null);
  e.orders[0].filledQuantity = 3; assert.equal(reconcile(opportunity(), e).matchingStatus, 'DATA_CONFLICT');
  e.orders[0].filledQuantity = 2; e.orders[0].contract = 'MGCZ9';
  assert.equal(assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId].orders.status, 'CONFLICT');
});
test('S3: Pair duplicate, price mismatch, excessive quantity, and crossing trades are conflicts', () => {
  for (const mutate of [e => e.positionHistory.push(structuredClone(e.positionHistory[0])), e => e.positionHistory[0].buyPrice++, e => e.positionHistory[0].pairedQuantity++]) {
    const e = execution(); mutate(e); assert.equal(assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId].positionHistory.status, 'CONFLICT');
  }
  const a = execution(), b = execution({ key: 2 }); a.positionHistory[0].sellFillId = b.trade.exitFillIds[0];
  assert.equal(assessExecutionQa([a.trade, b.trade], [...a.orders, ...b.orders], a.positionHistory)[a.trade.logicalTradeId].positionHistory.status, 'CONFLICT');
});
test('S3: P/L sign disagreement is WARNING; amount remains explicitly unverified', () => {
  const e = execution(); e.positionHistory[0].pnl = -1;
  const q = assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId].positionHistory;
  assert.equal(q.status, 'WARNING'); assert.equal(q.pnlAmountVerified, false);
});
test('S3: missing counterpart is insufficient, not invented or merged by Position ID', () => {
  const e = execution(); e.positionHistory[0].sellFillId = '900009999999999';
  assert.equal(assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId].positionHistory.status, 'INSUFFICIENT_DATA');
});
test('S3: execution fingerprint ignores display provenance but detects fill facts', () => {
  const e = execution(), t = structuredClone(e.trade), initial = executionFingerprint(t);
  t.fills[0].rawFields.Timestamp = 'arbitrary display text'; t.fills[0].sourceRowNumber += 10;
  assert.equal(executionFingerprint(t), initial); t.fills[0].quantity++; assert.notEqual(executionFingerprint(t), initial);
});
test('S3: duplicate batch identities and malformed record fail closed', () => {
  const e = execution(), op = opportunity();
  assert.throws(() => reconcileOpportunities([op, op], [e.trade]), { code: 'DUPLICATE_ID' });
  op.researchCapture.manualEvents[0].payload.stopPrice = -1; assert.equal(reconcile(op, e).matchingStatus, 'DATA_CONFLICT');
});
test('S3: open executions do not become ordinary candidates', () => {
  const e = execution(); e.trade.status = 'open'; e.trade.exitCompletedAt = null;
  assert.equal(reconcile(opportunity(), e).matchingStatus, 'NO_MATCH');
});
test('S3 QA CLI: synthetic three tables, privacy, source bytes, optional Unified V2 and explicit boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'exit-reconcile-'));
  try {
    const e = execution(), paths = ['fills.csv', 'orders.csv', 'positions.csv'].map(name => join(dir, name));
    [fillsCsv(e.rawFills), makeCsv(ORDER_HEADERS, e.rawOrders), makeCsv(POSITION_HEADERS, e.rawHistory)].forEach((text, i) => writeFileSync(paths[i], text));
    const bytes = paths.map(p => readFileSync(p));
    const run = args => spawnSync(process.execPath, ['scripts/qa-exit-reconciliation.mjs', ...args], { encoding: 'utf8' });
    const bad = run(paths); assert.equal(bad.status, 1); assert.ok(bad.stderr.includes('WINDOW_START_FLAT_UNCONFIRMED'));
    const args = ['--window-start-assumption=FLAT_CONFIRMED_FOR_QA', ...paths], result = run(args);
    assert.equal(result.status, 0, result.stderr); const summary = JSON.parse(result.stdout);
    assert.equal(summary.htmlJsonAvailable, false); assert.equal(summary.executionQa.orders.PASS, 1); assert.equal(summary.deterministicRepeats, 100);
    for (const secret of [e.trade.accountId, e.fills[0].accountLabel, ...e.trade.allFillIds, ...e.trade.entryOrderIds, e.positionHistory[0].pairId, '2035', '103.25']) assert.ok(!result.stdout.includes(secret));
    const state = createWorkspace(T); state.records = [opportunity()]; const json = join(dir, 'unified.json'); writeFileSync(json, JSON.stringify(makeUnified(makeEnvelope(state, T + 30 * MIN))));
    const actual = run([...args, json]); assert.equal(actual.status, 0, actual.stderr); const matching = JSON.parse(actual.stdout);
    assert.equal(matching.actualMatchingPerformed, true); assert.equal(matching.matchingStatuses.MATCHED, 1);
    paths.forEach((p, i) => assert.deepEqual(readFileSync(p), bytes[i]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('S3: exit review thresholds are inclusive and independent of entry thresholds', () => {
  assert.equal(reconcile(opportunity({ exit: T + 22 * MIN })).matchingStatus, 'MATCHED');
  assert.equal(reconcile(opportunity({ exit: T + 30 * MIN })).matchingStatus, 'REVIEW_REQUIRED');
  assert.equal(reconcile(opportunity({ exit: T + 30 * MIN + 1 })).matchingStatus, 'DATA_CONFLICT');
});
test('S3: manual source time changes invalidate confirmation; explicit remap preserves audit history', () => {
  const a = execution(), b = execution({ key: 2 }), op = opportunity();
  let store = applyManualMatch(createResearchStore(), op.id, a.trade, T + 30 * MIN);
  const changed = execution({ exit: T + 20 * MIN + 1 });
  assert.ok(reconcile(op, changed, { manualStore: store }).matchingReasons.includes('MANUAL_MATCH_SOURCE_CHANGED'));
  store = applyManualMatch(store, op.id, b.trade, T + 31 * MIN);
  const m = reconcileOpportunities([op], [a.trade, b.trade], { ...batch([a, b]), manualStore: store }).matches[0];
  assert.equal(m.logicalTradeId, b.trade.logicalTradeId); assert.equal(store.manualDecisions.length, 2);
});
test('S3: multi-order QA does not confuse multiple Order versions with multiple executions', () => {
  const e = execution(); const older = structuredClone(e.orders[0]); older.filledQuantity = 1; older.versionId = 'SYNTH-OLDER-VERSION';
  e.orders.push(older);
  assert.equal(assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId].orders.status, 'PASS');
});
test('S3: UTC / Chicago / Shanghai processes produce identical absolute time coordinates', () => {
  const code = `import { parseTradovateTime } from './src/exit-research/time.js';
    import { epochMillis } from './src/exit-research/research-common.js';
    const a = parseTradovateTime('2035-02-03T09:02:03.100+08:00', 0, 'time');
    const b = parseTradovateTime('2035-02-02T19:02:03.100-06:00', 0, 'time');
    console.log(JSON.stringify([epochMillis(a), epochMillis(b)]));`;
  const outputs = ['UTC', 'America/Chicago', 'Asia/Shanghai'].map(TZ => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ } });
    assert.equal(result.status, 0, result.stderr); return result.stdout;
  });
  assert.equal(outputs[0], outputs[1]); assert.equal(outputs[1], outputs[2]); assert.deepEqual(JSON.parse(outputs[0]), [T, T]);
});
test('S3: parser-allowed missing Pair ID returns insufficient QA without fabricating identity', () => {
  const e = execution(); e.positionHistory[0].pairId = null;
  const qa = assessExecutionQa([e.trade], e.orders, e.positionHistory)[e.trade.logicalTradeId];
  assert.equal(qa.positionHistory.status, 'INSUFFICIENT_DATA'); assert.deepEqual(qa.positionHistory.matchedPairIds, []);
  assert.ok(qa.positionHistory.flags.some(f => f.code === 'PAIR_ID_MISSING'));
});
test('S3: rejecting latest manual mapping does not resurrect superseded confirmation; rejected conflicts excluded', () => {
  const a = execution(), b = execution({ key: 2 }), op = opportunity();
  let store = applyManualMatch(createResearchStore(), op.id, a.trade, T + 30 * MIN);
  store = applyManualMatch(store, op.id, b.trade, T + 31 * MIN); store = applyManualReject(store, op.id, b.trade, T + 32 * MIN);
  const m = reconcileOpportunities([op], [a.trade, b.trade], { ...batch([a, b]), manualStore: store }).matches[0];
  assert.ok(!m.matchingReasons.includes('MANUAL_CONFIRMED')); // A may now win ordinary matching, but its superseded confirmation remains inactive.
  const blocked = execution({ multiEntry: true }); store = applyManualReject(createResearchStore(), op.id, blocked.trade, T + 30 * MIN);
  assert.equal(reconcile(op, blocked, { manualStore: store }).matchingStatus, 'NO_MATCH');
});
test('S3: manual candidate beyond ordinary entry window is review and cannot override exit conflict', () => {
  const e = execution(), op = opportunity({ entry: T + 11 * MIN });
  const store = applyManualMatch(createResearchStore(), op.id, e.trade, T + 30 * MIN);
  const m = reconcile(op, e, { manualStore: store }); assert.equal(m.matchingStatus, 'REVIEW_REQUIRED'); assert.ok(m.matchingReasons.includes('MANUAL_ENTRY_OUTSIDE_WINDOW'));
  const wrongExit = opportunity({ exit: T + 31 * MIN }), wrongStore = applyManualMatch(createResearchStore(), wrongExit.id, e.trade, T + 32 * MIN);
  assert.equal(reconcile(wrongExit, e, { manualStore: wrongStore }).matchingStatus, 'DATA_CONFLICT');
});
