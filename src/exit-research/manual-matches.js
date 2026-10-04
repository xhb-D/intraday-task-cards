import { clone, epochMillis, indexById, fail, compareText } from './research-common.js';

export const createResearchStore = () => ({ schemaVersion: 1, sequence: 0, manualDecisions: [] });
export function executionFingerprint(trade) {
  // Canonical facts, not CSV display text, row order, source row number or import time.
  return JSON.stringify({
    logicalTradeId: trade.logicalTradeId, accountId: trade.accountId, product: trade.product, contract: trade.contract,
    direction: trade.direction, status: trade.status, quantity: trade.quantity, exitQuantity: trade.exitQuantity,
    remainingQuantity: trade.remainingQuantity, entryVwap: trade.entryVwap, exitVwap: trade.exitVwap,
    times: [trade.entryStartedAt, trade.entryCompletedAt, trade.exitStartedAt, trade.exitCompletedAt].map(time => time ? epochMillis(time) : null),
    entryFillIds: [...trade.entryFillIds], exitFillIds: [...trade.exitFillIds],
    entryOrderIds: [...trade.entryOrderIds].sort(compareText), exitOrderIds: [...trade.exitOrderIds].sort(compareText),
    flags: [...trade.qualityFlags].sort(compareText),
    fills: trade.fills.map(fill => ({ fillId: fill.fillId, orderId: fill.orderId, accountId: fill.accountId,
      contractId: fill.contractId, contract: fill.contract, product: fill.product, side: fill.side, quantity: fill.quantity,
      price: fill.price, active: fill.active, time: epochMillis(fill.time) })).sort((a, b) => compareText(a.fillId, b.fillId))
  });
}
export function assertResearchStore(store) {
  if (store?.schemaVersion !== 1 || !Number.isSafeInteger(store.sequence) || store.sequence < 0 || !Array.isArray(store.manualDecisions) || store.sequence !== store.manualDecisions.length) fail('INVALID_RESEARCH_STORE');
  indexById(store.manualDecisions, 'id');
  for (const [i, decision] of store.manualDecisions.entries()) {
    if (decision.id !== `manual-match:${i + 1}` || decision.sequence !== i + 1 ||
      !['MANUAL_CONFIRMED', 'MANUAL_REJECTED'].includes(decision.action) ||
      typeof decision.opportunityId !== 'string' || !decision.opportunityId.trim() ||
      typeof decision.logicalTradeId !== 'string' || !decision.logicalTradeId.trim() ||
      typeof decision.executionFingerprint !== 'string' || !decision.executionFingerprint ||
      !Number.isSafeInteger(decision.recordedAt) || decision.recordedAt < 0) fail('INVALID_MANUAL_DECISION');
  }
  return true;
}
function append(store, opportunityId, trade, recordedAt, action) {
  assertResearchStore(store);
  if (typeof opportunityId !== 'string' || !opportunityId.trim() || !Number.isSafeInteger(recordedAt) || recordedAt < 0) fail('INVALID_MANUAL_DECISION');
  const next = clone(store), sequence = next.sequence + 1;
  next.manualDecisions.push({ id: `manual-match:${sequence}`, sequence, action, opportunityId,
    logicalTradeId: trade.logicalTradeId, executionFingerprint: executionFingerprint(trade), recordedAt });
  next.sequence = sequence; assertResearchStore(next); return next;
}
export const applyManualMatch = (store, opportunityId, trade, recordedAt) => append(store, opportunityId, trade, recordedAt, 'MANUAL_CONFIRMED');
export const applyManualReject = (store, opportunityId, trade, recordedAt) => append(store, opportunityId, trade, recordedAt, 'MANUAL_REJECTED');
export function latestManualDecisions(store) {
  assertResearchStore(store);
  const pairs = new Map();
  for (const decision of store.manualDecisions) pairs.set(JSON.stringify([decision.opportunityId, decision.logicalTradeId]), decision);
  return [...pairs.values()];
}
