import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/exit-research/csv.js';
import { parseTradovateTime } from '../src/exit-research/time.js';
import { parseTradovateFillsCsv as fills, parseTradovateOrdersCsv as orders, parseTradovatePositionHistoryCsv as positions } from '../src/exit-research/tradovate-csv.js';
import { FILL_HEADERS, ORDER_HEADERS, POSITION_HEADERS, fillRow, orderRow, positionRow, makeCsv, fillsCsv } from './fixtures/tradovate/synthetic.js';
const error = (code, row, field) => value => value.code === code && value.sourceRowNumber === row && value.field === field;

test('CSV: BOM, CRLF, quoted commas/quotes, empty fields and no final newline preserve exact values', () => {
  const parsed = parseCsv('\uFEFFA,B,C\r\n"x,y","say ""yes""",');
  assert.deepEqual(parsed.headers, ['A', 'B', 'C']);
  assert.deepEqual(parsed.rows, [{ values: ['x,y', 'say "yes"', ''], sourceRowNumber: 2 }]);
  assert.deepEqual(parsed.metadata, { bom: true, newline: 'CRLF', rowCount: 1 });
});
test('CSV: LF and multi-line quoted field preserve physical source row provenance', () => {
  const parsed = parseCsv('A,B\n"one\ntwo",x\ny,z\n');
  assert.deepEqual(parsed.rows.map(row => row.sourceRowNumber), [2, 4]);
  assert.equal(parsed.rows[0].values[0], 'one\ntwo');
  assert.equal(parsed.metadata.newline, 'LF');
});
for (const [source, code, row] of [
  ['A,B\nx', 'COLUMN_COUNT_MISMATCH', 2], ['A,B\nx,y,z', 'COLUMN_COUNT_MISMATCH', 2],
  ['A,B\n"open,x', 'UNCLOSED_QUOTE', 2], ['A,B\nx"bad,y', 'INVALID_QUOTE', 2],
  ['A,B\n"x"oops,y', 'INVALID_QUOTE', 2], ['A,B\rx,y', 'INVALID_LINE_ENDING', 1],
  ['A,B\n\nx,y', 'COLUMN_COUNT_MISMATCH', 2]
]) test(`CSV: malformed ${code} at row ${row} fails closed (${source.length})`, () => {
  assert.throws(() => parseCsv(source), error(code, row, 'csv'));
});
test('CSV: empty input and empty/duplicate headers reject; header-only export is valid', () => {
  assert.throws(() => parseCsv(''), error('EMPTY_CSV', 1, 'header'));
  for (const source of ['A,A\n1,2', 'A,\n1,2']) assert.throws(() => parseCsv(source), error('INVALID_HEADER', 1, 'header'));
  assert.deepEqual(parseCsv('A,B').rows, []);
});
test('Fills: actual headers normalize IDs, account, exact contract, side, quantity and both time representations', () => {
  const parsed = fills(fillsCsv([fillRow()], { bom: true, newline: '\r\n', finalNewline: false }));
  assert.deepEqual(parsed.headers, FILL_HEADERS);
  const row = parsed.rows[0];
  assert.equal(row.fillId, '900000000000001'); assert.equal(row.orderId, '900000000001001');
  assert.equal(row.accountId, '90000991'); assert.equal(row.accountLabel, 'SYNTH-A');
  assert.equal(row.product, 'MES'); assert.equal(row.contract, 'MESZ9'); assert.equal(row.side, 'buy');
  assert.equal(row.quantity, 2); assert.equal(row.price, 103.25); assert.equal(row.sourceRowNumber, 2);
  assert.equal(row.fillTimeRaw, '2035-02-03 01:02:03.100Z');
  assert.equal(row.time.sortKey, '2035-02-03T01:02:03.100Z'); assert.equal(row.time.timezone, 'UTC');
  assert.equal(row.normalizedLocalTime, '2035-02-03T09:02:03.000'); assert.equal(row.displayedTime.timezone, 'unknown');
  assert.equal(row.displayedTime.offsetMinutes, null); assert.equal(parsed.metadata.primaryTimeField, '_timestamp');
});
test('Fills: absent account and machine time are explicit null and unknown, never guessed', () => {
  const headers = FILL_HEADERS.filter(header => !['_accountId', 'Account', '_timestamp'].includes(header));
  const parsed = fills(fillsCsv([fillRow()], { headers }));
  assert.equal(parsed.rows[0].accountId, null); assert.equal(parsed.metadata.accountField, null);
  assert.equal(parsed.rows[0].time.timezone, 'unknown'); assert.equal(parsed.rows[0].time.offsetMinutes, null);
  assert.equal(parsed.rows[0].time.sortKey, '2035-02-03T09:02:03.000');
});
test('Fills: Account alone preserves distinguishable accounts', () => {
  const headers = FILL_HEADERS.filter(header => header !== '_accountId');
  const rows = fills(fillsCsv([fillRow(), fillRow({ fillId: '900000000000002', account: 'SYNTH-B' })], { headers })).rows;
  assert.deepEqual(rows.map(row => row.accountId), ['SYNTH-A', 'SYNTH-B']);
});
for (const [field, value, code] of [
  ['Fill ID', '', 'INVALID_ID'], ['Order ID', '', 'INVALID_ID'], ['Contract', '', 'INVALID_ID'],
  ['Quantity', '0', 'INVALID_NUMBER'], ['Quantity', '-1', 'INVALID_NUMBER'], ['Quantity', '1.5', 'INVALID_NUMBER'],
  ['Price', 'NaN', 'INVALID_NUMBER'], ['Price', 'Infinity', 'INVALID_NUMBER'], ['Price', '0', 'INVALID_NUMBER'],
  ['B/S', 'Long', 'INVALID_SIDE'], ['Timestamp', '02/30/2035 12:00:00', 'INVALID_TIME'],
  ['_timestamp', '', 'INVALID_TIME'], ['_accountId', '', 'INVALID_ID'], ['_active', 'yes', 'INVALID_BOOLEAN']
]) test(`Fills: invalid ${field} ${value} rejects with non-sensitive field and row error`, () => {
  assert.throws(() => fills(fillsCsv([fillRow({ [field]: value })])), error(code, 2, field));
});
test('Fills: missing required header and conflicting alias reject, without including row values', () => {
  assert.throws(() => fills(fillsCsv([], { headers: FILL_HEADERS.filter(header => header !== 'Price') })), error('MISSING_HEADER', 1, 'Price'));
  for (const alias of ['_id', '_orderId', '_qty', '_price']) {
    const csv = fillsCsv([fillRow({ [alias]: '900009999' })]);
    assert.throws(() => fills(csv), value => error('INCONSISTENT_ALIAS', 2, alias)(value) && !value.message.includes('900009999'));
  }
});
test('Fills: duplicate ID always rejects even identical rows; arbitrary large IDs remain strings', () => {
  assert.throws(() => fills(fillsCsv([fillRow(), fillRow()])), error('DUPLICATE_FILL_ID', 3, 'Fill ID'));
  assert.equal(fills(fillsCsv([fillRow({ fillId: '90000000000000000000000000001' })])).rows[0].fillId, '90000000000000000000000000001');
});
test('Time: real calendar and clock validation reject invalid fields independently of environment', () => {
  for (const raw of ['02/29/2035 12:00:00', '13/01/2035 12:00:00', '02/03/2035 24:00:00', '02/03/2035 12:60:00', '02/03/2035 12:00:60', '2035-02-03 12:00:00Zbad', '2035-02-03T12:00:00+24:00']) {
    assert.throws(() => parseTradovateTime(raw, 8, 'time'), error('INVALID_TIME', 8, 'time'));
  }
  assert.equal(parseTradovateTime('02/29/2036 12:00:00', 2, 'time').timezone, 'unknown');
});
test('Time: explicit offset is retained and used, with equivalent instants sortable identically', () => {
  const time = parseTradovateTime('2035-02-03T09:02:03.100+08:00', 2, 'time');
  assert.equal(time.normalized, '2035-02-03T09:02:03.100+08:00'); assert.equal(time.offsetMinutes, 480);
  assert.equal(time.sortKey, '2035-02-03T01:02:03.100Z');
});
test('Orders: quoted fields, neutral stop naming, optional blanks and grouped numeric money normalize', () => {
  const result = orders(makeCsv(ORDER_HEADERS, [orderRow(), orderRow({ 'Stop Price': '101.50', decimalStop: '101.5' })]));
  assert.deepEqual(result.headers, ORDER_HEADERS);
  assert.equal(result.rows[0].rawFields.Text, 'Synthetic "quoted", note'); assert.equal(result.rows[0].reportedStopPrice, null);
  assert.equal(result.rows[1].reportedStopPrice, 101.5); assert.equal(result.rows[0].notionalValue, 1032.5);
  assert.equal(result.rows[0].orderTime.timezone, 'unknown'); assert.equal(result.rows[0].orderType, 'Limit');
  assert.equal(result.rows[0].versionId, '900000000001002'); assert.equal(Object.hasOwn(result.rows[1], 'initialStop'), false);
});
test('Orders: blank unfilled optional fields are null; malformed nonblank values and alias conflict reject', () => {
  const row = orderRow({ avgPrice: '', filledQty: '', 'Fill Time': '', 'Filled Qty': '', 'Avg Fill Price': '', decimalFillAvg: '', Status: ' Canceled' });
  const result = orders(makeCsv(ORDER_HEADERS, [row])).rows[0];
  assert.equal(result.filledQuantity, null); assert.equal(result.averageFillPrice, null); assert.equal(result.fillTime, null);
  assert.throws(() => orders(makeCsv(ORDER_HEADERS, [orderRow({ 'Stop Price': 'oops' })])), error('INVALID_NUMBER', 2, 'Stop Price'));
  assert.throws(() => orders(makeCsv(ORDER_HEADERS, [orderRow({ decimalLimit: '105' })])), error('INCONSISTENT_ALIAS', 2, 'decimalLimit'));
});
test('Positions: paired rows preserve all IDs, signed P/L, null net price and local timestamp fields', () => {
  const result = positions(makeCsv(POSITION_HEADERS, [positionRow(), positionRow({ 'Pair ID': '900000000002003' })]));
  assert.deepEqual(result.headers, POSITION_HEADERS); assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].positionId, result.rows[1].positionId); assert.notEqual(result.rows[0].pairId, result.rows[1].pairId);
  assert.equal(result.rows[0].pnl, -12.5); assert.equal(result.rows[0].netPrice, null); assert.equal(result.rows[0].pairedQuantity, 2);
  assert.equal(result.rows[0].boughtTime.timezone, 'unknown'); assert.equal(result.rows[0].soldTime.timezone, 'unknown');
});
test('Positions: malformed quantity, money and missing header fail closed', () => {
  assert.throws(() => positions(makeCsv(POSITION_HEADERS, [positionRow({ 'Paired Qty': '0' })])), error('INVALID_NUMBER', 2, 'Paired Qty'));
  assert.throws(() => positions(makeCsv(POSITION_HEADERS, [positionRow({ 'P/L': '1,23.00' })])), error('INVALID_NUMBER', 2, 'P/L'));
  assert.throws(() => positions(makeCsv(POSITION_HEADERS.filter(header => header !== 'Position ID'), [])), error('MISSING_HEADER', 1, 'Position ID'));
});
test('Parsers: 100 repeats are identical and parsed outputs are independent', () => {
  const input = fillsCsv([fillRow()]); const expected = fills(input);
  for (let i = 0; i < 100; i++) assert.deepEqual(fills(input), expected);
  const changed = fills(input); changed.rows[0].rawFields.Price = 'fake';
  assert.deepEqual(fills(input), expected);
});

test('Fills: machine float representation remains execution price while display value and discrepancy stay explicit', () => {
  const input = fillsCsv([fillRow({ price: '103.2', _price: '103.20000000000001' })]);
  const result = fills(input), row = result.rows[0];
  assert.equal(row.price, 103.20000000000001); assert.equal(row.displayedPrice, 103.2);
  assert.equal(row.rawFields._price, '103.20000000000001');
  assert.deepEqual(row.numericRepresentationDifferences, [{ field: '_price', comparedWith: 'Price' }]);
  assert.equal(result.metadata.numericRepresentationDifferenceCount, 1);
  assert.throws(() => fills(fillsCsv([fillRow({ price: '103.2', _price: '103.21' })])), error('INCONSISTENT_ALIAS', 2, '_price'));
});
test('Orders: machine stop/average representation is preserved without rounding or initial-stop inference', () => {
  const row = orderRow({ avgPrice: '103.25000000000001', decimalFillAvg: '103.25000000000001', 'Stop Price': '102.2', decimalStop: '102.20000000000001' });
  const result = orders(makeCsv(ORDER_HEADERS, [row]));
  assert.equal(result.rows[0].reportedStopPrice, 102.20000000000001);
  assert.equal(result.rows[0].averageFillPrice, 103.25000000000001);
  assert.equal(result.metadata.numericRepresentationDifferenceCount, 3);
  assert.equal(Object.hasOwn(result.rows[0], 'initialStop'), false);
});
