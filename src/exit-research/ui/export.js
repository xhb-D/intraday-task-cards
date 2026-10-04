import { planMarketDataRequests } from '../market-request.js';
import { planReplayMarketDataRequests } from '../replay-request.js';
export function buildMarketRequestExport(model) {
  const eligible = model.selected ? [model.selected] : model.trades;
  return { schemaVersion: 1, purpose: 'EXIT_RESEARCH_MARKET_REQUEST', windowStartAssumption: model.flatConfirmed ? 'FLAT_CONFIRMED_BY_USER' : 'WINDOW_START_FLAT_UNCONFIRMED',
    trades: eligible.filter(t => t.logicalTradeId !== null).map(t => {
      const configured = Number.isSafeInteger(t.settings.replayHardEndAt) && t.settings.replayHardEndAt > t.actualEntryTime;
      return { researchTradeId: t.researchTradeId, executionProduct: t.executionProduct, executionContract: t.executionContract,
        actualEntry: t.actualEntryTime, actualExit: t.actualExitTime, replayHardEnd: { status: configured ? 'configured' : 'pending', at: configured ? t.settings.replayHardEndAt : null },
        actual: planMarketDataRequests(t), replay: configured ? planReplayMarketDataRequests(t, { replayHardEndAt: t.settings.replayHardEndAt }) : { status: 'pending', qualityReasons: ['REPLAY_HARD_END_REQUIRED'], requests: [] },
        detail: { mode: 'ON_DEMAND', role: 'EXECUTION_DETAIL', requestedWhen: ['ENTRY_EXIT_BOUNDARY_AMBIGUOUS','REPLAY_BOUNDARY_AMBIGUOUS'], executionProduct: t.executionProduct, executionContract: t.executionContract, requiredStartAt: t.actualEntryTime, requiredEndAt: configured ? t.settings.replayHardEndAt : t.actualExitTime, timestampSemantics: 'BAR_OPEN_TIME' } };
    }) };
}
export function downloadResearchJson(value, name, environment = globalThis) {
  const blob = new environment.Blob([JSON.stringify(value, null, 2)], {type:'application/json;charset=utf-8'}), url = environment.URL.createObjectURL(blob);
  const a = environment.document.createElement('a'); a.href = url; a.download = name; a.click(); environment.setTimeout(() => environment.URL.revokeObjectURL(url), 1000);
}
