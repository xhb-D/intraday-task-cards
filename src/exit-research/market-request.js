import { resolveContextMarket, MARKET_TIMEFRAMES, PRICE_SOURCE_MODES } from './market-config.js';
import { executionProductForFamily } from './symbol-map.js';
const validTime = value => Number.isSafeInteger(value) && value >= 0;
export function planMarketDataRequests(trade, { contextDefaults } = {}) {
  if (!trade || typeof trade.researchTradeId !== 'string' || !trade.researchTradeId ||
    executionProductForFamily(trade.researchFamily) === null || trade.executionProduct !== executionProductForFamily(trade.researchFamily) || typeof trade.executionContract !== 'string' || !trade.executionContract ||
    !validTime(trade.actualEntryTime) || !validTime(trade.actualExitTime) || trade.actualExitTime < trade.actualEntryTime) {
    return { schemaVersion: 1, researchTradeId: trade?.researchTradeId ?? null, status: 'BLOCKED', qualityReasons: ['RESEARCH_EXECUTION_WINDOW_INVALID'], requests: [] };
  }
  const context = resolveContextMarket(trade, contextDefaults);
  const requestedWindow = { requiredStartAt: trade.actualEntryTime, requiredEndAt: trade.actualExitTime, includeOverlappingBars: true, timestampSemantics: 'BAR_OPEN_TIME' };
  return { schemaVersion: 1, researchTradeId: trade.researchTradeId, status: trade.qualityStatus === 'BLOCKED' ? 'BLOCKED' : 'PLANNED',
    qualityReasons: trade.qualityStatus === 'BLOCKED' ? ['STEP3_BLOCKED'] : [], detailMode: 'ON_DEMAND', requests: [
      { role: 'EXECUTION_PRIMARY', researchFamily: trade.researchFamily, desiredProduct: trade.executionProduct, desiredContract: trade.executionContract,
        providerSymbol: null, priceSourcePriority: [...PRICE_SOURCE_MODES], timeframeMs: MARKET_TIMEFRAMES.PRIMARY, ...requestedWindow },
      { role: 'CONTEXT', researchFamily: trade.researchFamily, ...context, providerSymbol: null, timeframeMs: MARKET_TIMEFRAMES.CONTEXT, ...requestedWindow }
    ] };
}
