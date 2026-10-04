import { PRICE_SOURCE_MODES } from './market-config.js';
import { uniqueSorted } from './research-common.js';
const time = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isFinite(value) && value > 0;
const text = value => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const SERIES_KEYS = ['seriesId', 'role', 'provider', 'providerSymbol', 'researchFamily', 'product', 'contract', 'priceSourceMode', 'timeframeMs', 'timestampSemantics', 'timezone', 'coverageStart', 'coverageEnd', 'bars'];
export function validateMarketDataBundle(bundle) {
  const issues = [], series = [];
  const issue = (code, path) => issues.push({ code, path });
  if (!exactKeys(bundle, ['schemaVersion', 'source', 'sourceVersion', 'createdAt', 'series']) || bundle.schemaVersion !== 1 ||
    !text(bundle.source) || !text(bundle.sourceVersion) || !time(bundle.createdAt) || !Array.isArray(bundle.series)) {
    return { valid: false, qualityStatus: 'BLOCKED', qualityReasons: ['MARKET_BUNDLE_SCHEMA_INVALID'], issues: [{ code: 'MARKET_BUNDLE_SCHEMA_INVALID', path: 'bundle' }], series: [] };
  }
  const ids = new Set();
  bundle.series.forEach((s, i) => {
    const path = `series.${i}`, startIssues = issues.length;
    if (!exactKeys(s, SERIES_KEYS, ['proxyForContract', 'tickSize']) || !text(s.seriesId) || !['EXECUTION_PRIMARY', 'EXECUTION_DETAIL', 'CONTEXT'].includes(s.role) ||
      !text(s.provider) || !text(s.providerSymbol) || !['GC', 'ES', 'CL'].includes(s.researchFamily) || !text(s.product) || !text(s.contract) ||
      !(s.role === 'CONTEXT' ? s.priceSourceMode === 'CONTEXT_MARKET' : PRICE_SOURCE_MODES.includes(s.priceSourceMode)) ||
      !Number.isSafeInteger(s.timeframeMs) || s.timeframeMs <= 0 || s.timestampSemantics !== 'BAR_OPEN_TIME' || !['UTC', 'EXPLICIT_ABSOLUTE_TIME'].includes(s.timezone) ||
      !time(s.coverageStart) || !time(s.coverageEnd) || s.coverageStart >= s.coverageEnd || !Array.isArray(s.bars) ||
      (Object.hasOwn(s, 'tickSize') && s.tickSize !== null && !positive(s.tickSize)) ||
      (Object.hasOwn(s, 'proxyForContract') && s.proxyForContract !== null && !text(s.proxyForContract))) {
      issue('MARKET_SERIES_SCHEMA_INVALID', path); series.push({ seriesId: s?.seriesId ?? null, valid: false, gaps: [], qualityFlags: [] }); return;
    }
    if (ids.has(s.seriesId)) issue('DUPLICATE_MARKET_SERIES_ID', path); ids.add(s.seriesId);
    const gaps = [];
    s.bars.forEach((bar, j) => {
      const bp = `${path}.bars.${j}`;
      if (!exactKeys(bar, ['openTime', 'open', 'high', 'low', 'close', 'volume']) || !time(bar.openTime) || !time(bar.openTime + s.timeframeMs)) { issue('MARKET_BAR_SCHEMA_INVALID', bp); return; }
      if (![bar.open, bar.high, bar.low, bar.close].every(positive) || bar.high < Math.max(bar.open, bar.low, bar.close) || bar.low > Math.min(bar.open, bar.high, bar.close)) issue('MARKET_BAR_OHLC_INVALID', bp);
      if (bar.volume !== null && (!Number.isFinite(bar.volume) || bar.volume < 0)) issue('MARKET_BAR_VOLUME_INVALID', bp);
      if (j > 0) {
        const previous = s.bars[j - 1];
        if (!time(previous?.openTime)) return;
        const delta = bar.openTime - previous.openTime;
        if (delta === 0) issue('DUPLICATE_BAR_OPEN_TIME', bp);
        else if (delta < 0) issue('UNSORTED_MARKET_BARS', bp);
        else if (delta < s.timeframeMs) issue('OVERLAPPING_MARKET_BARS', bp);
        else if (delta > s.timeframeMs) gaps.push({ startAt: previous.openTime + s.timeframeMs, endAt: bar.openTime });
      }
    });
    const actualStart = s.bars[0]?.openTime ?? null, actualEnd = s.bars.length ? s.bars.at(-1).openTime + s.timeframeMs : null;
    if (s.bars.length && (actualStart !== s.coverageStart || actualEnd !== s.coverageEnd)) issue('MARKET_COVERAGE_METADATA_CONFLICT', path);
    series.push({ seriesId: s.seriesId, valid: issues.length === startIssues, actualCoverageStart: actualStart, actualCoverageEnd: actualEnd, gaps,
      qualityFlags: [...(gaps.length ? ['MARKET_DATA_GAP'] : []), ...(!s.bars.length ? ['MARKET_SERIES_EMPTY'] : [])] });
  });
  return { valid: !issues.length, qualityStatus: issues.length ? 'BLOCKED' : 'VALIDATED', qualityReasons: uniqueSorted(issues.map(x => x.code)), issues, series };
}
function canonicalSeries(s) {
  return JSON.stringify({ provider: s.provider, providerSymbol: s.providerSymbol, researchFamily: s.researchFamily, product: s.product, contract: s.contract,
    priceSourceMode: s.priceSourceMode, proxyForContract: s.proxyForContract ?? null, tickSize: s.tickSize ?? null, timeframeMs: s.timeframeMs,
    timestampSemantics: s.timestampSemantics, timezone: s.timezone, coverageStart: s.coverageStart, coverageEnd: s.coverageEnd,
    bars: s.bars.map(b => [b.openTime, b.open, b.high, b.low, b.close, b.volume]) });
}
// Collision-free canonical content identity, not a compact digest or authenticity claim.
export const marketSeriesFingerprint = s => 'market-series-v1:' + canonicalSeries(s);
export const marketBundleFingerprint = bundle => 'market-bundle-v1:' + JSON.stringify(bundle.series.map(canonicalSeries).sort());
