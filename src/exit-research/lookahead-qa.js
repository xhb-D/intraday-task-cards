import { rAtPrice } from './r-math.js';
import { calculateProtectionR, protectionAtR } from './protection.js';
import { stageAtMfe, validateExitPolicy } from './policy-schema.js';
import { stopFill, stopMayBeTouched } from './execution-model.js';
import { REPLAY_TRACE_TYPES } from './replay-trace.js';
// Independent chronological audit of the exported run ledger, not a constant PASS marker.
export function auditReplayLookahead(run, trade, bundle = null) {
  const reasons = [], fail = code => reasons.push(code);
  if (!run || !Number.isSafeInteger(run.replayHardEndAt) || run.replayHardEndAt <= trade?.actualEntryTime || run.replayStartAt !== trade.actualEntryTime) fail('HARD_END_NOT_PRECONFIGURED');
  if (!Array.isArray(run?.auditBars) || !run.auditBars.length || !Array.isArray(run?.trace) || !run.trace.length) return { status: 'FAIL', reasons: ['REPLAY_AUDIT_MISSING', ...reasons] };
  const sourceSeries = bundle?.series ?? [];
  let known = 0, previous = null;
  for (const b of run.auditBars) {
    if (b.barCloseTime - b.barOpenTime !== 300000 || b.startAt !== Math.max(b.barOpenTime, trade.actualEntryTime) || b.barOpenTime >= run.replayHardEndAt) fail('BAR_WINDOW_INVALID');
    if (b.knownMfeBefore !== known) fail('FUTURE_MFE_AT_BAR_START');
    if (previous && (b.barOpenTime !== previous.barCloseTime || previous.exited)) fail('FUTURE_BAR_ORDER_INVALID');
    if (previous?.next) {
      if (b.activeProtectionR !== previous.next.protectionR || b.activeProtectionPrice !== previous.next.protectionPrice || b.activeStage !== previous.next.stage || b.activePolicyId !== previous.next.policyId) fail('NEXT_BAR_STATE_MISMATCH');
    } else if (!previous && (b.activeProtectionR !== -1 || b.activeProtectionPrice !== trade.initialStop)) fail('INITIAL_PROTECTION_CHANGED');
    if (b.activeProtectionR < (previous?.activeProtectionR ?? -1)) fail('PROTECTION_LOOSENED');
    let nextKnown = known;
    for (const e of b.evidence) {
      if (bundle) {
        const source = sourceSeries.find(s => s.seriesId === e.seriesId), bar = source?.bars.find(v => v.openTime === e.openTime);
        if (!bar || source.timeframeMs !== e.closeTime - e.openTime || bar.high !== e.high || bar.low !== e.low || bar.close !== e.close) fail('MFE_EVIDENCE_SOURCE_CONFLICT');
      }
      if (!e.fullyContained || e.openTime < trade.actualEntryTime || e.closeTime > Math.min(b.barCloseTime, run.replayHardEndAt) || e.openTime < b.barOpenTime || e.availableAt !== e.closeTime) fail('UNCONFIRMED_OR_FUTURE_EXTREME');
      const r = rAtPrice(trade, trade.direction === 'LONG' ? e.high : e.low);
      if (r === null) fail('INVALID_MFE_EVIDENCE'); else nextKnown = Math.max(nextKnown, r);
    }
    // A stop/ceiling exit does not permit reading surviving/completed full-bar extremes.
    if (b.barCloseTime > run.replayHardEndAt || b.exited && !b.next) nextKnown = known;
    if (b.knownMfeAfter !== nextKnown) fail('KNOWN_MFE_EVIDENCE_MISMATCH');
    known = nextKnown;
    if (b.next) {
      const policy = Object.values(run.policyDefinitions || {}).find(p => p.policyId === b.next.policyId);
      if (!validateExitPolicy(policy).valid) fail('QA_POLICY_INVALID');
      else {
        const stage = stageAtMfe(policy, known), expectedR = calculateProtectionR(b.activeProtectionR, known, stage), expectedPrice = expectedR === -1 ? trade.initialStop : protectionAtR(trade, expectedR, run.executionTickSize).price;
        if (b.next.stage !== stage.name || b.next.protectionR !== expectedR || b.next.protectionPrice !== expectedPrice || b.next.forceExit !== stage.forceExit) fail('POLICY_CONFIRMATION_MISMATCH');
      }
      if (b.next.effectiveAt !== b.barCloseTime) fail('SAME_BAR_ACTIVATION');
    }
    previous = b;
  }
  if (run.maxKnownMfeR !== known) fail('FINAL_MFE_MISMATCH');
  let previousAt = -1;
  const forbidden = /^(finalMfe|finalExit|futureMilestone|possibleMaxR|researchMfe|actualExit|futureBar)/i;
  for (const [i, e] of run.trace.entries()) {
    if (e.sequence !== i + 1 || !REPLAY_TRACE_TYPES.includes(e.type) || e.at < previousAt || e.at > run.replayHardEndAt) fail('TRACE_ORDER_INVALID');
    previousAt = e.at;
    const hasForbidden = v => v && typeof v === 'object' && Object.entries(v).some(([k, value]) => forbidden.test(k) || hasForbidden(value));
    if (hasForbidden(e)) fail('TRACE_FUTURE_FIELD');
    const cause = e.causeSequence === null ? null : run.trace[e.causeSequence - 1];
    if (e.causeSequence !== null && (!cause || cause.sequence >= e.sequence || cause.at > e.at)) fail('TRACE_CAUSE_INVALID');
    if (['STAGE_EFFECTIVE', 'PROTECTION_EFFECTIVE', 'HARD_CEILING_EXIT'].includes(e.type)) {
      if (!cause || !['STAGE_CONFIRMED', 'PROTECTION_CALCULATED', 'HARD_CEILING_CONFIRMED'].includes(cause.type) || cause.at !== e.at) fail('NEXT_BAR_CAUSE_INVALID');
      const causeBar = [...run.auditBars].reverse().find(b => b.barCloseTime === cause?.at);
      const effectBar = run.auditBars.find(b => b.barOpenTime === e.at);
      if (!causeBar || !effectBar || causeBar.barOpenTime >= effectBar.barOpenTime) fail('SAME_BAR_EFFECT');
    }
    if (['BOF_TO_PB_MANUAL_RECORDED', 'BOF_TO_PB_MANUAL_REVERTED'].includes(e.type)) {
      const original = trade.manualEvents?.find(v => v.id === e.eventId), anchor = sourceSeries.find(s => s.seriesId === run.provenance?.primary?.seriesId)?.bars[0]?.openTime ?? run.auditBars[0].barOpenTime;
      const expectedAt = original ? anchor + (Math.floor((original.recordedAt - anchor) / 300000) + 1) * 300000 : null;
      if (!original || original.recordedAt !== e.manualTransitionAt || e.policyTransitionEffectiveAt !== expectedAt || e.at < original.recordedAt) fail('MANUAL_FACT_OR_TIMING_CONFLICT');
    }
    if (e.type === 'POLICY_SWITCH_EFFECTIVE') {
      if (run.setupStateSource !== 'MANUAL_ACTUAL' || !cause || !['BOF_TO_PB_MANUAL_RECORDED', 'BOF_TO_PB_MANUAL_REVERTED'].includes(cause.type) || e.at < cause.policyTransitionEffectiveAt) fail('MANUAL_SWITCH_EARLY');
    }
    if (e.type === 'BAR_STARTED') {
      const b = run.auditBars.find(b => b.barOpenTime === e.barOpenTime);
      if (!b || e.activeProtectionR !== b.activeProtectionR || e.activeProtectionPrice !== b.activeProtectionPrice || e.policyKnownMfeR !== b.knownMfeBefore || e.stage !== b.activeStage) fail('TRACE_BAR_STATE_MISMATCH');
    }
    if (e.type === 'MFE_UPDATED') {
      const b = run.auditBars.find(b => b.barCloseTime === e.at);
      if (!b || e.policyKnownMfeR !== b.knownMfeAfter || e.confirmedBarClose !== e.at) fail('TRACE_MFE_EARLY');
    }
  }
  if (!['STOP_TRIGGERED', 'STOP_GAP_THROUGH', 'HARD_CEILING', 'REPLAY_HARD_END'].includes(run.exitReason) || !run.auditBars.at(-1).exited) fail('EXIT_AUDIT_MISSING');
  const last = run.auditBars.at(-1), exitEvent = run.trace.findLast(e => ['STOP_TRIGGERED', 'HARD_CEILING_EXIT', 'REPLAY_HARD_END_EXIT'].includes(e.type));
  if (!exitEvent || JSON.stringify(exitEvent.timeRange) !== JSON.stringify(run.simulatedExitTimeRange) || exitEvent.fillPrice !== run.simulatedExitPrice || exitEvent.fillReason !== run.exitReason || rAtPrice(trade, run.simulatedExitPrice) !== run.simulatedExitR) fail('EXIT_RESULT_CONFLICT');
  if (run.exitReason === 'REPLAY_HARD_END' && run.simulatedExitTime !== run.replayHardEndAt) fail('HARD_END_EXIT_TIME_CONFLICT');
  if (run.exitReason === 'HARD_CEILING' && (!run.auditBars.at(-2)?.next?.forceExit || run.simulatedExitTime !== last.barOpenTime)) fail('CEILING_NOT_NEXT_BAR');
  if (run.finalActiveProtectionR !== last.activeProtectionR || run.finalActiveProtectionPrice !== last.activeProtectionPrice || run.finalStage !== last.activeStage || run.finalPolicyId !== last.activePolicyId) fail('FINAL_STATE_CONFLICT');
  if (bundle) {
    const primary = sourceSeries.find(s => s.seriesId === run.provenance?.primary?.seriesId);
    for (const b of run.auditBars) for (const s of b.executionSegments || []) {
      const source = sourceSeries.find(v => v.seriesId === s.seriesId), original = source?.bars.find(v => v.openTime === s.openTime);
      if (!original || ['open', 'high', 'low', 'close'].some(k => original[k] !== s[k]) || source.timeframeMs !== s.timeframeMs) fail('EXECUTION_SOURCE_CONFLICT');
    }
    let expectedFill = null;
    const primaryLast = primary?.bars.find(b => b.openTime === last.barOpenTime);
    if (primaryLast && last.barOpenTime >= trade.actualEntryTime) {
      const gap = stopFill(trade.direction, primaryLast, last.activeProtectionPrice, last.barCloseTime);
      if (gap.reason === 'STOP_GAP_THROUGH') expectedFill = gap;
      else if (run.auditBars.at(-2)?.next?.forceExit) expectedFill = { reason: 'HARD_CEILING', price: primaryLast.open, time: primaryLast.openTime };
    }
    if (!expectedFill) for (const s of last.executionSegments || []) {
      if (!s.fullyContained && stopMayBeTouched(trade.direction, s, last.activeProtectionPrice)) fail('BOUNDARY_STOP_UNRESOLVED');
      if (s.fullyContained) {
        const fill = stopFill(trade.direction, s, last.activeProtectionPrice, s.closeTime);
        if (fill.triggered) { expectedFill = fill; break; }
      }
    }
    if (expectedFill?.timeRange && JSON.stringify(expectedFill.timeRange) !== JSON.stringify(run.simulatedExitTimeRange)) fail('EXIT_TIME_RANGE_CONFLICT');
    if (expectedFill && (run.exitReason !== expectedFill.reason || run.simulatedExitPrice !== expectedFill.price || run.simulatedExitTime !== expectedFill.time)) fail('EXIT_FILL_LOOKAHEAD_OR_PRICE_CONFLICT');
    if (!expectedFill && run.exitReason !== 'REPLAY_HARD_END') fail('EXIT_WITHOUT_EXECUTION_CAUSE');
    if (!expectedFill && run.exitReason === 'REPLAY_HARD_END') {
      const completed = last.executionSegments?.filter(s => s.fullyContained && s.closeTime === run.replayHardEndAt).at(-1);
      const markPrice = last.barCloseTime === run.replayHardEndAt ? primaryLast?.close : completed?.close ?? run.hardEndMark?.price;
      if (markPrice !== run.simulatedExitPrice) fail('HARD_END_FUTURE_CLOSE_OR_MARK_CONFLICT');
    }
  }
  if (run.simulatedExitTime !== null && (run.simulatedExitTime < trade.actualEntryTime || run.simulatedExitTime > run.replayHardEndAt)) fail('EXIT_WINDOW_INVALID');
  return { status: reasons.length ? 'FAIL' : 'PASS', reasons: [...new Set(reasons)].sort() };
}
