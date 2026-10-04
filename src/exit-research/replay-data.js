import { validateMarketDataBundle, marketSeriesFingerprint, marketBundleFingerprint } from './market-data.js';
import { analyzeHoldingPath } from './path-metrics.js';
import { PRICE_SOURCE_MODES } from './market-config.js';
import { executionProductForFamily } from './symbol-map.js';
const fields = ['provider', 'providerSymbol', 'researchFamily', 'product', 'contract', 'priceSourceMode'];
function matches(s, t) {
  if (s.role !== 'EXECUTION_PRIMARY' || s.researchFamily !== t.researchFamily) return false;
  if (s.priceSourceMode === 'EXACT_EXECUTION_CONTRACT') return s.product === t.executionProduct && s.contract === t.executionContract;
  if (s.product !== t.researchFamily || s.proxyForContract !== t.executionContract) return false;
  if (s.priceSourceMode === 'CONTINUOUS_CONTRACT_PROXY') return true;
  const expiry = (c, p) => c.startsWith(p) && /^[FGHJKMNQUVXZ]\d{1,4}$/.test(c.slice(p.length)) ? c.slice(p.length) : null;
  return expiry(s.contract, s.product) !== null && expiry(s.contract, s.product) === expiry(t.executionContract, t.executionProduct);
}
export function prepareReplayData(trade, bundle, options) {
  const fail = reasons => ({ valid: false, qualityReasons: reasons });
  const validation = validateMarketDataBundle(bundle);
  if (!validation.valid) return fail(validation.qualityReasons);
  if (typeof trade.researchTradeId !== 'string' || !trade.researchTradeId.trim() || typeof trade.executionContract !== 'string' || !trade.executionContract.trim() || trade.executionProduct !== executionProductForFamily(trade.researchFamily) || !trade.executionContract) return fail(['RESEARCH_EXECUTION_IDENTITY_INVALID']);
  let candidates = options.primarySeriesId == null ? bundle.series.filter(s => matches(s, trade)) : bundle.series.filter(s => s.seriesId === options.primarySeriesId);
  if (!candidates.length) return fail(['EXECUTION_PATH_MISSING']);
  if (options.primarySeriesId == null) {
    const best = Math.min(...candidates.map(s => PRICE_SOURCE_MODES.indexOf(s.priceSourceMode)));
    candidates = candidates.filter(s => PRICE_SOURCE_MODES.indexOf(s.priceSourceMode) === best);
  }
  if (candidates.length !== 1) return fail(['EXECUTION_SERIES_AMBIGUOUS']);
  const primary = candidates[0];
  if (!matches(primary, trade) || primary.timeframeMs !== 300000) return fail(['REPLAY_PRIMARY_INVALID']);
  let detail = null;
  if (options.detailSeriesId !== null) {
    const related = bundle.series.filter(s => s.role === 'EXECUTION_DETAIL' && s.researchFamily === primary.researchFamily);
    const fine = options.detailSeriesId === undefined ? related.filter(s => fields.every(k => s[k] === primary[k]) && (s.proxyForContract ?? null) === (primary.proxyForContract ?? null)) : bundle.series.filter(s => s.seriesId === options.detailSeriesId);
    if (!fine.length && (related.length || options.detailSeriesId !== undefined)) return fail(['DETAIL_MARKET_MISMATCH']);
    if (fine.length > 1) return fail(['DETAIL_SERIES_AMBIGUOUS']);
    detail = fine[0] ?? null;
  }
  // Reuse frozen interval/detail validation with an independent replay window.
  const path = analyzeHoldingPath({ ...trade, actualExitTime: options.replayHardEndAt }, primary, detail);
  if (!path.valid) return fail(path.qualityReasons);
  return { valid: true, primary, detail, path, fingerprint: marketSeriesFingerprint(primary), bundleFingerprint: marketBundleFingerprint(bundle),
    provenance: { source: bundle.source, sourceVersion: bundle.sourceVersion, createdAt: bundle.createdAt,
      primary: { seriesId: primary.seriesId, provider: primary.provider, providerSymbol: primary.providerSymbol, contract: primary.contract, product: primary.product,
        priceSourceMode: primary.priceSourceMode, timeframeMs: primary.timeframeMs, coverageStart: primary.coverageStart, coverageEnd: primary.coverageEnd },
      detail: detail ? { seriesId: detail.seriesId, fingerprint: marketSeriesFingerprint(detail) } : null } };
}
