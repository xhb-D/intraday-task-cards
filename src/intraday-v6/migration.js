import { ORDER, assertState as assertV5State, recordSnapshot } from '../model.js';
import { assertV6State, assertJsonData, safeTime } from './validation.js';

function blocked(code, path, cause) {
  throw Object.assign(new Error(code, cause ? { cause } : undefined), { code, path, status: 'BLOCKED' });
}

export function migrateV5ToV6(v5State, options) {
  // Always run the existing V5 validator first; never repair an invalid input.
  try { assertV5State(v5State); }
  catch (cause) {
    if (cause.code === 'STATE_VALIDATION_ERROR' && cause.message === '活动记录不一致') blocked('ACTIVE_RECORD_CONFLICT_IN_V5', cause.path, cause);
    blocked('INVALID_V5_STATE', cause.path ?? 'state', cause);
  }
  if (!options || Object.keys(options).length !== 1 || !Object.hasOwn(options, 'migratedAt') || !safeTime(options.migratedAt)) blocked('MIGRATED_AT_REQUIRED', 'migratedAt');
  try { assertJsonData(v5State); }
  catch (cause) { blocked('INVALID_V5_STATE', cause.path, cause); }
  const { migratedAt } = options;
  const state = structuredClone(v5State), audits = [];
  for (const symbol of ORDER) {
    const card = state.cards[symbol], opportunity = card.opportunity;
    if (opportunity) {
      if (Object.hasOwn(opportunity, 'zoneDraft') && opportunity.zoneDraft !== '') blocked('V5_ZONE_DRAFT_REQUIRES_REVIEW', `cards.${symbol}.opportunity.zoneDraft`);
      const record = state.records.find(record => record.id === opportunity.id);
      const snapshot = recordSnapshot(opportunity);
      if (record && JSON.stringify(record) !== JSON.stringify(snapshot)) blocked('ACTIVE_RECORD_CONFLICT_IN_V5', `cards.${symbol}.opportunity`);
      if (!record) {
        state.records.push(snapshot);
        audits.push({ code: 'ACTIVE_RECORD_RECOVERED_FROM_V5_CARD', fromSchemaVersion: 5, toSchemaVersion: 6, symbol, opportunityId: opportunity.id, migratedAt });
      }
    }
    delete card.opportunity;
  }
  for (const record of state.records) {
    if (Object.hasOwn(record, 'exitCapture')) blocked('INVALID_V5_STATE', 'records.exitCapture');
    record.exitCapture = record.enteredAt !== null && record.endedAt !== null && record.reason === 'closed' ? { kind: 'UNKNOWN', groupId: null } : null;
  }
  state.schemaVersion = 6; state.migrationAudit.push(...audits);
  try { assertV6State(state); }
  catch (cause) { blocked('V6_MIGRATION_CANDIDATE_INVALID', cause.path, cause); }
  return { state, migratedAt, audits: structuredClone(audits) };
}
