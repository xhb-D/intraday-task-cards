import { parseTradovateTime } from './time.js';
import { validationError } from './csv.js';
import { assertState, createWorkspace } from '../model.js';

export const clone = value => structuredClone(value);
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const uniqueSorted = values => [...new Set(values)].sort(compareText);
export const flag = (code, severity = 'review-required') => ({ code, severity });
export const samePrice = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
export const fail = (code, field = 'input') => { throw validationError(code, 0, field); };
export function epochMillis(time) {
  if (!time) fail('EXECUTION_TIME_MISSING', 'time');
  const parsed = parseTradovateTime(time.raw, 0, 'time');
  if (parsed.offsetMinutes === null) fail('EXECUTION_TIMEZONE_UNCONFIRMED', 'time');
  for (const key of ['normalized', 'sortKey', 'timezone', 'offsetMinutes']) if (time[key] !== parsed[key]) fail('EXECUTION_TIME_INCONSISTENT', 'time');
  const [, year, month, day, hour, minute, second, ms] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(parsed.normalized);
  return Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +ms) - parsed.offsetMinutes * 60000;
}
export function assertOpportunityRecord(record) {
  // Reuse frozen V5 event validation via a detached type-only compatibility view.
  // Matching and research output still receive the original mtf_bof record.
  const state = createWorkspace(0);
  const validationRecord = clone(record);
  if (validationRecord?.type === 'mtf_bof') validationRecord.type = 'htf_bof';
  state.records = [validationRecord];
  if (record?.endedAt === null && state.cards[record.symbol]) {
    state.cards[record.symbol].direction = record.direction;
    state.cards[record.symbol].opportunity = validationRecord;
  }
  try { assertState(state); } catch { fail('INVALID_OPPORTUNITY_RECORD', 'record'); }
}
export function indexById(values, key) {
  const map = new Map();
  if (!Array.isArray(values)) fail('INVALID_BATCH', key);
  for (const value of values) {
    if (typeof value?.[key] !== 'string' || !value[key].trim()) fail('INVALID_ID', key);
    if (map.has(value[key])) fail('DUPLICATE_ID', key);
    map.set(value[key], value);
  }
  return map;
}
export function executionFlagSeverities(trade, qa) {
  return uniqueSorted(trade.qualityFlags || []).map(code => flag(code,
    ['UNSUPPORTED_SCALE_PATTERN', 'RE_ADD_AFTER_EXIT_STARTED', 'OPEN_POSITION_AT_FILE_END'].includes(code) ? 'blocking' :
      ['MULTI_ENTRY_ORDER', 'MULTI_EXIT_ORDER'].includes(code) && qa?.orders.status === 'PASS' && qa?.positionHistory.status === 'PASS' ? 'informational' : 'review-required'));
}
