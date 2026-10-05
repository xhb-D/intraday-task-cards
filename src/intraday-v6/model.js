import {
  ORDER, BIASES, STRUCTURES_3M, DIRECTIONS, SETUPS, isSetupAllowed,
  recordInitialStop as v5RecordInitialStop, correctInitialStop as v5CorrectInitialStop,
  recordBofToPb as v5RecordBofToPb, revertBofToPb as v5RevertBofToPb
} from '../model.js';
import { activeOpportunityForSymbol, activeTradesForSymbol, effectiveDirectionForSymbol, assertSymbol } from './queries.js';
import { assertV6State, SCHEMA_VERSION, safeTime, own, fail, singleRecordV5View } from './validation.js';
export { assertV6State, SCHEMA_VERSION } from './validation.js';
export { effectiveInitialStop, effectiveBofToPbEvent, derivedManagementState, researchSetupClass } from '../model.js';

export function createWorkspace(time = Date.now()) {
  if (!safeTime(time)) fail('V6_TIME_INVALID', 'time');
  return { schemaVersion: SCHEMA_VERSION, sequence: 0, revision: 0, lastSavedAt: null,
    cards: Object.fromEntries(ORDER.map(symbol => [symbol, { symbol, bias: 'neutral', structure3m: 'unjudged', needsStructureReview: false, direction: 'none', idleSince: time }])),
    records: [], migrationAudit: [] };
}

function assertWritable(value) {
  if (!value || typeof value !== 'object') return;
  if (!Object.isExtensible(value)) fail('V6_STATE_NOT_WRITABLE', 'state');
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.getOwnPropertyDescriptor(value, key).writable) fail('V6_STATE_NOT_WRITABLE', 'state');
    assertWritable(value[key]);
  }
}

// Internal synchronous changes are deterministic, have no clock/storage callbacks,
// and are replayed only after validating their entire candidate and writable graph.
// This preserves the existing state/record identities without rollback mutations.
function transact(state, change) {
  assertV6State(state);
  const candidate = structuredClone(state), preview = change(candidate);
  if (!preview.changed) return preview;
  candidate.revision += 1; assertV6State(candidate); assertWritable(state);
  const result = change(state); state.revision += 1;
  return result;
}

function cardFor(state, symbol) { assertSymbol(symbol); return state.cards[symbol]; }
function recordFor(state, id) {
  const record = state.records.find(r => r.id === id);
  if (!record) fail('V6_RECORD_NOT_FOUND', 'opportunityId');
  return record;
}
function requirePending(record) {
  if (record.enteredAt !== null || record.endedAt !== null) fail('V6_PENDING_REQUIRED', 'opportunityId');
}
function requireTrade(record) {
  if (record.enteredAt === null || record.endedAt !== null) fail('V6_ACTIVE_TRADE_REQUIRED', 'opportunityId');
}
function preflightTime(record, time) {
  if (!safeTime(time) || time < record.stages.at(-1).start || record.researchCapture.manualEvents.some(event => event.recordedAt > time)) fail('V6_TIME_INVALID', 'time');
}
function closeRecord(state, record, reason, time, exitCapture = null) {
  record.stages.at(-1).end = time; record.endedAt = time; record.reason = reason; record.exitCapture = exitCapture;
  if (!activeTradesForSymbol(state, record.symbol).length && !activeOpportunityForSymbol(state, record.symbol)) state.cards[record.symbol].idleSince = time;
}

export function changeBias(state, symbol, bias) {
  return transact(state, next => {
    if (!own(BIASES, bias)) fail('V6_BIAS_INVALID', 'bias');
    const card = cardFor(next, symbol); if (card.bias === bias) return { changed: false, reason: 'same' };
    card.bias = bias; return { changed: true };
  });
}
export function changeStructure(state, symbol, structure3m) {
  return transact(state, next => {
    if (!own(STRUCTURES_3M, structure3m)) fail('V6_STRUCTURE_INVALID', 'structure3m');
    const card = cardFor(next, symbol); if (card.structure3m === structure3m) return { changed: false, reason: 'same' };
    card.structure3m = structure3m; return { changed: true };
  });
}
export function changeDirection(state, symbol, direction, time = Date.now(), confirmed = false) {
  return transact(state, next => {
    if (!own(DIRECTIONS, direction)) fail('V6_DIRECTION_INVALID', 'direction');
    const card = cardFor(next, symbol);
    if (activeTradesForSymbol(next, symbol).length) return { changed: false, reason: 'holding' };
    if (activeOpportunityForSymbol(next, symbol)) return { changed: false, reason: 'pending' };
    if (card.direction === direction) return { changed: false, reason: 'same' };
    if (!safeTime(time)) fail('V6_TIME_INVALID', 'time');
    card.direction = direction; return { changed: true };
  });
}

export function chooseSetup(state, symbol, type, time = Date.now()) {
  return transact(state, next => {
    if (!own(SETUPS, type)) fail('V6_SETUP_INVALID', 'type');
    if (!safeTime(time)) fail('V6_TIME_INVALID', 'time');
    const card = cardFor(next, symbol), direction = effectiveDirectionForSymbol(next, symbol);
    if (!isSetupAllowed(direction, card.structure3m, type)) return { changed: false, reason: 'context' };
    const pending = activeOpportunityForSymbol(next, symbol);
    if (pending?.type === type) return { changed: false, reason: 'same' };
    if (pending) { preflightTime(pending, time); closeRecord(next, pending, 'canceled', time); }
    let id;
    do { next.sequence += 1; id = `op-${next.sequence}-${time.toString(36)}`; } while (next.records.some(record => record.id === id));
    const opportunity = { id, symbol, direction, type, zone: null, createdAt: time, registeredAt: time,
      biasAtRegistration: card.bias, structure3mAtRegistration: card.structure3m, invalidReason: null, migrationReason: null,
      enteredAt: null, endedAt: null, reason: null, attention: 'wait', stageSince: time,
      stages: [{ state: 'wait', start: time, end: null }], researchCapture: { eventSequence: 0, manualEvents: [] }, exitCapture: null };
    next.records.push(opportunity); return { changed: true, opportunity };
  });
}

export function setOpportunityStage(state, id, stage, time = Date.now()) {
  return transact(state, next => {
    if (!['wait', 'signal'].includes(stage)) fail('V6_STAGE_INVALID', 'stage');
    const record = recordFor(next, id); requirePending(record); preflightTime(record, time);
    if (record.attention === stage) return { changed: false };
    record.stages.at(-1).end = time; record.attention = stage; record.stageSince = time;
    record.stages.push({ state: stage, start: time, end: null }); return { changed: true };
  });
}

export function markEntered(state, id, time = Date.now(), confirmed = false) {
  return transact(state, next => {
    const record = recordFor(next, id); requirePending(record); preflightTime(record, time);
    if (confirmed !== true) return { changed: false, needsConfirmation: true };
    record.stages.at(-1).end = time; record.enteredAt = time; record.stageSince = time;
    record.stages.push({ state: 'position', start: time, end: null }); return { changed: true };
  });
}

export function endOpportunity(state, id, reason, time = Date.now()) {
  return transact(state, next => {
    if (!['invalid', 'canceled'].includes(reason)) fail('V6_END_REASON_INVALID', 'reason');
    const record = recordFor(next, id); requirePending(record); preflightTime(record, time);
    closeRecord(next, record, reason, time); return { changed: true };
  });
}

export function markTradeExited(state, id, exitKind, time = Date.now(), confirmed = false) {
  return transact(state, next => {
    if (!['STOP_EXIT', 'OTHER_EXIT', 'UNKNOWN'].includes(exitKind)) fail('V6_EXIT_KIND_INVALID', 'exitKind');
    const record = recordFor(next, id); requireTrade(record); preflightTime(record, time);
    if (confirmed !== true) return { changed: false, needsConfirmation: true };
    closeRecord(next, record, 'closed', time, { kind: exitKind, groupId: null }); return { changed: true };
  });
}

export function markAllTradesExited(state, symbol, time = Date.now(), confirmed = false) {
  assertV6State(state); assertSymbol(symbol);
  const targetIds = activeTradesForSymbol(state, symbol).map(record => record.id);
  return transact(state, next => {
    if (!safeTime(time)) fail('V6_TIME_INVALID', 'time');
    if (!targetIds.length) return { changed: false };
    const targets = targetIds.map(id => recordFor(next, id));
    for (const record of targets) { requireTrade(record); preflightTime(record, time); }
    if (confirmed !== true) return { changed: false, needsConfirmation: true };
    const used = new Set(next.records.map(record => record.exitCapture?.groupId).filter(Boolean));
    const base = `flatten-${next.revision + 1}`; let groupId = base, suffix = 0;
    while (used.has(groupId)) groupId = `${base}-${++suffix}`;
    for (const record of targets) closeRecord(next, record, 'closed', time, { kind: 'MANUAL_FLATTEN', groupId });
    return { changed: true, targetIds: [...targetIds], groupId };
  });
}

export function deleteRecord(state, id) {
  return transact(state, next => {
    const index = next.records.findIndex(record => record.id === id);
    if (index < 0) return { changed: false };
    if (next.records[index].endedAt === null) fail('V6_ACTIVE_RECORD_DELETE_FORBIDDEN', 'opportunityId');
    next.records.splice(index, 1); return { changed: true };
  });
}

function capture(state, id, writer, args) {
  return transact(state, next => {
    const record = recordFor(next, id); requireTrade(record);
    const view = singleRecordV5View(record);
    let result;
    try { result = writer(view, record.symbol, ...args); }
    catch (cause) { throw Object.assign(new Error(cause.message, { cause }), { code: 'V6_CAPTURE_INVALID', path: `records.${id}.researchCapture` }); }
    if (result.changed) record.researchCapture = view.cards[record.symbol].opportunity.researchCapture;
    return result;
  });
}
export function recordInitialStop(state, id, stopPrice, time = Date.now(), effectiveAt = time) {
  return capture(state, id, v5RecordInitialStop, [stopPrice, time, effectiveAt]);
}
export function correctInitialStop(state, id, stopPrice, time = Date.now()) {
  return capture(state, id, v5CorrectInitialStop, [stopPrice, time]);
}
export function recordBofToPb(state, id, time = Date.now()) {
  return capture(state, id, v5RecordBofToPb, [time]);
}
export function revertBofToPb(state, id, time = Date.now()) {
  return capture(state, id, v5RevertBofToPb, [time]);
}
