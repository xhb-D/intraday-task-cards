import { planMarketDataRequests } from './market-request.js';
export function planReplayMarketDataRequests(trade, { replayHardEndAt } = {}) {
  if (!Number.isSafeInteger(replayHardEndAt) || replayHardEndAt <= trade?.actualEntryTime) return {
    schemaVersion: 1, purpose: 'POLICY_REPLAY', researchTradeId: trade?.researchTradeId ?? null, status: 'BLOCKED', qualityReasons: ['REPLAY_HARD_END_INVALID'], requests: [] };
  // Temporary request adapter only. Does not change Actual Holding truth or its request API.
  const plan = planMarketDataRequests({ ...trade, actualExitTime: replayHardEndAt });
  return { ...plan, purpose: 'POLICY_REPLAY', replayHardEndAt, requests: plan.requests.filter(r => r.role === 'EXECUTION_PRIMARY') };
}
