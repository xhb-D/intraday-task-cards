// Local read-only QA; never emit account/fill/order IDs, raw bars or canonical fingerprints.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { calculateMarketMetrics } from '../src/exit-research/market-metrics.js';

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  console.error('Usage: node scripts/qa-market-metrics.mjs <ResearchTrade.json> <MarketDataBundle.json>'); process.exitCode = 1;
} else {
  try {
    const before = await Promise.all(paths.map(path => readFile(path)));
    const parse = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const [trade, bundle] = before.map(parse), result = calculateMarketMetrics(trade, bundle), expected = JSON.stringify(result);
    for (let n = 0; n < 100; n++) assert.equal(JSON.stringify(calculateMarketMetrics(trade, bundle)), expected);
    const after = await Promise.all(paths.map(path => readFile(path)));
    before.forEach((bytes, i) => assert.ok(bytes.equals(after[i])));
    const summary = metric => metric ? { exact: metric.exact, partial: metric.partial, confirmedR: metric.confirmedR, possibleMaxR: metric.possibleMaxR } : null;
    console.log(JSON.stringify({ family: trade.researchFamily, direction: trade.direction, priceSourceMode: result.priceSourceMode,
      metricQuality: result.metricQuality, coverageStatus: result.coverageStatus, detailModeUsed: result.detailModeUsed,
      mfe: summary(result.mfe), mae: summary(result.mae), milestones: result.milestones ? Object.fromEntries(Object.entries(result.milestones).map(([key, value]) => [key, value.status])) : null,
      qualityStatus: result.qualityStatus, qualityReasons: result.qualityReasons, statisticsEligible: result.statisticsEligible,
      deterministicRepeats: 100, sourceBytesUnchanged: true }, null, 2));
  } catch (error) { console.error(JSON.stringify({ code: error.code || 'LOCAL_MARKET_METRICS_QA_FAILED' })); process.exitCode = 1; }
}
