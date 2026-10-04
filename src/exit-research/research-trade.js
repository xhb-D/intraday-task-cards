import { effectiveInitialStop, researchSetupClass } from '../model.js';
import { executionProductForFamily } from './symbol-map.js';
import { reconcileOpportunities } from './reconciliation.js';
import { clone, epochMillis, executionFlagSeverities, uniqueSorted } from './research-common.js';

export function assessResearchQuality({ match, initialStop, direction, actualEntryPrice, executionQa, executionFlags = [] }) {
  const blocked = [], review = [];
  if (['MATCH_AMBIGUOUS', 'NO_MATCH', 'DATA_CONFLICT'].includes(match.matchingStatus)) blocked.push(match.matchingStatus, ...match.matchingReasons);
  if (match.matchingReasons.includes('MANUAL_MATCH_SOURCE_CHANGED')) blocked.push('MANUAL_MATCH_SOURCE_CHANGED');
  if (initialStop === null) blocked.push('INITIAL_STOP_MISSING');
  else if (!Number.isFinite(initialStop) || initialStop <= 0 || (actualEntryPrice !== null &&
    (direction === 'LONG' ? initialStop >= actualEntryPrice : initialStop <= actualEntryPrice))) blocked.push('INITIAL_STOP_INVALID');
  if (match.matchingStatus === 'REVIEW_REQUIRED') review.push(...match.matchingReasons);
  for (const section of Object.values(executionQa || {})) {
    if (section.status === 'CONFLICT') blocked.push('EXECUTION_QA_CONFLICT', ...section.flags.filter(f => f.severity === 'blocking').map(f => f.code));
    else if (section.status !== 'PASS') review.push('EXECUTION_QA_REVIEW', ...section.flags.filter(f => f.severity === 'review-required').map(f => f.code));
  }
  for (const f of executionFlags) (f.severity === 'blocking' ? blocked : f.severity === 'review-required' ? review : []).push(f.code);
  return { status: blocked.length ? 'BLOCKED' : review.length ? 'REVIEW_REQUIRED' : 'READY', reasons: uniqueSorted([...blocked, ...review]) };
}
export function buildResearchTrades(records, trades, options = {}) {
  const reconciliation = reconcileOpportunities(records, trades, options);
  const recordMap = new Map(records.map(record => [record.id, record])), tradeMap = new Map(trades.map(trade => [trade.logicalTradeId, trade]));
  const researchTrades = reconciliation.matches.map(match => {
    const record = recordMap.get(match.opportunityId), trade = tradeMap.get(match.logicalTradeId) ?? null;
    const manualEvents = clone(record.researchCapture?.manualEvents || []), initialStop = effectiveInitialStop(record);
    const executionQa = trade ? clone(reconciliation.executionQa[trade.logicalTradeId]) : null;
    const executionFlags = trade ? executionFlagSeverities(trade, executionQa) : [];
    const direction = record.direction?.toUpperCase() ?? null, actualEntryPrice = trade?.entryVwap ?? null;
    const quality = assessResearchQuality({ match, initialStop, direction, actualEntryPrice, executionQa, executionFlags });
    return { researchTradeId: 'rt:' + encodeURIComponent(JSON.stringify([record.id, match.logicalTradeId])),
      opportunityId: record.id, logicalTradeId: match.logicalTradeId, researchFamily: record.symbol,
      contextSymbol: record.contextSymbol ?? null, executionProduct: trade?.product ?? executionProductForFamily(record.symbol), executionContract: trade?.contract ?? null,
      direction, originalSetup: record.type, researchSetupClass: researchSetupClass(record.type), manualEvents,
      manualSetupTransitions: manualEvents.filter(event => ['BOF_TO_PB_RECORDED', 'BOF_TO_PB_REVERTED'].includes(event.type)),
      registeredAt: record.registeredAt, taskEntryConfirmedAt: record.enteredAt, taskExitConfirmedAt: record.endedAt,
      actualEntryTime: trade ? epochMillis(trade.entryStartedAt) : null, actualEntryCompletedTime: trade ? epochMillis(trade.entryCompletedAt) : null,
      actualEntryPrice, initialStop, actualExitStartedTime: trade ? epochMillis(trade.exitStartedAt) : null,
      actualExitTime: trade ? epochMillis(trade.exitCompletedAt) : null, actualExitPrice: trade?.exitVwap ?? null, quantity: trade?.quantity ?? null,
      matchingStatus: match.matchingStatus, matchingReasons: clone(match.matchingReasons), entryDeltaMs: match.entryDeltaMs, exitDeltaMs: match.exitDeltaMs,
      executionQa, executionFlags, qualityStatus: quality.status, qualityReasons: quality.reasons };
  });
  return { ...reconciliation, researchTrades };
}
