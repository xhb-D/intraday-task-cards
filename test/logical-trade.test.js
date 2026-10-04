import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { reconstructLogicalTrades as reconstruct } from '../src/exit-research/logical-trade.js';
import { parseTradovateFillsCsv } from '../src/exit-research/tradovate-csv.js';
import { FILL_HEADERS, fillRow, fillsCsv } from './fixtures/tradovate/synthetic.js';
const row = (index, side, quantity, price, options = {}) => fillRow({ fillId: `9000000000000${String(index).padStart(2, '0')}`,
  orderId: side === 'Buy' ? '900000000001001' : '900000000001002', side, quantity, price,
  time: `2035-02-03 01:02:${String(index).padStart(2, '0')}.100Z`, ...options });
const parse = (rows, options) => parseTradovateFillsCsv(fillsCsv(rows, options)).rows;
const run = rows => reconstruct(parse(rows));
const deepFreeze = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child); return value; };

test('Trades: single long entry and exit reconstruct exact facts, times, provenance and stable tuple ID', () => {
  const fills = parse([row(1, 'Buy', 2, 103.25), row(2, 'Sell', 2, 105.5)]);
  const result = reconstruct(fills); const trade = result.closedTrades[0];
  assert.equal(result.closedTrades.length, 1); assert.deepEqual(result.openPositions, []);
  assert.equal(trade.direction, 'LONG'); assert.equal(trade.status, 'closed'); assert.equal(trade.quantity, 2);
  assert.equal(trade.entryVwap, 103.25); assert.equal(trade.exitVwap, 105.5);
  assert.deepEqual(trade.entryStartedAt, fills[0].time); assert.deepEqual(trade.entryCompletedAt, fills[0].time);
  assert.deepEqual(trade.exitStartedAt, fills[1].time); assert.deepEqual(trade.exitCompletedAt, fills[1].time);
  assert.deepEqual(trade.fills, fills); assert.deepEqual(trade.allFillIds, fills.map(fill => fill.fillId));
  assert.deepEqual(trade.sourceRows, [2, 3]); assert.deepEqual(trade.qualityFlags, []);
  assert.deepEqual(JSON.parse(decodeURIComponent(trade.logicalTradeId.slice(3))), ['90000991', 'MESZ9', fills[0].fillId, fills[1].fillId]);
});
test('Trades: short direction preserves sell entries and buy exits', () => {
  const trade = run([row(1, 'Sell', 3, 203.5), row(2, 'Buy', 3, 201.25)]).closedTrades[0];
  assert.equal(trade.direction, 'SHORT'); assert.equal(trade.entryVwap, 203.5); assert.equal(trade.exitVwap, 201.25);
  assert.deepEqual(trade.entryOrderIds, ['900000000001002']); assert.deepEqual(trade.exitOrderIds, ['900000000001001']);
});
test('Trades: same-order partial entry 2+2+1 is one trade with weighted VWAP and entry completion time', () => {
  const trade = run([row(1, 'Buy', 2, 100), row(2, 'Buy', 2, 101), row(3, 'Buy', 1, 102), row(4, 'Sell', 5, 103)]).closedTrades[0];
  assert.equal(trade.quantity, 5); assert.equal(trade.entryVwap, 100.8); assert.equal(trade.entryFillIds.length, 3);
  assert.equal(trade.entryStartedAt.sortKey, '2035-02-03T01:02:01.100Z'); assert.equal(trade.entryCompletedAt.sortKey, '2035-02-03T01:02:03.100Z');
  assert.deepEqual(trade.qualityFlags, []);
});
test('Trades: same-order partial exit preserves start/completion and weighted exit price', () => {
  const trade = run([row(1, 'Buy', 5, 100), row(2, 'Sell', 2, 101), row(3, 'Sell', 2, 102), row(4, 'Sell', 1, 103)]).closedTrades[0];
  assert.equal(trade.exitQuantity, 5); assert.equal(trade.exitVwap, 101.8); assert.equal(trade.exitFillIds.length, 3);
  assert.equal(trade.exitStartedAt.sortKey, '2035-02-03T01:02:02.100Z'); assert.equal(trade.exitCompletedAt.sortKey, '2035-02-03T01:02:04.100Z');
  assert.deepEqual(trade.qualityFlags, []);
});
test('Trades: same-day independent flat intervals produce distinct trades and IDs', () => {
  const result = run([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101), row(3, 'Sell', 2, 102), row(4, 'Buy', 2, 103)]);
  assert.deepEqual(result.closedTrades.map(trade => trade.direction), ['LONG', 'SHORT']);
  assert.equal(new Set(result.closedTrades.map(trade => trade.logicalTradeId)).size, 2);
});
test('Trades: different exact contracts remain isolated even for the same product', () => {
  const result = run([row(1, 'Buy', 1, 100), row(2, 'Sell', 2, 101, { contract: 'MESH0' }), row(3, 'Sell', 1, 102), row(4, 'Buy', 2, 103, { contract: 'MESH0' })]);
  assert.equal(result.metadata.groupCount, 2); assert.equal(result.closedTrades.length, 2);
  assert.deepEqual(result.closedTrades.map(trade => [trade.contract, trade.direction]), [['MESH0', 'SHORT'], ['MESZ9', 'LONG']]);
});
test('Trades: separate accounts do not net positions against each other', () => {
  const result = run([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101, { accountId: '90000992', account: 'SYNTH-B' })]);
  assert.equal(result.closedTrades.length, 0); assert.equal(result.openPositions.length, 2);
  assert.equal(new Set(result.openPositions.map(trade => trade.accountId)).size, 2);
});
test('Trades: no account field explicitly groups under null', () => {
  const headers = FILL_HEADERS.filter(header => !['_accountId', 'Account'].includes(header));
  const result = reconstruct(parse([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101)], { headers }));
  assert.equal(result.closedTrades[0].accountId, null);
});
test('Trades: parsed timestamp sorts unordered input; fill ID magnitude never sorts execution', () => {
  const entry = row(1, 'Buy', 1, 100, { fillId: '900000000009999' }), exit = row(2, 'Sell', 1, 101, { fillId: '900000000000001' });
  const a = run([exit, entry]).closedTrades[0], b = run([entry, exit]).closedTrades[0];
  assert.equal(a.direction, 'LONG'); assert.deepEqual(a.allFillIds, ['900000000009999', '900000000000001']); assert.equal(a.logicalTradeId, b.logicalTradeId);
});
test('Trades: identical timestamp keeps original CSV source row order, even if caller array is reversed', () => {
  const time = '2035-02-03 01:02:01.100Z';
  const fills = parse([row(1, 'Buy', 1, 100, { time, fillId: '900000000009999' }), row(2, 'Sell', 1, 101, { time })]);
  const trade = reconstruct([...fills].reverse()).closedTrades[0];
  assert.equal(trade.direction, 'LONG'); assert.deepEqual(trade.sourceRows, [2, 3]); assert.equal(trade.entryStartedAt.sortKey, trade.exitCompletedAt.sortKey);
});
test('Trades: multiple entry orders are retained and flagged rather than deleted', () => {
  const result = run([row(1, 'Buy', 2, 100), row(2, 'Buy', 1, 101, { orderId: '900000000001003' }), row(3, 'Sell', 3, 102)]);
  assert.equal(result.closedTrades.length, 1); assert.deepEqual(result.closedTrades[0].qualityFlags, ['MULTI_ENTRY_ORDER', 'UNSUPPORTED_SCALE_PATTERN']);
  assert.deepEqual(result.metadata.flagCounts, { MULTI_ENTRY_ORDER: 1, UNSUPPORTED_SCALE_PATTERN: 1 });
});
test('Trades: multiple independent exit orders are retained and flagged', () => {
  const trade = run([row(1, 'Buy', 2, 100), row(2, 'Sell', 1, 101), row(3, 'Sell', 1, 102, { orderId: '900000000001004' })]).closedTrades[0];
  assert.deepEqual(trade.qualityFlags, ['MULTI_EXIT_ORDER', 'UNSUPPORTED_SCALE_PATTERN']); assert.equal(trade.allFillIds.length, 3);
});
test('Trades: re-add after exit started preserves all facts, cumulative quantities and flags', () => {
  const trade = run([row(1, 'Buy', 2, 100), row(2, 'Sell', 1, 101), row(3, 'Buy', 1, 102, { orderId: '900000000001003' }), row(4, 'Sell', 2, 103, { orderId: '900000000001004' })]).closedTrades[0];
  assert.equal(trade.quantity, 3); assert.equal(trade.exitQuantity, 3); assert.equal(trade.remainingQuantity, 0);
  assert.deepEqual(trade.qualityFlags, ['MULTI_ENTRY_ORDER', 'MULTI_EXIT_ORDER', 'RE_ADD_AFTER_EXIT_STARTED', 'UNSUPPORTED_SCALE_PATTERN']);
  assert.equal(trade.entryCompletedAt.sortKey, '2035-02-03T01:02:03.100Z'); assert.equal(trade.allFillIds.length, 4);
});
test('Trades: reversal crossing zero fails the complete operation without mutating input or returning earlier trades', () => {
  const input = deepFreeze(parse([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101), row(3, 'Buy', 2, 102), row(4, 'Sell', 3, 103)]));
  const before = structuredClone(input);
  assert.throws(() => reconstruct(input), error => error.code === 'RECONSTRUCTION_REVERSAL_CROSS_ZERO' && error.sourceRowNumber === 5 && error.field === 'quantity');
  assert.deepEqual(input, before);
});
test('Trades: file-end open position retains fills and partial exit with no fabricated completion', () => {
  const fills = parse([row(1, 'Sell', 3, 100), row(2, 'Buy', 1, 101)]);
  const result = reconstruct(fills); const open = result.openPositions[0];
  assert.deepEqual(result.closedTrades, []); assert.equal(open.status, 'open'); assert.equal(open.remainingQuantity, 2);
  assert.equal(open.exitCompletedAt, null); assert.deepEqual(open.exitStartedAt, fills[1].time); assert.deepEqual(open.fills, fills);
  assert.deepEqual(open.qualityFlags, ['OPEN_POSITION_AT_FILE_END']);
  const noExit = run([row(1, 'Buy', 1, 100)]).openPositions[0];
  assert.equal(noExit.exitStartedAt, null); assert.equal(noExit.exitVwap, null); assert.equal(noExit.exitCompletedAt, null);
});
test('Trades: duplicate IDs and invalid direct normalized input reject atomically', () => {
  const source = parse([row(1, 'Buy', 1, 100)]);
  for (const change of [fill => { fill.quantity = 0; }, fill => { fill.price = Infinity; }, fill => { fill.time.sortKey = 'fake'; }, fill => { fill.side = 'long'; }, fill => { fill.sourceRowNumber = 0; }]) {
    const input = structuredClone(source); change(input[0]); const before = structuredClone(input);
    assert.throws(() => reconstruct(input)); assert.deepEqual(input, before);
  }
  assert.throws(() => reconstruct([source[0], { ...source[0], sourceRowNumber: 3 }]), error => error.code === 'DUPLICATE_FILL_ID');
});
test('Trades: inactive execution and conflicting product/time basis fail closed', () => {
  assert.throws(() => run([row(1, 'Buy', 1, 100, { _active: 'false' })]), error => error.code === 'INACTIVE_FILL_UNSUPPORTED');
  assert.throws(() => run([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101, { product: 'MGC' })]), error => error.code === 'INCONSISTENT_CONTRACT_PRODUCT');
  const fills = parse([row(1, 'Buy', 1, 100), row(2, 'Sell', 1, 101)]);
  fills[1].fillTimeRaw = fills[1].displayedTimeRaw; fills[1].time = structuredClone(fills[1].displayedTime);
  assert.throws(() => reconstruct(fills), error => error.code === 'MIXED_TIME_BASIS');
});
test('Trades: finite numeric overflow rejects rather than returning infinite VWAP', () => {
  assert.throws(() => run([row(1, 'Buy', 2, '1' + '0'.repeat(308)), row(2, 'Sell', 2, 101)]), error => error.code === 'NUMERIC_OVERFLOW');
});
test('Trades: frozen input survives 100 repeats byte-identically, and outputs never alias caller data', () => {
  const input = deepFreeze(parse([row(1, 'Buy', 2, 100.125), row(2, 'Sell', 2, 101.375)]));
  const expected = JSON.stringify(reconstruct(input));
  for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(reconstruct(input)), expected);
  const changed = reconstruct(input); changed.closedTrades[0].fills[0].price = 0; changed.fills[0].rawFields.Price = 'fake';
  assert.equal(JSON.stringify(reconstruct(input)), expected);
});
test('Trades: quantity conservation, independent weighted arithmetic and ID stability across group interleaving', () => {
  const a = [row(1, 'Buy', 2, 10.125), row(2, 'Buy', 3, 10.375), row(3, 'Sell', 5, 11.625)];
  const b = [row(4, 'Sell', 2, 21.25, { accountId: '90000992', account: 'SYNTH-B' }), row(5, 'Buy', 2, 20.25, { accountId: '90000992', account: 'SYNTH-B' })];
  const first = run([...a, ...b]), second = run([a[0], b[0], a[1], b[1], a[2]]);
  assert.deepEqual(first.closedTrades.map(trade => trade.logicalTradeId), second.closedTrades.map(trade => trade.logicalTradeId));
  assert.equal(first.closedTrades[0].entryVwap, (10125 * 2 + 10375 * 3) / 5000);
  for (const trade of first.closedTrades) assert.equal(trade.quantity, trade.exitQuantity);
  assert.equal(first.closedTrades.flatMap(trade => trade.allFillIds).length, first.metadata.fillCount);
});
test('Trades: naive and explicit time parsing produce identical output across three Node TZ environments', () => {
  const code = `import {parseTradovateFillsCsv as parse} from './src/exit-research/tradovate-csv.js';
    import {reconstructLogicalTrades as run} from './src/exit-research/logical-trade.js';
    import {fillRow,fillsCsv,FILL_HEADERS} from './test/fixtures/tradovate/synthetic.js';
    const rows=[fillRow(),fillRow({fillId:'900000000000002',side:'Sell',time:'2035-02-03 01:02:04.100Z',displayTime:'02/03/2035 09:02:04'})];
    console.log(JSON.stringify([run(parse(fillsCsv(rows)).rows),run(parse(fillsCsv(rows,{headers:FILL_HEADERS.filter(h=>h!=='_timestamp')})).rows)]));`;
  const results = ['UTC', 'America/Chicago', 'Asia/Shanghai'].map(TZ => execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, TZ } }));
  assert.equal(results[0], results[1]); assert.equal(results[1], results[2]);
});
