import { initialRisk, rAtPrice } from './r-math.js';
import { researchSetupClass } from '../model.js';
import { clone, uniqueSorted } from './research-common.js';
import { POLICIES_V1 } from './policies-v1.js';
import { validateExitPolicy, stageAtMfe, SETUP_STATE_SOURCES, EXECUTION_MODEL_VERSION } from './policy-schema.js';
import { calculateProtectionR, protectionAtR } from './protection.js';
import { stopFill, stopMayBeTouched, SLIPPAGE_MODEL_VERSION } from './execution-model.js';
import { prepareReplayData } from './replay-data.js';
import { appendReplayTrace } from './replay-trace.js';
import { assessReplayQuality } from './replay-quality.js';
import { auditReplayLookahead } from './lookahead-qa.js';
export const REPLAY_ENGINE_VERSION = 'CONDITIONED_ENTRY_5M_V1';
const P = 300000, validTime = t => Number.isSafeInteger(t) && t >= 0;
function manualTransitions(trade, anchor) {
  const events = trade.manualEvents;
  if (!Array.isArray(events)) return { valid: false };
  const transitions = [], ids = new Set(); let previous = -1, active = null;
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || ids.has(e.id) || !validTime(e.recordedAt) || e.recordedAt < previous ||
        !validTime(e.effectiveAt) || e.effectiveAt > e.recordedAt || e.source !== 'manual_intraday' ||
        !['INITIAL_STOP_RECORDED', 'INITIAL_STOP_LATE_RECORDED', 'INITIAL_STOP_CORRECTED', 'BOF_TO_PB_RECORDED', 'BOF_TO_PB_REVERTED'].includes(e.type)) return { valid: false };
    ids.add(e.id); previous = e.recordedAt;
    if (!e.type.startsWith('BOF_TO_PB_')) continue;
    if (researchSetupClass(trade.originalSetup) !== 'BOF' || e.effectiveAt !== e.recordedAt || !e.payload) return { valid: false };
    if (e.type === 'BOF_TO_PB_RECORDED') {
      if (active || e.payload.from !== 'BOF' || e.payload.to !== 'PB') return { valid: false };
      active = e.id;
    } else {
      if (!active || e.payload.from !== 'PB' || e.payload.to !== 'BOF' || e.payload.revertedEventId !== active) return { valid: false };
      active = null;
    }
    const effectiveAt = anchor + (Math.floor((e.recordedAt - anchor) / P) + 1) * P;
    if (!validTime(effectiveAt)) return { valid: false };
    transitions.push({ event: clone(e), effectiveAt, setup: e.type === 'BOF_TO_PB_RECORDED' ? 'PB' : 'BOF', traceCause: null });
  }
  if (trade.manualSetupTransitions !== undefined && JSON.stringify(trade.manualSetupTransitions) !== JSON.stringify(transitions.map(t => t.event))) return { valid: false };
  return { valid: true, transitions };
}
export function replayExitPolicy(trade, bundle, options = {}) {
  options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const { policyId, policies = POLICIES_V1, setupStateSource = 'MANUAL_ACTUAL', replayHardEndAt, executionTickSize = null, hardEndMark = null } = options;
  const trace = [], auditBars = [], reasons = [], blockedReasons = [];
  const result = { schemaVersion: 1, researchTradeId: trade?.researchTradeId ?? null, policyId: policyId ?? null, policyVersion: 1,
    replayEngineVersion: REPLAY_ENGINE_VERSION, executionModelVersion: EXECUTION_MODEL_VERSION, slippageModelVersion: SLIPPAGE_MODEL_VERSION,
    setupStateSource, priceSourceMode: null, marketDataFingerprint: null, bundleFingerprint: null, provenance: null, policyDefinitions: null,
    replayStartAt: trade?.actualEntryTime ?? null, replayHardEndAt: replayHardEndAt ?? null,
    initialRiskPoints: null, executionTickSize, hardEndMark: clone(hardEndMark), simulatedExitTime: null, simulatedExitTimeRange: null, simulatedExitPrice: null, simulatedExitR: null, exitReason: null,
    maxKnownMfeR: 0, finalActiveProtectionR: -1, finalActiveProtectionPrice: trade?.initialStop ?? null, finalRoundedProtectionR: -1,
    finalPolicyId: policyId ?? null, finalStage: null, lookaheadQaStatus: 'FAIL', lookaheadQaReasons: ['RUN_NOT_EXECUTED'],
    qualityStatus: 'BLOCKED', qualityReasons: [], statisticsEligible: false, trace, auditBars };
  const emit = (type, at, data, cause) => appendReplayTrace(trace, type, at, data, cause);
  const block = (codes, at = result.replayStartAt) => {
    blockedReasons.push(...codes);
    emit('REPLAY_BLOCKED', validTime(at) ? at : 0, { reasons: uniqueSorted(codes) });
    // Partial state is inspectable, but never retain an apparently valid simulated exit.
    result.simulatedExitTime = result.simulatedExitTimeRange = result.simulatedExitPrice = result.simulatedExitR = result.exitReason = null;
    Object.assign(result, assessReplayQuality(trade, { blockingReasons: blockedReasons, reasons, lookaheadQaStatus: result.lookaheadQaStatus })); return result;
  };
  if (!trade || typeof options !== 'object' || !validTime(trade.actualEntryTime) || !validTime(replayHardEndAt) || replayHardEndAt <= trade.actualEntryTime) return block(['REPLAY_HARD_END_INVALID']);
  if (trade.qualityStatus === 'BLOCKED') return block(['STEP3_BLOCKED', ...(trade.qualityReasons || [])]);
  if (!['READY', 'REVIEW_REQUIRED'].includes(trade.qualityStatus)) return block(['STEP3_QUALITY_INVALID']);
  if (trade.qualityStatus === 'REVIEW_REQUIRED') reasons.push('STEP3_REVIEW_REQUIRED', ...(trade.qualityReasons || []));
  if (!SETUP_STATE_SOURCES.includes(setupStateSource)) return block(['SETUP_STATE_SOURCE_INVALID']);
  if (setupStateSource === 'RESEARCH_TRANSITION_RULE') return block(['RESEARCH_TRANSITION_RULE_NOT_CONFIGURED']);
  const risk = initialRisk(trade, { tickSize: executionTickSize });
  if (!risk.valid) return block(risk.qualityReasons);
  result.initialRiskPoints = risk.initialRiskPoints;
  let policy = policies?.[policyId];
  const validation = validateExitPolicy(policy);
  if (!validation.valid) return block(validation.qualityReasons);
  if (policy.policyId !== policyId || policy.setupClass !== researchSetupClass(trade.originalSetup) || trade.researchSetupClass !== policy.setupClass) return block(['POLICY_INITIAL_SETUP_MISMATCH']);
  const paired = policies[policy.pairedPolicyId];
  const pairCheck = validateExitPolicy(paired);
  if (!pairCheck.valid || paired.setupClass === policy.setupClass || paired.pairedPolicyId !== policyId || paired.policyId !== policy.pairedPolicyId) return block(['PAIRED_POLICY_INVALID']);
  const policyMap = { [policy.setupClass]: policy, [paired.setupClass]: paired };
  result.policyDefinitions = clone(policyMap);
  const data = prepareReplayData(trade, bundle, options);
  if (!data.valid) return block(data.qualityReasons);
  Object.assign(result, { priceSourceMode: data.primary.priceSourceMode, marketDataFingerprint: data.fingerprint, bundleFingerprint: data.bundleFingerprint, provenance: clone(data.provenance) });
  if (data.primary.priceSourceMode !== 'EXACT_EXECUTION_CONTRACT') reasons.push('PRICE_SOURCE_PROXY', ...(data.primary.priceSourceMode === 'CONTINUOUS_CONTRACT_PROXY' ? ['CONTINUOUS_CONTRACT_PROXY'] : []));
  const initialProtection = protectionAtR(trade, -1, executionTickSize);
  if (!initialProtection.valid) return block(initialProtection.qualityReasons);
  if (executionTickSize !== null && Math.abs(initialProtection.price - trade.initialStop) > 8 * Number.EPSILON * trade.initialStop) return block(['INITIAL_STOP_OFF_EXECUTION_TICK']);
  reasons.push(...initialProtection.qualityReasons);
  const manual = manualTransitions(trade, data.primary.bars[0].openTime);
  if (!manual.valid) return block(['MANUAL_SETUP_EVENTS_INVALID']);
  if (hardEndMark !== null && (!hardEndMark || Object.keys(hardEndMark).sort().join(',') !== 'at,price,seriesId,source' || hardEndMark.at !== replayHardEndAt ||
      !Number.isFinite(hardEndMark.price) || hardEndMark.price <= 0 || hardEndMark.seriesId !== data.primary.seriesId || typeof hardEndMark.source !== 'string' || !hardEndMark.source.trim())) return block(['HARD_END_MARK_INVALID']);
  let knownMfeR = 0, protection = { ...initialProtection, price: trade.initialStop, roundedR: -1 }, stage = stageAtMfe(policy, 0);
  let pending = null, manualRecorded = 0, manualApplied = 0, switchedCause = null, coveredUntil = trade.actualEntryTime;
  const entryCause = emit('ENTRY', trade.actualEntryTime, { entryPrice: trade.actualEntryPrice, direction: trade.direction, setupStateSource, policyId, initialRiskPoints: risk.initialRiskPoints });
  emit('INITIAL_STOP_ACTIVE', trade.actualEntryTime, { protectionR: -1, protectionPrice: protection.price, stage: stage.name, policyId }, entryCause);
  function recordManualUntil(at) {
    while (manualRecorded < manual.transitions.length && manual.transitions[manualRecorded].event.recordedAt <= at) {
      const item = manual.transitions[manualRecorded++];
      item.traceCause = emit(item.setup === 'PB' ? 'BOF_TO_PB_MANUAL_RECORDED' : 'BOF_TO_PB_MANUAL_REVERTED', at, {
        eventId: item.event.id, manualTransitionAt: item.event.recordedAt, policyTransitionEffectiveAt: item.effectiveAt, setupStateSource, ignoredForPolicy: setupStateSource === 'FIXED_INITIAL_SETUP' });
    }
  }
  function policyAt(at) {
    let selected = policy; switchedCause = null;
    while (manualApplied < manual.transitions.length && manual.transitions[manualApplied].effectiveAt <= at) {
      const item = manual.transitions[manualApplied++];
      if (setupStateSource === 'MANUAL_ACTUAL') { selected = policyMap[item.setup]; switchedCause = item.traceCause; }
    }
    return selected;
  }
  recordManualUntil(trade.actualEntryTime);
  const entryPolicy = policyAt(trade.actualEntryTime);
  if (entryPolicy !== policy) {
    policy = entryPolicy; stage = stageAtMfe(policy, knownMfeR);
    emit('POLICY_SWITCH_EFFECTIVE', trade.actualEntryTime, { policyId: policy.policyId, knownMfeR, inheritedProtectionR: protection.protectionR }, switchedCause);
  }
  function exit(fill, type, at, cause = null) {
    const exitR = rAtPrice(trade, fill.price);
    if (exitR === null) return block(['R_NUMERIC_OVERFLOW'], at);
    emit(type, at, { fillPrice: fill.price, fillReason: fill.reason, timeRange: fill.timeRange, policyKnownMfeR: knownMfeR, activeProtectionR: protection.protectionR }, cause);
    Object.assign(result, { simulatedExitTime: fill.time, simulatedExitTimeRange: fill.timeRange, simulatedExitPrice: fill.price, simulatedExitR: exitR, exitReason: fill.reason });
    return null;
  }
  const relevant = data.primary.bars.filter(b => b.openTime < replayHardEndAt && b.openTime + P > trade.actualEntryTime);
  for (const bar of relevant) {
    const barEnd = bar.openTime + P, startAt = Math.max(bar.openTime, trade.actualEntryTime);
    if (startAt > coveredUntil) return block(['REPLAY_MARKET_DATA_INCOMPLETE', 'MARKET_DATA_GAP'], coveredUntil);
    coveredUntil = Math.min(barEnd, replayHardEndAt);
    if (pending) {
      if (pending.policy.policyId !== policy.policyId) emit('POLICY_SWITCH_EFFECTIVE', startAt, { policyId: pending.policy.policyId, knownMfeR, inheritedProtectionR: protection.protectionR }, pending.switchCause);
      if (pending.stage.name !== stage.name || pending.policy.policyId !== policy.policyId) emit('STAGE_EFFECTIVE', startAt, { stage: pending.stage.name, policyId: pending.policy.policyId }, pending.stageCause);
      if (pending.protection.protectionR !== protection.protectionR || pending.protection.price !== protection.price) emit('PROTECTION_EFFECTIVE', startAt,
        { protectionR: pending.protection.protectionR, protectionPrice: pending.protection.price, roundedR: pending.protection.roundedR }, pending.protectionCause);
      policy = pending.policy; stage = pending.stage; protection = pending.protection;
    }
    const barCause = emit('BAR_STARTED', startAt, { barOpenTime: bar.openTime, barCloseTime: barEnd, policyId: policy.policyId, stage: stage.name, policyKnownMfeR: knownMfeR,
      activeProtectionR: protection.protectionR, activeProtectionPrice: protection.price });
    const audit = { barOpenTime: bar.openTime, barCloseTime: barEnd, startAt, knownMfeBefore: knownMfeR, activePolicyId: policy.policyId, activeStage: stage.name,
      activeProtectionR: protection.protectionR, activeProtectionPrice: protection.price, executionSegments: [], evidence: [], knownMfeAfter: knownMfeR, next: null, exited: false };
    auditBars.push(audit);
    // At a new bar open, existing gap stop has precedence; then a previously queued market ceiling exit; then intrabar stop.
    if (bar.openTime >= trade.actualEntryTime) {
      const openFill = stopFill(trade.direction, bar, protection.price, barEnd);
      audit.openObservation = { openTime: bar.openTime, open: bar.open };
      if (openFill.reason === 'STOP_GAP_THROUGH') {
        exit(openFill, 'STOP_TRIGGERED', bar.openTime, barCause); audit.exited = true; break;
      }
      if (pending?.forceExit) {
        exit({ price: bar.open, time: bar.openTime, timeRange: { startAt: bar.openTime, endAt: bar.openTime, semantics: 'MODEL_BAR_OPEN' }, reason: 'HARD_CEILING' }, 'HARD_CEILING_EXIT', bar.openTime, pending.ceilingCause); audit.exited = true; break;
      }
    }
    const segments = data.path.segments.filter(s => s.openTime >= bar.openTime && s.closeTime <= barEnd);
    for (const segment of segments) {
      audit.executionSegments.push(clone(segment));
      if (!segment.fullyContained) {
        if (stopMayBeTouched(trade.direction, segment, protection.price)) return block([segment.entryOverlap ? 'ENTRY_STOP_BOUNDARY_AMBIGUOUS' : 'HARD_END_STOP_BOUNDARY_AMBIGUOUS'], Math.min(segment.closeTime, replayHardEndAt));
        reasons.push(segment.entryOverlap ? 'ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION' : 'HARD_END_BOUNDARY_PARTIAL');
        if (segment.entryOverlap) emit('ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION', Math.min(segment.closeTime, replayHardEndAt), { barOpenTime: segment.openTime }, barCause);
        continue;
      }
      const fill = stopFill(trade.direction, segment, protection.price, segment.closeTime);
      if (fill.triggered) { exit(fill, 'STOP_TRIGGERED', fill.time ?? segment.closeTime, barCause); audit.exited = true; break; }
      audit.evidence.push({ openTime: segment.openTime, closeTime: segment.closeTime, high: segment.high, low: segment.low, close: segment.close,
        fullyContained: true, availableAt: segment.closeTime, seriesId: segment.seriesId });
    }
    if (audit.exited) break;
    // Detail refines path membership/fills only. Policy confirmation remains at primary 5M close.
    if (barEnd <= replayHardEndAt) {
      const previousMfe = knownMfeR;
      for (const e of audit.evidence) {
        const favorableR = rAtPrice(trade, trade.direction === 'LONG' ? e.high : e.low);
        if (favorableR === null) return block(['R_NUMERIC_OVERFLOW'], barEnd);
        knownMfeR = Math.max(knownMfeR, favorableR);
      }
      audit.knownMfeAfter = knownMfeR;
      if (knownMfeR > previousMfe) emit('MFE_UPDATED', barEnd, { policyKnownMfeR: knownMfeR, confirmedBarOpen: bar.openTime, confirmedBarClose: barEnd }, barCause);
      for (const milestoneR of [2, 4, 6, 8, 10]) if (previousMfe < milestoneR && knownMfeR >= milestoneR) emit('MILESTONE_REACHED', barEnd,
        { milestoneR, firstReachedBarOpen: bar.openTime, firstReachedBarClose: barEnd }, barCause);
      recordManualUntil(barEnd);
      const nextPolicy = policyAt(barEnd), nextStage = stageAtMfe(nextPolicy, knownMfeR);
      const calculatedR = calculateProtectionR(protection.protectionR, knownMfeR, nextStage);
      const nextProtection = protectionAtR(trade, calculatedR, executionTickSize);
      if (!nextProtection.valid) return block(nextProtection.qualityReasons, barEnd);
      // Preserve the exact frozen Initial Stop before any dynamic protection, including representation error.
      if (calculatedR === -1) { nextProtection.price = trade.initialStop; nextProtection.roundedR = -1; }
      let stageCause = null;
      if (nextStage.name !== stage.name || nextPolicy.policyId !== policy.policyId) stageCause = emit('STAGE_CONFIRMED', barEnd,
        { stage: nextStage.name, policyId: nextPolicy.policyId, policyKnownMfeR: knownMfeR, effectiveAt: barEnd }, barCause);
      const protectionCause = emit('PROTECTION_CALCULATED', barEnd, { protectionR: calculatedR, protectionPrice: nextProtection.price, theoreticalPrice: nextProtection.theoreticalPrice,
        policyKnownMfeR: knownMfeR, stage: nextStage.name, effectiveAt: barEnd }, stageCause ?? barCause);
      const ceilingCause = nextStage.forceExit ? emit('HARD_CEILING_CONFIRMED', barEnd, { policyId: nextPolicy.policyId, policyKnownMfeR: knownMfeR, effectiveAt: barEnd }, stageCause ?? barCause) : null;
      pending = { policy: nextPolicy, stage: nextStage, protection: nextProtection, stageCause: stageCause ?? barCause, protectionCause, switchCause: switchedCause, forceExit: nextStage.forceExit, ceilingCause };
      audit.next = { policyId: nextPolicy.policyId, stage: nextStage.name, protectionR: calculatedR, protectionPrice: nextProtection.price, effectiveAt: barEnd, forceExit: nextStage.forceExit };
    }
    if (barEnd >= replayHardEndAt) {
      const completed = segments.filter(s => s.fullyContained && s.closeTime === replayHardEndAt).at(-1);
      const price = barEnd === replayHardEndAt ? bar.close : completed?.close ?? hardEndMark?.price;
      if (price === undefined) return block(['HARD_END_BOUNDARY_AMBIGUOUS'], replayHardEndAt);
      if (hardEndMark && completed && hardEndMark.price !== completed.close) return block(['HARD_END_MARK_CONFLICT'], replayHardEndAt);
      if (hardEndMark && barEnd === replayHardEndAt && hardEndMark.price !== bar.close) return block(['HARD_END_MARK_CONFLICT'], replayHardEndAt);
      if (barEnd > replayHardEndAt && !completed) {
        reasons.push('HARD_END_EXPLICIT_MARK');
        if (trade.direction === 'LONG' ? price <= protection.price : price >= protection.price) return block(['HARD_END_MARK_STOP_CONFLICT'], replayHardEndAt);
      }
      exit({ price, time: replayHardEndAt, timeRange: { startAt: replayHardEndAt, endAt: replayHardEndAt, semantics: barEnd === replayHardEndAt || completed ? 'MODEL_BAR_CLOSE' : 'EXPLICIT_MARK' }, reason: 'REPLAY_HARD_END' }, 'REPLAY_HARD_END_EXIT', replayHardEndAt, barCause);
      audit.exited = true; break;
    }
  }
  Object.assign(result, { maxKnownMfeR: knownMfeR, finalActiveProtectionR: protection.protectionR, finalActiveProtectionPrice: protection.price,
    finalRoundedProtectionR: protection.roundedR, finalPolicyId: policy.policyId, finalStage: stage.name });
  if (blockedReasons.length) return block(blockedReasons);
  if (!result.exitReason) return block(['REPLAY_MARKET_DATA_INCOMPLETE'], coveredUntil);
  const qa = auditReplayLookahead(result, trade, bundle);
  result.lookaheadQaStatus = qa.status; result.lookaheadQaReasons = qa.reasons;
  if (qa.status !== 'PASS') return block(['LOOKAHEAD_QA_FAIL', ...qa.reasons], replayHardEndAt);
  Object.assign(result, assessReplayQuality(trade, { reasons, priceSourceMode: data.primary.priceSourceMode, lookaheadQaStatus: qa.status }));
  return result;
}
