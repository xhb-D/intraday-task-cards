import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { FILL_HEADERS, ORDER_HEADERS, POSITION_HEADERS, fillRow, orderRow, positionRow, makeCsv } from './fixtures/tradovate/synthetic.js';

async function samples(action, invalid = false) {
  const directory = await mkdtemp(join(tmpdir(), 'tradovate-synthetic-'));
  try {
    const paths = ['fills.csv', 'orders.csv', 'positions.csv'].map(name => join(directory, name));
    await Promise.all([
      writeFile(paths[0], makeCsv(FILL_HEADERS, [fillRow({ Quantity: invalid ? '0' : '2' })], { bom: true, newline: '\r\n' })),
      writeFile(paths[1], makeCsv(ORDER_HEADERS, [orderRow()])),
      writeFile(paths[2], makeCsv(POSITION_HEADERS, [positionRow()]))
    ]);
    await action(paths);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('Local QA: BOM survives decoding; output contains only headers and aggregates, never execution identifiers', async () => {
  await samples(async paths => {
    const output = execFileSync(process.execPath, ['scripts/qa-tradovate.mjs', ...paths], { encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.files[0].metadata.bom, true); assert.equal(result.files[0].rows, 1);
    assert.equal(result.reconstruction.openPositionCount, 1); assert.equal(result.sourceFillCount, 1);
    assert.equal(result.sourceBytesUnchanged, true); assert.equal(result.deterministicRepeats, 100);
    for (const value of ['900000000000001', '900000000001001', '90000991', 'SYNTH-A', '103.25', '2035-02-03']) assert.ok(!output.includes(value));
  });
});
test('Local QA: invalid CSV emits structured error and no partial aggregate output', async () => {
  await samples(async paths => {
    const result = spawnSync(process.execPath, ['scripts/qa-tradovate.mjs', ...paths], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { code: 'INVALID_NUMBER', sourceRowNumber: 2, field: 'Quantity' });
  }, true);
});
