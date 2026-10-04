import { validateMarketDataBundle, marketSeriesFingerprint, marketBundleFingerprint } from './market-data.js';
import { PRICE_SOURCE_MODES, MARKET_TIMEFRAMES } from './market-config.js';
import { executionProductForFamily } from './symbol-map.js';
import { initialRisk } from './r-math.js';
import { analyzeHoldingPath, holdingExcursions } from './path-metrics.js';
import { holdingMilestones } from './milestones.js';
import { clone, uniqueSorted } from './research-common.js';
const safeTime = time => Number.isSafeInteger(time) && time >= 0;
function supportsTrade(series, trade) {
  if (series.role !== 'EXECUTION_PRIMARY' || series.researchFamily !== trade.researchFamily) return false;
  if (series.priceSourceMode === 'EXACT_EXECUTION_CONTRACT') return series.product === trade.executionProduct && series.contract === trade.executionContract;
  if (series.product !== trade.researchFamily || series.proxyForContract !== trade.executionContract) return false;
  if (series.priceSourceMode === 'CONTINUOUS_CONTRACT_PROXY') return true; // Producer explicitly attests the resolved proxy symbol/contract; never manufacture it.
  const expiry = (contract, product) => contract.startsWith(product) && /^[FGHJKMNQUVXZ]\d{1,4}$/.test(contract.slice(product.length)) ? contract.slice(product.length) : null;
  return expiry(series.contract, series.product) !== null && expiry(series.contract, series.product) === expiry(trade.executionContract, trade.executionProduct);
}
export function marketMetricsQuality(trade, { reasons = [], priceSourceMode = null, coverageStatus = 'INCOMPLETE', conflict = false } = {}) {
  const blocked = [], review = [];
  if (trade.qualityStatus === 'BLOCKED') blocked.push('STEP3_BLOCKED', ...(trade.qualityReasons || []));
  else if (trade.qualityStatus === 'REVIEW_REQUIRED') review.push('STEP3_REVIEW_REQUIRED', ...(trade.qualityReasons || []));
  else if (trade.qualityStatus !== 'READY') blocked.push('STEP3_QUALITY_INVALID');
  if (conflict) blocked.push(...reasons);
  else if (coverageStatus !== 'COMPLETE') blocked.push('MARKET_DATA_INCOMPLETE', ...reasons);
  else review.push(...reasons);
  if (priceSourceMode && priceSourceMode !== 'EXACT_EXECUTION_CONTRACT') review.push('PRICE_SOURCE_PROXY', ...(priceSourceMode === 'CONTINUOUS_CONTRACT_PROXY' ? ['CONTINUOUS_CONTRACT_PROXY'] : []));
  return { qualityStatus: blocked.length ? 'BLOCKED' : review.length ? 'REVIEW_REQUIRED' : 'READY', qualityReasons: uniqueSorted([...blocked, ...review]) };
}
export function calculateMarketMetrics(trade, bundle, { primarySeriesId = null, detailSeriesId = undefined, executionTickSize = null } = {}) {
  const risk = initialRisk(trade, { tickSize: executionTickSize });
  const base = { schemaVersion: 1, researchTradeId: trade.researchTradeId ?? null, marketSeriesId: null, priceSourceMode: null,
    marketDataFingerprint: null, bundleFingerprint: null, provenance: null,
    initialRiskPoints: risk.initialRiskPoints, initialRiskTicks: risk.initialRiskTicks,
    holdingWindow: { startAt: trade.actualEntryTime ?? null, endAt: trade.actualExitTime ?? null, intervalSemantics: 'CLOSED' },
    mfe: null, mae: null, milestones: null, coverageStatus: 'INCOMPLETE', detailModeUsed: 'NONE', metricQuality: null, statisticsEligible: false };
  const blocked = reasons => ({ ...base, ...marketMetricsQuality(trade, { reasons, conflict: true }) });
  if (!risk.valid) return blocked(risk.qualityReasons);
  if (typeof trade.researchTradeId !== 'string' || !trade.researchTradeId || executionProductForFamily(trade.researchFamily) === null || trade.executionProduct !== executionProductForFamily(trade.researchFamily) ||
    typeof trade.executionContract !== 'string' || !trade.executionContract || !safeTime(trade.actualEntryTime) || !safeTime(trade.actualExitTime) ||
    trade.actualExitTime < trade.actualEntryTime || !Number.isFinite(trade.actualExitPrice) || trade.actualExitPrice <= 0) return blocked(['RESEARCH_EXECUTION_WINDOW_INVALID']);
  const validation = validateMarketDataBundle(bundle);
  if (!validation.valid) return blocked(validation.qualityReasons);
  let candidates = primarySeriesId === null ? bundle.series.filter(s => supportsTrade(s, trade)) : bundle.series.filter(s => s.seriesId === primarySeriesId);
  if (!candidates.length) return blocked(['EXECUTION_PATH_MISSING']);
  if (primarySeriesId === null) {
    const bestRank = Math.min(...candidates.map(s => PRICE_SOURCE_MODES.indexOf(s.priceSourceMode)));
    candidates = candidates.filter(s => PRICE_SOURCE_MODES.indexOf(s.priceSourceMode) === bestRank);
  }
  if (candidates.length !== 1) return blocked(['EXECUTION_SERIES_AMBIGUOUS']);
  const primary = candidates[0];
  if (!supportsTrade(primary, trade)) return blocked(['EXECUTION_MARKET_MISMATCH']);
  if (primary.timeframeMs !== MARKET_TIMEFRAMES.PRIMARY) return blocked(['PRIMARY_TIMEFRAME_INVALID']);
  let detail = null;
  if (detailSeriesId !== null) {
    const related = bundle.series.filter(s => s.role === 'EXECUTION_DETAIL' && s.researchFamily === primary.researchFamily);
    const available = detailSeriesId === undefined ? related.filter(s => ['provider', 'providerSymbol', 'product', 'contract', 'priceSourceMode'].every(key => s[key] === primary[key]) && (s.proxyForContract ?? null) === (primary.proxyForContract ?? null)) : bundle.series.filter(s => s.seriesId === detailSeriesId);
    if (!available.length && (detailSeriesId !== undefined || related.length)) return blocked(['DETAIL_MARKET_MISMATCH']);
    if (available.length > 1) return blocked(['DETAIL_SERIES_AMBIGUOUS']);
    detail = available[0] ?? null;
  }
  const path = analyzeHoldingPath(trade, primary, detail);
  if (!path.valid) return blocked(path.qualityReasons);
  const excursions = holdingExcursions(trade, path);
  if (excursions.valid === false) return blocked(excursions.qualityReasons);
  if ([excursions.mfe.confirmedR, excursions.mae.confirmedR].some(value => !Number.isFinite(value)) ||
    path.coverageStatus === 'COMPLETE' && [excursions.mfe.possibleMaxR, excursions.mae.possibleMaxR].some(value => !Number.isFinite(value))) return blocked(['R_NUMERIC_OVERFLOW']);
  const milestones = holdingMilestones(trade, path);
  const reasons = [...path.qualityReasons, ...(Object.values(milestones).some(m => m.thresholdPrice === null) ? ['R_NUMERIC_OVERFLOW'] : [])];
  const quality = marketMetricsQuality(trade, { reasons, priceSourceMode: primary.priceSourceMode, coverageStatus: path.coverageStatus,
    conflict: reasons.includes('R_NUMERIC_OVERFLOW') });
  const seriesProvenance = s => ({ seriesId: s.seriesId, provider: s.provider, providerSymbol: s.providerSymbol, product: s.product, contract: s.contract,
    priceSourceMode: s.priceSourceMode, proxyForContract: s.proxyForContract ?? null, timeframeMs: s.timeframeMs,
    coverageStart: s.coverageStart, coverageEnd: s.coverageEnd, fingerprint: marketSeriesFingerprint(s) });
  return { ...base, marketSeriesId: primary.seriesId, priceSourceMode: primary.priceSourceMode,
    marketDataFingerprint: marketSeriesFingerprint(primary), bundleFingerprint: marketBundleFingerprint(bundle),
    provenance: { source: bundle.source, sourceVersion: bundle.sourceVersion, createdAt: bundle.createdAt, primary: seriesProvenance(primary),
      detail: detail ? seriesProvenance(detail) : null, detailUsed: path.detailModeUsed === 'ON_DEMAND' },
    holdingWindow: clone(path.holdingWindow), ...excursions, milestones, coverageStatus: path.coverageStatus, coverageGaps: clone(path.coverageGaps), detailModeUsed: path.detailModeUsed,
    metricQuality: primary.priceSourceMode === 'EXACT_EXECUTION_CONTRACT' ? 'EXACT' : 'PROXY', ...quality,
    statisticsEligible: quality.qualityStatus === 'READY' && primary.priceSourceMode === 'EXACT_EXECUTION_CONTRACT' };
}
