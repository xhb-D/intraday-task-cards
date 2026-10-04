// Read-only, aggregate-only local QA. Real source rows never enter a repository artifact.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv } from '../src/exit-research/tradovate-csv.js';
import { reconstructLogicalTrades } from '../src/exit-research/logical-trade.js';
import { assessExecutionQa } from '../src/exit-research/execution-qa.js';
import { buildResearchTrades } from '../src/exit-research/research-trade.js';
import { assertState } from '../src/model.js';
import { APP_ID, validateEnvelope } from '../src/persistence.js';
import { validateUnified } from '../src/unified-persistence.js';

const [assumption, ...paths] = process.argv.slice(2);
if (assumption !== '--window-start-assumption=FLAT_CONFIRMED_FOR_QA') {
  console.error(JSON.stringify({ code: 'WINDOW_START_FLAT_UNCONFIRMED' })); process.exitCode = 1;
} else if (![3, 4].includes(paths.length)) {
  console.error('Usage: node scripts/qa-exit-reconciliation.mjs --window-start-assumption=FLAT_CONFIRMED_FOR_QA <Fills> <Orders> <Position-History> [V5-workspace-or-Unified-V2.json]'); process.exitCode = 1;
} else {
  try {
    const before = await Promise.all(paths.map(path => readFile(path)));
    const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const [fills, orders, history] = [parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv].map((parse, i) => parse(decode(before[i])).rows);
    const reconstructed = reconstructLogicalTrades(fills, { initialPositionMode: 'REQUIRE_FLAT', assumeFlatAtStart: true });
    const options = { orders, positionHistory: history, allExecutionFills: fills };
    let records = null;
    if (paths.length === 4) {
      const json = JSON.parse(decode(before[3]));
      const workspace = json.app === 'trading-control-center' ? (validateUnified(json), json.sections.intraday.state) :
        json.app === APP_ID ? (validateEnvelope(json), json.state) : json;
      assertState(workspace); records = workspace.records;
    }
    const qa = assessExecutionQa(reconstructed.closedTrades, orders, history, { fills });
    const research = records ? buildResearchTrades(records, reconstructed.closedTrades, options) : null;
    const expected = JSON.stringify({ qa, research });
    for (let n = 0; n < 100; n++) assert.equal(JSON.stringify({ qa: assessExecutionQa(reconstructed.closedTrades, orders, history, { fills }),
      research: records ? buildResearchTrades(records, reconstructed.closedTrades, options) : null }), expected);
    const after = await Promise.all(paths.map(path => readFile(path)));
    const digest = bytes => createHash('sha256').update(bytes).digest('hex');
    before.forEach((bytes, i) => assert.equal(digest(bytes), digest(after[i])));
    const counts = values => values.reduce((out, value) => (out[value] = (out[value] || 0) + 1, out), {});
    console.log(JSON.stringify({ windowStartAssumption: 'FLAT_CONFIRMED_FOR_QA',
      sourceRows: { fills: fills.length, orders: orders.length, positionHistory: history.length }, reconstruction: reconstructed.metadata,
      executionQa: { orders: counts(Object.values(qa).map(q => q.orders.status)), positionHistory: counts(Object.values(qa).map(q => q.positionHistory.status)),
        orderFlagCounts: counts(Object.values(qa).flatMap(q => q.orders.flags.map(f => f.code))), historyFlagCounts: counts(Object.values(qa).flatMap(q => q.positionHistory.flags.map(f => f.code))), pnlAmountVerified: false },
      htmlJsonAvailable: records !== null, actualMatchingPerformed: records !== null,
      matchingStatuses: research ? counts(research.matches.map(m => m.matchingStatus)) : null,
      qualityStatuses: research ? counts(research.researchTrades.map(t => t.qualityStatus)) : null,
      note: records ? '仅验证显式给定 JSON 与窗口起点 Flat 条件下的匹配' : '真实 Tradovate 三表 QA 已运行，但 HTML↔Tradovate 实际匹配尚缺真实 Task Card JSON。',
      deterministicRepeats: 100, sourceBytesUnchanged: true }, null, 2));
  } catch (error) { console.error(JSON.stringify({ code: error.code || 'LOCAL_RECONCILIATION_QA_FAILED', field: error.field ?? null })); process.exitCode = 1; }
}
