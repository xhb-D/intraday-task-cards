// Local read-only acceptance. No real rows/IDs/prices are emitted or written.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv } from '../src/exit-research/tradovate-csv.js';
import { reconstructLogicalTrades } from '../src/exit-research/logical-trade.js';

const args = process.argv.slice(2);
const windowStartAssumption = args[0] === '--window-start-assumption=FLAT_CONFIRMED_FOR_QA' ? 'FLAT_CONFIRMED_FOR_QA' : 'UNCONFIRMED';
const paths = windowStartAssumption === 'FLAT_CONFIRMED_FOR_QA' ? args.slice(1) : args;
if (windowStartAssumption !== 'FLAT_CONFIRMED_FOR_QA') {
  console.error(JSON.stringify({ code: 'WINDOW_START_FLAT_UNCONFIRMED', windowStartAssumption }));
  process.exitCode = 1;
} else if (paths.length !== 3) {
  console.error('Usage: node scripts/qa-tradovate.mjs --window-start-assumption=FLAT_CONFIRMED_FOR_QA <Fills.csv> <Orders.csv> <Position-History.csv>');
  process.exitCode = 1;
} else {
  try {
    const parsers = [parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv];
    const sources = await Promise.all(paths.map(path => readFile(path)));
    const texts = sources.map(bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    const parsed = texts.map((text, index) => parsers[index](text));
    const boundary = { initialPositionMode: 'REQUIRE_FLAT', assumeFlatAtStart: true };
    const result = reconstructLogicalTrades(parsed[0].rows, boundary);
    const expected = parsed.map(value => JSON.stringify(value)), reconstructed = JSON.stringify(result);
    for (let repeat = 0; repeat < 100; repeat++) {
      texts.forEach((text, index) => assert.equal(JSON.stringify(parsers[index](text)), expected[index]));
      assert.equal(JSON.stringify(reconstructLogicalTrades(parsed[0].rows, boundary)), reconstructed);
    }
    const after = await Promise.all(paths.map(path => readFile(path)));
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    sources.forEach((bytes, index) => assert.equal(digest(bytes), digest(after[index])));
    const closedByProduct = {};
    for (const trade of result.closedTrades) closedByProduct[trade.product] = (closedByProduct[trade.product] || 0) + 1;
    const sourceFillCount = result.closedTrades.concat(result.openPositions).flatMap(trade => trade.allFillIds).length;
    assert.equal(sourceFillCount, parsed[0].rows.length);
    console.log(JSON.stringify({
      windowStartAssumption,
      files: parsed.map((value, index) => ({ file: basename(paths[index]), headers: value.headers, rows: value.rows.length,
        contracts: new Set(value.rows.map(row => row.contract)).size, accounts: new Set(value.rows.map(row => row.accountId)).size,
        parseErrors: 0, metadata: value.metadata })),
      reconstruction: result.metadata, closedByProduct, sourceFillCount, deterministicRepeats: 100, sourceBytesUnchanged: true
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ code: error.code || 'LOCAL_QA_FAILED', sourceRowNumber: error.sourceRowNumber ?? null, field: error.field ?? null }));
    process.exitCode = 1;
  }
}
