import { researchFamilyForProduct } from './symbol-map.js';
import { assessExecutionQa } from './execution-qa.js';
import { createResearchStore, latestManualDecisions, executionFingerprint } from './manual-matches.js';
import { clone, epochMillis, assertOpportunityRecord, indexById, executionFlagSeverities, uniqueSorted, compareText, fail } from './research-common.js';

export const DEFAULT_MATCHING_CONFIG = Object.freeze({ strongEntryWindowMs: 120000, reviewEntryWindowMs: 600000,
  strongExitWindowMs: 120000, reviewExitWindowMs: 600000, maxComponentSize: 8, maxAssignmentSteps: 200000 });
function configFor(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !Object.hasOwn(DEFAULT_MATCHING_CONFIG, key))) fail('INVALID_MATCHING_CONFIG');
  const config = { ...DEFAULT_MATCHING_CONFIG, ...overrides };
  if (Object.values(config).some(value => !Number.isSafeInteger(value) || value < 0) ||
    config.strongEntryWindowMs > config.reviewEntryWindowMs || config.strongExitWindowMs > config.reviewExitWindowMs ||
    !config.maxComponentSize || !config.maxAssignmentSteps) fail('INVALID_MATCHING_CONFIG');
  return config;
}
function describe(record, trade, qa, config) {
  if (researchFamilyForProduct(trade.product) !== record.symbol || trade.direction !== record.direction.toUpperCase() || trade.status !== 'closed') return null;
  let times;
  try { times = [trade.entryStartedAt, trade.entryCompletedAt, trade.exitStartedAt, trade.exitCompletedAt].map(epochMillis); }
  catch (error) { return { logicalTradeId: trade.logicalTradeId, conflict: error.code }; }
  if (times.some(time => !Number.isSafeInteger(time)) || times[0] > times[1] || times[1] > times[2] || times[2] > times[3]) return { logicalTradeId: trade.logicalTradeId, conflict: 'EXECUTION_TIMELINE_CONFLICT' };
  const entryDeltaMs = Math.abs(record.enteredAt - times[0]);
  const exitDeltaMs = record.endedAt === null ? null : Math.abs(record.endedAt - times[3]);
  if (!Number.isSafeInteger(entryDeltaMs) || (exitDeltaMs !== null && !Number.isSafeInteger(exitDeltaMs))) return { logicalTradeId: trade.logicalTradeId, conflict: 'TIME_DELTA_OUT_OF_RANGE' };
  const flags = executionFlagSeverities(trade, qa);
  return { logicalTradeId: trade.logicalTradeId, entryDeltaMs, exitDeltaMs,
    entryStrong: entryDeltaMs <= config.strongEntryWindowMs, entryOutsideReview: entryDeltaMs > config.reviewEntryWindowMs,
    exitStrong: exitDeltaMs !== null && exitDeltaMs <= config.strongExitWindowMs,
    flags, conflict: flags.some(f => f.severity === 'blocking') ? 'BLOCKING_EXECUTION_FLAG' :
      [qa.orders.status, qa.positionHistory.status].includes('CONFLICT') ? 'EXECUTION_QA_CONFLICT' :
        exitDeltaMs !== null && exitDeltaMs > config.reviewExitWindowMs ? 'EXIT_TIME_CONFLICT' : null };
}
function resultFor(record, candidate, qa, manual = false) {
  const reasons = ['FAMILY_DIRECTION_MATCH', candidate.entryStrong ? 'ENTRY_STRONG' : candidate.entryOutsideReview ? 'MANUAL_ENTRY_OUTSIDE_WINDOW' : 'ENTRY_REVIEW_WINDOW',
    candidate.exitDeltaMs === null ? 'TASK_EXIT_MISSING' : candidate.exitStrong ? 'EXIT_STRONG' : 'EXIT_REVIEW_WINDOW',
    manual ? 'MANUAL_CONFIRMED' : 'UNIQUE_ONE_TO_ONE'];
  if (candidate.flags.some(f => f.severity === 'review-required')) reasons.push('EXECUTION_QUALITY_FLAG');
  if ([qa.orders.status, qa.positionHistory.status].some(status => status !== 'PASS')) reasons.push('EXECUTION_QA_REVIEW');
  const strong = candidate.entryStrong && candidate.exitStrong && !reasons.includes('EXECUTION_QUALITY_FLAG') && !reasons.includes('EXECUTION_QA_REVIEW');
  return { opportunityId: record.id, logicalTradeId: candidate.logicalTradeId, matchingStatus: strong ? 'MATCHED' : 'REVIEW_REQUIRED',
    matchingReasons: reasons, entryDeltaMs: candidate.entryDeltaMs, exitDeltaMs: candidate.exitDeltaMs };
}
const emptyResult = (id, status, reasons, candidates = []) => ({ opportunityId: id, logicalTradeId: null,
  matchingStatus: status, matchingReasons: uniqueSorted(reasons), entryDeltaMs: null, exitDeltaMs: null, candidateLogicalTradeIds: uniqueSorted(candidates) });

// Enumerate a whole connected bipartite component. Preserve all equally optimal
// assignments, including unassigned slots; lexical IDs NEVER resolve ambiguity.
function assignComponent(opIds, edges, config) {
  const tradeIds = uniqueSorted(opIds.flatMap(id => edges.get(id).map(edge => edge.logicalTradeId)));
  if (Math.max(opIds.length, tradeIds.length) > config.maxComponentSize) return null;
  let steps = 0, exhausted = false, best = null, choices = new Map();
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; };
  function visit(i, used, selected, score) {
    if (++steps > config.maxAssignmentSteps) { exhausted = true; return; }
    if (i === opIds.length) {
      const relation = best === null ? 1 : cmp(score, best);
      if (relation < 0) return;
      if (relation > 0) { best = score; choices = new Map(opIds.map(id => [id, new Set()])); }
      opIds.forEach((id, index) => choices.get(id).add(selected[index]?.logicalTradeId ?? null));
      return;
    }
    visit(i + 1, used, [...selected, null], score);
    for (const edge of edges.get(opIds[i])) {
      if (exhausted) return;
      if (used.has(edge.logicalTradeId)) continue;
      const next = new Set(used); next.add(edge.logicalTradeId);
      visit(i + 1, next, [...selected, edge], [score[0] + 1, score[1] + Number(edge.entryStrong && edge.exitStrong),
        score[2] + Number(edge.exitStrong), score[3] + Number(edge.entryStrong),
        score[4] - BigInt(edge.entryDeltaMs), score[5] - BigInt(edge.exitDeltaMs ?? config.reviewExitWindowMs)]);
    }
  }
  visit(0, new Set(), [], [0, 0, 0, 0, 0n, 0n]);
  return exhausted ? null : choices;
}
export function reconcileOpportunities(records, trades, { orders = [], positionHistory = [], allExecutionFills = null,
  manualStore = createResearchStore(), config: overrides = {} } = {}) {
  const config = configFor(overrides), recordMap = indexById(records, 'id'), tradeMap = indexById(trades, 'logicalTradeId');
  const executionQa = assessExecutionQa(trades, orders, positionHistory, { fills: allExecutionFills });
  const results = new Map(), descriptions = new Map(), edges = new Map();
  for (const [id, record] of recordMap) {
    try { assertOpportunityRecord(record); }
    catch (error) { results.set(id, emptyResult(id, 'DATA_CONFLICT', [error.code])); continue; }
    if (record.enteredAt === null) { results.set(id, emptyResult(id, 'NO_MATCH', ['TASK_ENTRY_MISSING'])); continue; }
    const described = [...tradeMap.values()].map(trade => describe(record, trade, executionQa[trade.logicalTradeId], config)).filter(Boolean);
    descriptions.set(id, described);
    edges.set(id, described.filter(edge => !edge.conflict && edge.entryDeltaMs <= config.reviewEntryWindowMs).sort((a, b) => compareText(a.logicalTradeId, b.logicalTradeId)));
  }
  const latestPairs = latestManualDecisions(manualStore), activeConfirmations = new Map(), lastConfirmed = new Map();
  for (const d of manualStore.manualDecisions) if (d.action === 'MANUAL_CONFIRMED') lastConfirmed.set(d.opportunityId, d);
  // Rejecting the newest mapping must not resurrect a superseded confirmation.
  for (const d of latestPairs) if (d.action === 'MANUAL_CONFIRMED' && lastConfirmed.get(d.opportunityId) === d) activeConfirmations.set(d.opportunityId, d);
  // A new explicit confirmation for an opportunity supersedes its previous mapping;
  // pair rejections remain useful, while the full append-only history is retained.
  const decisions = latestPairs.filter(d => d.action === 'MANUAL_REJECTED' || activeConfirmations.get(d.opportunityId) === d);
  const locked = new Map(), claimed = new Map();
  for (const decision of decisions) {
    const id = decision.opportunityId;
    if (!recordMap.has(id) || results.has(id)) continue;
    const trade = tradeMap.get(decision.logicalTradeId);
    let unchanged = false;
    try { unchanged = Boolean(trade) && executionFingerprint(trade) === decision.executionFingerprint; } catch { /* Fail closed below. */ }
    if (!unchanged) {
      if (decision.action === 'MANUAL_REJECTED' && (activeConfirmations.get(id)?.sequence ?? 0) > decision.sequence) continue;
      results.set(id, emptyResult(id, 'REVIEW_REQUIRED', ['MANUAL_MATCH_SOURCE_CHANGED'], [decision.logicalTradeId])); continue;
    }
    if (decision.action === 'MANUAL_REJECTED') {
      edges.set(id, edges.get(id).filter(edge => edge.logicalTradeId !== decision.logicalTradeId));
      descriptions.set(id, descriptions.get(id).filter(edge => edge.logicalTradeId !== decision.logicalTradeId)); continue;
    }
    const edge = descriptions.get(id).find(edge => edge.logicalTradeId === decision.logicalTradeId);
    if (!edge || edge.conflict) { results.set(id, emptyResult(id, 'DATA_CONFLICT', ['MANUAL_HARD_FILTER_CONFLICT', edge?.conflict ?? 'FAMILY_DIRECTION_STATUS_CONFLICT'])); continue; }
    if (locked.has(id) && locked.get(id).logicalTradeId !== edge.logicalTradeId) results.set(id, emptyResult(id, 'DATA_CONFLICT', ['MANUAL_ASSIGNMENT_CONFLICT']));
    locked.set(id, edge);
    if (!claimed.has(edge.logicalTradeId)) claimed.set(edge.logicalTradeId, []);
    claimed.get(edge.logicalTradeId).push(id);
  }
  for (const ids of claimed.values()) if (ids.length > 1) ids.forEach(id => results.set(id, emptyResult(id, 'DATA_CONFLICT', ['MANUAL_ASSIGNMENT_CONFLICT'])));
  for (const [id, edge] of locked) if (!results.has(id)) results.set(id, resultFor(recordMap.get(id), edge, executionQa[edge.logicalTradeId], true));
  const reserved = new Set([...locked.values()].map(edge => edge.logicalTradeId));
  for (const [id, values] of edges) edges.set(id, values.filter(edge => !reserved.has(edge.logicalTradeId)));
  const pending = uniqueSorted([...edges.keys()].filter(id => !results.has(id)));
  const seen = new Set();
  for (const start of pending) {
    if (seen.has(start)) continue;
    const component = [start], tradeIds = new Set(); seen.add(start);
    for (let i = 0; i < component.length; i++) {
      edges.get(component[i]).forEach(edge => tradeIds.add(edge.logicalTradeId));
      for (const id of pending) if (!seen.has(id) && edges.get(id).some(edge => tradeIds.has(edge.logicalTradeId))) { seen.add(id); component.push(id); }
    }
    component.sort(compareText);
    const assigned = assignComponent(component, edges, config);
    for (const id of component) {
      const ids = assigned?.get(id);
      if (!assigned || ids.size > 1) results.set(id, emptyResult(id, 'MATCH_AMBIGUOUS', [assigned ? 'EQUAL_GLOBAL_ASSIGNMENTS' : 'ASSIGNMENT_LIMIT_REVIEW_REQUIRED'], edges.get(id).map(edge => edge.logicalTradeId)));
      else if (!ids.has(null)) {
        const edge = edges.get(id).find(edge => edge.logicalTradeId === [...ids][0]);
        results.set(id, resultFor(recordMap.get(id), edge, executionQa[edge.logicalTradeId]));
      } else {
        const conflicts = descriptions.get(id).filter(edge => edge.conflict && (edge.entryDeltaMs === undefined || edge.entryDeltaMs <= config.reviewEntryWindowMs));
        const rejected = decisions.some(d => d.opportunityId === id && d.action === 'MANUAL_REJECTED');
        results.set(id, emptyResult(id, conflicts.length ? 'DATA_CONFLICT' : 'NO_MATCH', conflicts.length ? conflicts.flatMap(edge => [edge.conflict, ...(edge.flags || []).filter(f => f.severity === 'blocking').map(f => f.code)]) :
          [edges.get(id).length ? 'ONE_TO_ONE_UNASSIGNED' : rejected ? 'MANUAL_REJECTED' : 'NO_ELIGIBLE_CANDIDATE'], conflicts.map(edge => edge.logicalTradeId)));
      }
    }
  }
  return { config: clone(config), matches: uniqueSorted([...recordMap.keys()]).map(id => results.get(id)), executionQa };
}
