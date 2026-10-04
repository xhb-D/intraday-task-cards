import { uniqueSorted } from './research-common.js';
// One quality gate for validation, execution, and final replay results.
export function assessReplayQuality(trade, { reasons = [], blockingReasons = [], priceSourceMode = null, lookaheadQaStatus = 'FAIL' } = {}) {
  const blocked = [...blockingReasons], review = [...reasons];
  if (trade?.qualityStatus === 'BLOCKED') blocked.push('STEP3_BLOCKED', ...(trade.qualityReasons || []));
  else if (trade?.qualityStatus === 'REVIEW_REQUIRED') review.push('STEP3_REVIEW_REQUIRED', ...(trade.qualityReasons || []));
  else if (trade?.qualityStatus !== 'READY') blocked.push('STEP3_QUALITY_INVALID');
  if (priceSourceMode && priceSourceMode !== 'EXACT_EXECUTION_CONTRACT') review.push('PRICE_SOURCE_PROXY', ...(priceSourceMode === 'CONTINUOUS_CONTRACT_PROXY' ? ['CONTINUOUS_CONTRACT_PROXY'] : []));
  if (lookaheadQaStatus !== 'PASS') blocked.push('LOOKAHEAD_QA_NOT_PASSED');
  const qualityStatus = blocked.length ? 'BLOCKED' : review.length ? 'REVIEW_REQUIRED' : 'READY';
  return { qualityStatus, qualityReasons: uniqueSorted([...blocked, ...review]), statisticsEligible: qualityStatus === 'READY' && priceSourceMode === 'EXACT_EXECUTION_CONTRACT' };
}
