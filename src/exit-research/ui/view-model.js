import { captureResearchInput, blockOverlappingResearch } from './capture-adapter.js';
import { effectiveInitialStop } from '../../model.js';
import { reconstructLogicalTrades } from '../logical-trade.js';
import { buildResearchTrades } from '../research-trade.js';
import { initialRisk, rAtPrice } from '../r-math.js';
import { validateMarketDataBundle } from '../market-data.js';
import { calculateMarketMetrics } from '../market-metrics.js';
import { POLICIES_V1 } from '../policies-v1.js';
import { replayExitPolicy } from '../replay-engine.js';
export function buildWorkbenchModel({ intraday, files, flatConfirmed, store }) {
  // Detached data only: frozen adapters never receive live canonical references.
  const input = captureResearchInput(intraday), records = input.records, entered = records.filter(r => r.enteredAt !== null);
  const reconstruction = reconstructLogicalTrades(files.fills || [], { assumeFlatAtStart: flatConfirmed === true });
  const logicalTrades = reconstruction.closedTrades;
  const result = buildResearchTrades(input.eligible, logicalTrades, { orders: files.orders || [], positionHistory: files.positions || [], allExecutionFills: files.fills || [], manualStore: store });
  const blocked = blockOverlappingResearch(buildResearchTrades(input.blocked, [], { manualStore: store }));
  result.matches.push(...blocked.matches); result.researchTrades.push(...blocked.researchTrades);
  const matches = new Map(result.matches.map(m => [m.opportunityId, m])), logicalMap = new Map(logicalTrades.map(t => [t.logicalTradeId, t]));
  const trades = result.researchTrades.map(t => {
    const matchingIds = matches.get(t.opportunityId)?.candidateLogicalTradeIds || [];
    const ids=matchingIds.length?matchingIds:t.logicalTradeId?[t.logicalTradeId]:[];
    const settings = store.settings.tradeOverrides[t.opportunityId] || { replayHardEndAt: null, executionTickSize: null };
    const risk = initialRisk(t), converted = t.manualEvents.some(e => e.type === 'BOF_TO_PB_RECORDED');
    return { ...t, hasConversion: converted, initialRiskPoints: risk.initialRiskPoints, realizedR: rAtPrice(t, t.actualExitPrice), settings: structuredClone(settings),
      candidates: ids.map(id => logicalMap.get(id)).filter(Boolean).map(c => ({ logicalTradeId: c.logicalTradeId, contract: c.contract, direction: c.direction, entryTime: c.entryStartedAt.normalized, exitTime: c.exitCompletedAt.normalized, entryPrice: c.entryVwap, exitPrice: c.exitVwap, quantity: c.quantity, sourceRows: [...c.sourceRows] })) };
  });
  const p = store.preferences;
  const visibleTrades = trades.filter(t => (p.setup === 'ALL' || (p.setup === 'BOF_TO_PB' ? t.hasConversion : t.researchSetupClass === p.setup)) && (p.family === 'ALL' || p.family === t.researchFamily) && (p.quality === 'ALL' || p.quality === t.qualityStatus));
  const selectedBase = visibleTrades.find(t => t.opportunityId === p.selectedOpportunityId) || visibleTrades[0] || null;
  let selected = null;
  if (selectedBase) {
    const t = selectedBase, end = t.settings.replayHardEndAt;
    const metrics = files.bundle ? calculateMarketMetrics(t, files.bundle, { executionTickSize: t.settings.executionTickSize }) : null;
    const hardEndValid = Number.isSafeInteger(end) && end > t.actualEntryTime && t.actualEntryTime !== null;
    const replayStatus = !hardEndValid ? 'REPLAY_HARD_END_REQUIRED' : !files.bundle ? 'WAITING_MARKET_DATA' : 'EXECUTED';
    const sources = t.researchSetupClass === 'BOF' ? ['MANUAL_ACTUAL','FIXED_INITIAL_SETUP'] : ['MANUAL_ACTUAL'];
    const policies = Object.values(POLICIES_V1).filter(policy => policy.setupClass === t.researchSetupClass);
    const replays = replayStatus === 'EXECUTED' ? policies.flatMap(policy => sources.map(setupStateSource => replayExitPolicy(t, files.bundle, { policyId: policy.policyId, setupStateSource, replayHardEndAt: end, executionTickSize: t.settings.executionTickSize }))) : [];
    selected = { ...t, metrics, marketStatus: metrics?.qualityStatus || 'WAITING_MARKET_DATA', replayStatus, replays };
  }
  return { captureVersion: intraday?.schemaVersion ?? 5, counts: { records: records.length, entered: entered.length, stops: entered.filter(r => effectiveInitialStop(r) !== null).length, fills: files.fills?.length || 0, orders: files.orders?.length || 0, positions: files.positions?.length || 0, closed: flatConfirmed ? logicalTrades.length : null, open: flatConfirmed ? reconstruction.openPositions.length : null },
    boundaryStatus: reconstruction.status || 'FLAT_CONFIRMED', flatConfirmed: flatConfirmed === true, logicalTrades, trades, visibleTrades, selected, preferences: structuredClone(p),
    bundle: files.bundle ? { source: files.bundle.source, sourceVersion: files.bundle.sourceVersion, validation: validateMarketDataBundle(files.bundle), series: files.bundle.series.map(s => ({ seriesId: s.seriesId, role: s.role, symbol: s.providerSymbol, timeframeMs: s.timeframeMs, coverageStart: s.coverageStart, coverageEnd: s.coverageEnd, sourceMode: s.priceSourceMode })) } : null };
}
