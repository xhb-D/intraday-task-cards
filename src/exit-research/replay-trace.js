export function appendReplayTrace(trace, type, at, data = {}, causeSequence = null) {
  const event = { sequence: trace.length + 1, type, at, causeSequence, ...structuredClone(data) };
  trace.push(event); return event.sequence;
}
export const REPLAY_TRACE_TYPES = Object.freeze(['ENTRY', 'INITIAL_STOP_ACTIVE', 'BAR_STARTED', 'ENTRY_BOUNDARY_IGNORED_FOR_POLICY_ACTIVATION',
  'MFE_UPDATED', 'MILESTONE_REACHED', 'STAGE_CONFIRMED', 'STAGE_EFFECTIVE', 'BOF_TO_PB_MANUAL_RECORDED', 'BOF_TO_PB_MANUAL_REVERTED',
  'POLICY_SWITCH_EFFECTIVE', 'PROTECTION_CALCULATED', 'PROTECTION_EFFECTIVE', 'STOP_TRIGGERED', 'HARD_CEILING_CONFIRMED',
  'HARD_CEILING_EXIT', 'REPLAY_HARD_END_EXIT', 'REPLAY_BLOCKED']);
