import { assertLegacyState, assertV4State, assertState, copy, DIRECTIONS, LEGACY_SCHEMA_VERSION, V4_SCHEMA_VERSION, SCHEMA_VERSION, migrateWorkspace, setupLabel, recordProgress, effectiveInitialStop, effectiveBofToPbEvent, formatStopPrice } from './model.js';

export const APP_ID = 'intraday-task-cards';
export const STORE_KEY = 'intraday-task-cards:v1:state';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const validSavedAt = value => Number.isSafeInteger(value) && value >= 0;
const persistenceError = (message, path) => Object.assign(new Error(message), { code: 'SCHEMA_ERROR', path });

export function makeEnvelope(state, savedAt = Date.now()) {
  assertState(state);
  if (!validSavedAt(savedAt)) throw persistenceError('状态卡保存时间无效', 'savedAt');
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, savedAt, state: copy(state), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser-local' };
}

export function validateEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || envelope.schemaVersion !== SCHEMA_VERSION || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('不是受支持的 V5 状态卡备份，或版本不兼容', 'envelope');
  assertState(envelope.state); return true;
}

function validateLegacyEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || envelope.schemaVersion !== LEGACY_SCHEMA_VERSION || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('不是受支持的 V3 状态卡迁移输入', 'envelope');
  assertLegacyState(envelope.state); return true;
}

export function migrateEnvelope(envelope) {
  if (envelope?.schemaVersion === SCHEMA_VERSION) { validateEnvelope(envelope); return { envelope, migrated: false, audits: [] }; }
  if (envelope?.schemaVersion === V4_SCHEMA_VERSION) {
    if (envelope.app !== APP_ID || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('V4 状态卡迁移输入无效', 'envelope');
    assertV4State(envelope.state);
  } else validateLegacyEnvelope(envelope);
  const result = migrateWorkspace(envelope.state, envelope.savedAt);
  const migrated = { ...copy(envelope), schemaVersion: SCHEMA_VERSION, state: result.state };
  validateEnvelope(migrated);
  return { envelope: migrated, migrated: true, migratedAt: result.migratedAt, audits: result.audits };
}

export function serialize(state, savedAt = Date.now()) { return JSON.stringify(makeEnvelope(state, savedAt)); }
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FILE_BYTES) throw new Error('存档为空或超过 8 MB');
  let envelope;
  try { envelope = JSON.parse(raw); } catch (error) { throw Object.assign(new Error('存档 JSON 无法解析', { cause: error }), { code: 'JSON_PARSE_ERROR', path: 'raw' }); }
  validateEnvelope(envelope); return envelope;
}

export function exportMarkdown(state, scope = 'today', now = Date.now()) {
  assertState(state); const day = dateKey(now);
  const rows = state.records.filter(record => scope === 'all' || record.endedAt === null || dateKey(record.registeredAt) === day || (record.endedAt !== null && dateKey(record.endedAt) === day)).sort((a,b) => b.registeredAt - a.registeredAt);
  const lines = [`# 日内机会记录 · ${scope === 'all' ? '全部保留记录' : day}`, '', `导出时间：${fullTime(now)}`, '', '> 仅手动任务记录；不读取行情、订单或成交。新机会选择即登记，入场确认即已执行，全部平仓才结束。', '', '| 登记时间 | 品种 | 交易方向 | 机会 | 已确认关键位置 | 登记时偏见 / 市场结构 | 进展／结果 | Research Capture |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const record of rows) {
    const direction = DIRECTIONS[record.direction] || (record.direction === 'long' ? '做多' : '做空');
    const structure = ({ unjudged: '未判断', bullish: '多头', range: '震荡', bearish: '空头' })[record.structure3mAtRegistration] || record.structure3mAtRegistration;
    lines.push(`| ${fullTime(record.registeredAt)} | ${record.symbol} | ${direction} | ${setupLabel(record.type)} | ${cell(record.zone ?? '—')} | 偏见：${({ bullish: '偏多', neutral: '无偏见', bearish: '偏空' })[record.biasAtRegistration]}<br>市场结构：${structure} | ${recordProgress(record)} | ${researchSummary(record)} |`);
  }
  if (!rows.length) lines.push('', '本范围内尚无已登记且仍保留的记录。');
  return lines.concat(['', '---', '阶段起止时间和当前任务快照保存在完整 JSON 备份中。']).join('\n');
}
export const dateKey = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const timeText = time => { const d = new Date(time); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(value => String(value).padStart(2,'0')).join(':'); };
export const fullTime = time => `${dateKey(time)} ${timeText(time)}`;
const cell = value => String(value).replace(/\|/g, '&#124;').replace(/[\r\n]+/g, '<br>');

function researchSummary(record) {
  const stop = effectiveInitialStop(record); const conversion = effectiveBofToPbEvent(record);
  const corrected = record.researchCapture.manualEvents.some(event => event.type === 'INITIAL_STOP_CORRECTED');
  return [
    stop === null ? '' : `Initial Stop：${formatStopPrice(stop)}${corrected ? '（已修正）' : ''}`,
    conversion ? `管理变化：BOF → PB（${timeText(conversion.effectiveAt).slice(0, 5)}）` : ''
  ].filter(Boolean).join('<br>') || '—';
}
