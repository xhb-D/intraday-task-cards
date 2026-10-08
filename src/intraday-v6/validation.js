import { ORDER, BIASES, STRUCTURES_3M, DIRECTIONS, SETUPS, assertState as assertV5State, createWorkspace as createV5Workspace } from '../model.js';
import { effectiveDirectionForSymbol } from './queries.js';

export const SCHEMA_VERSION = 6;
export const safeTime = value => Number.isSafeInteger(value) && value >= 0;
export const own = (object, key) => Object.hasOwn(object, key);
export function fail(code, path, message = code) {
  throw Object.assign(new Error(message), { code, path });
}
const exact = (object, keys) => object && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => own(object, key));

// Accept only data that survives JSON stringify/parse without losing information.
export function assertJsonData(value, path = 'state', ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if (typeof value !== 'object' || ancestors.has(value)) fail('V6_JSON_INVALID', path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (Array.isArray(value) ? Array.prototype : Object.prototype)) fail('V6_JSON_INVALID', path);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) fail('V6_JSON_INVALID', path);
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || keys.length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, index) => String(index)).some(key => !own(value, key)))) fail('V6_JSON_INVALID', path);
  ancestors.add(value);
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !own(descriptor, 'value')) fail('V6_JSON_INVALID', `${path}.${key}`);
    assertJsonData(descriptor.value, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

// Temporary V5 view for frozen per-record event/history validation and event writers.
// This is never persisted and never used as the V6 source of active records.
export function singleRecordV5View(record) {
  const state = createV5Workspace(0);
  const { exitCapture, ...businessRecord } = structuredClone(record);
  // Projection is solely for frozen lifecycle/event validation and writers.
  // Never persist or return this type as V6 truth; the original record stays mtf_bof.
  if (record.type === 'mtf_bof') businessRecord.type = 'htf_bof';
  state.records = [businessRecord];
  if (record.endedAt === null) {
    state.cards[record.symbol].direction = record.direction;
    state.cards[record.symbol].opportunity = businessRecord;
  }
  return state;
}

function assertTimeline(record, path) {
  if (record.registeredAt < record.createdAt || record.stages[0].start < record.createdAt ||
      record.enteredAt !== null && record.enteredAt < record.registeredAt ||
      record.endedAt !== null && record.endedAt < record.registeredAt) fail('V6_TIMELINE_INVALID', path);
  const position = record.stages.filter(stage => stage.state === 'position');
  if (position.length !== (record.enteredAt === null ? 0 : 1) || position.length && position[0].start !== record.enteredAt) fail('V6_TIMELINE_INVALID', path);
  for (const stage of record.stages) if (stage.end !== null && stage.end < stage.start) fail('V6_TIMELINE_INVALID', path);
  if (record.endedAt !== null && record.stages.at(-1).end !== record.endedAt) fail('V6_TIMELINE_INVALID', path);
  if ((own(SETUPS, record.type) || record.type === 'mtf_bof') && record.stages[0].start !== record.registeredAt) fail('V6_TIMELINE_INVALID', path);
}

const recordKeys = ['id', 'symbol', 'direction', 'type', 'zone', 'createdAt', 'registeredAt', 'biasAtRegistration', 'structure3mAtRegistration',
  'invalidReason', 'migrationReason', 'enteredAt', 'endedAt', 'reason', 'attention', 'stageSince', 'stages', 'researchCapture', 'exitCapture'];
const forbiddenRecordKeys = ['zoneDraft', 'tradeId', 'opportunity', 'activeTrades', 'initialStop', 'currentInitialStop', 'currentManagement', 'currentManagementState', 'symbolCurrentManagement'];

export function assertV6State(state) {
  assertJsonData(state);
  if (!exact(state, ['schemaVersion', 'sequence', 'revision', 'lastSavedAt', 'cards', 'records', 'migrationAudit']) ||
      state.schemaVersion !== SCHEMA_VERSION || !safeTime(state.sequence) || !safeTime(state.revision) ||
      state.lastSavedAt !== null && !safeTime(state.lastSavedAt) || !Array.isArray(state.records) || !Array.isArray(state.migrationAudit)) fail('V6_STATE_INVALID', 'state');
  if (!exact(state.cards, ORDER)) fail('V6_CARDS_INVALID', 'cards');
  for (const symbol of ORDER) {
    const card = state.cards[symbol];
    if (!exact(card, ['symbol', 'bias', 'structure3m', 'needsStructureReview', 'direction', 'idleSince']) || card.symbol !== symbol ||
        !own(BIASES, card.bias) || !own(STRUCTURES_3M, card.structure3m) || card.needsStructureReview !== false ||
        !own(DIRECTIONS, card.direction) || !safeTime(card.idleSince)) fail('V6_CARD_INVALID', `cards.${symbol}`);
  }
  const ids = new Set(), groups = new Map();
  for (const [index, record] of state.records.entries()) {
    const path = `records.${index}`;
    if (!record || typeof record !== 'object' || Array.isArray(record) || !recordKeys.every(key => own(record, key)) || forbiddenRecordKeys.some(key => own(record, key))) fail('V6_RECORD_INVALID', path);
    if (typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id) || !ORDER.includes(record.symbol)) fail('V6_RECORD_INVALID', path);
    ids.add(record.id);
    try { assertV5State(singleRecordV5View(record)); }
    catch (cause) { throw Object.assign(new Error('V6 记录不符合既有生命周期/事件语义', { cause }), { code: 'V6_RECORD_INVALID', path }); }
    assertTimeline(record, path);
    const exit = record.exitCapture;
    if (record.reason !== 'closed') {
      if (exit !== null) fail('V6_EXIT_CAPTURE_INVALID', `${path}.exitCapture`);
    } else {
      if (record.enteredAt === null || record.endedAt === null || !exact(exit, ['kind', 'groupId']) ||
          !['UNKNOWN', 'STOP_EXIT', 'MANUAL_FLATTEN', 'OTHER_EXIT'].includes(exit.kind)) fail('V6_EXIT_CAPTURE_INVALID', `${path}.exitCapture`);
      if (exit.kind === 'MANUAL_FLATTEN') {
        if (typeof exit.groupId !== 'string' || !exit.groupId.trim()) fail('V6_EXIT_CAPTURE_INVALID', `${path}.exitCapture`);
        const prior = groups.get(exit.groupId);
        if (prior && (prior.symbol !== record.symbol || prior.endedAt !== record.endedAt)) fail('V6_FLATTEN_GROUP_CONFLICT', `${path}.exitCapture`);
        groups.set(exit.groupId, record);
      } else if (exit.groupId !== null) fail('V6_EXIT_CAPTURE_INVALID', `${path}.exitCapture`);
    }
  }
  for (const symbol of ORDER) effectiveDirectionForSymbol(state, symbol);
  const legacyAudits = [];
  for (const [index, audit] of state.migrationAudit.entries()) {
    const path = `migrationAudit.${index}`;
    if (!audit || typeof audit !== 'object' || Array.isArray(audit)) fail('V6_MIGRATION_AUDIT_INVALID', path);
    if (audit.fromSchemaVersion === 3 && audit.toSchemaVersion === 4) { legacyAudits.push(audit); continue; }
    if (!exact(audit, ['code', 'fromSchemaVersion', 'toSchemaVersion', 'symbol', 'opportunityId', 'migratedAt']) ||
        audit.code !== 'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD' || audit.fromSchemaVersion !== 5 || audit.toSchemaVersion !== 6 ||
        !ORDER.includes(audit.symbol) || typeof audit.opportunityId !== 'string' || !audit.opportunityId.trim() || !safeTime(audit.migratedAt)) fail('V6_MIGRATION_AUDIT_INVALID', path);
  }
  const legacyView = createV5Workspace(0); legacyView.migrationAudit = legacyAudits;
  try { assertV5State(legacyView); }
  catch (cause) { throw Object.assign(new Error('旧迁移审计无效', { cause }), { code: 'V6_MIGRATION_AUDIT_INVALID', path: 'migrationAudit' }); }
  return true;
}
