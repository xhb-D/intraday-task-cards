import { assertState as assertV5CaptureState } from '../../model.js';
import { intradayV6 } from '../../intraday-v6/index.js';
// Read-only V6 compatibility boundary. Old flat-to-flat execution engines cannot
// attribute overlapping independent capture trades. Never feed those to matching.
export function captureResearchInput(intraday) {
  if (intraday?.schemaVersion === 6) intradayV6.assertV6State(intraday);
  else if (intraday?.schemaVersion === 5) assertV5CaptureState(intraday);
  const records = structuredClone(intraday?.records || []), blockedIds = new Set();
  if (intraday?.schemaVersion === 6) {
    const entered = records.filter(record => record.enteredAt !== null);
    for (let i = 0; i < entered.length; i++) for (let j = i + 1; j < entered.length; j++) {
      const a = entered[i], b = entered[j];
      if (a.symbol === b.symbol && Math.max(a.enteredAt,b.enteredAt) < Math.min(a.endedAt ?? Infinity,b.endedAt ?? Infinity)) { blockedIds.add(a.id); blockedIds.add(b.id); }
    }
  }
  return { records, eligible: records.filter(record => record.enteredAt !== null && !blockedIds.has(record.id)), blocked: records.filter(record => blockedIds.has(record.id)) };
}

export function blockOverlappingResearch(result) {
  const reason = 'V6_OVERLAP_EXECUTION_UNSUPPORTED';
  for (const match of result.matches) Object.assign(match, { matchingStatus:'NO_MATCH', logicalTradeId:null, candidateLogicalTradeIds:[], matchingReasons:[reason] });
  for (const trade of result.researchTrades) Object.assign(trade, { matchingStatus:'NO_MATCH', logicalTradeId:null, matchingReasons:[reason], qualityStatus:'BLOCKED', qualityReasons:[reason] });
  return result;
}

export const setupClassificationPending = type => ['spb', 'cpb', 'bof'].includes(type);
export function replayCompatibleInput(trade) {
  const copy = structuredClone(trade);
  copy.manualEvents = copy.manualEvents.filter(e => !['ENTRY_EXPECTATION_RECORDED','ENTRY_EXPECTATION_CORRECTED','HOLDING_EXPECTATION_UPDATED'].includes(e.type));
  return copy;
}
export function weeklyDecisionReview(intraday) {
  return (intraday?.records || []).map(record => intradayV6.manualDecisionReview(record));
}
export function decisionReviewCsv(intraday) {
  const fields = ['record_id','setup','research_classification','html_entry_confirmed_at','html_exit_confirmed_at','entry_expectation_versions','holding_expectations','all_manual_events','time_basis'];
  const cell = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const rows = weeklyDecisionReview(intraday).map(r => [r.recordId,r.setup,setupClassificationPending(r.setup)?'PENDING_HUMAN_REVIEW':'EXISTING_CLASSIFICATION',r.htmlEnteredAt,r.htmlExitedAt,JSON.stringify(r.entryExpectation?.versions || []),JSON.stringify(r.holdingExpectations),JSON.stringify(r.manualEvents),r.timeBasis]);
  return [fields, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

// Matching consumes lifecycle/stop facts in a detached legacy validation view.
// A Setup sentinel is never a strategy classification and never leaves this boundary.
export function legacyMatchingRecords(records) {
  return records.map(record => intradayV6.singleRecordV5View(record).records[0]);
}
