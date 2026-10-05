import { intradayV6 } from './intraday-v6/index.js';
import { assertLegacyState, assertV4State, copy, DIRECTIONS, LEGACY_SCHEMA_VERSION, V4_SCHEMA_VERSION, SCHEMA_VERSION, migrateWorkspace, setupLabel, recordProgress, effectiveInitialStop, effectiveBofToPbEvent, formatStopPrice } from './model.js';

export const APP_ID = 'intraday-task-cards';
export const STORE_KEY = 'intraday-task-cards:v1:state';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const validSavedAt = value => Number.isSafeInteger(value) && value >= 0;
const persistenceError = (message, path) => Object.assign(new Error(message), { code: 'SCHEMA_ERROR', path });

export function makeEnvelope(state, savedAt = Date.now()) {
  intradayV6.assertV6State(state);
  if (!validSavedAt(savedAt)) throw persistenceError('状态卡保存时间无效', 'savedAt');
  return { app: APP_ID, schemaVersion: 6, savedAt, state: copy(state), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser-local' };
}

export function validateEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || envelope.schemaVersion !== 6 || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('不是受支持的 V6 状态卡备份，或版本不兼容', 'envelope');
  intradayV6.assertV6State(envelope.state); return true;
}

function validateLegacyEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || envelope.schemaVersion !== LEGACY_SCHEMA_VERSION || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('不是受支持的 V3 状态卡迁移输入', 'envelope');
  assertLegacyState(envelope.state); return true;
}

export function migrateEnvelope(envelope, migratedAt) {
  if (envelope?.schemaVersion === 6) { validateEnvelope(envelope); return { envelope, migrated: false, audits: [] }; }
  if (!envelope || envelope.app !== APP_ID || !validSavedAt(envelope.savedAt) || typeof envelope.timezone !== 'string') throw persistenceError('旧版状态卡迁移输入无效', 'envelope');
  const fromVersion = envelope.schemaVersion;
  let legacy;
  if (fromVersion === SCHEMA_VERSION) { legacy = { state: envelope.state, audits: [] }; }
  else {
    if (fromVersion === V4_SCHEMA_VERSION) assertV4State(envelope.state);
    else validateLegacyEnvelope(envelope);
    legacy = migrateWorkspace(envelope.state, envelope.savedAt);
  }
  const result = intradayV6.migrateV5ToV6(legacy.state, { migratedAt });
  const migrated = { ...copy(envelope), schemaVersion: 6, state: result.state };
  validateEnvelope(migrated);
  return { envelope: migrated, migrated: true, migratedAt, fromVersion, audits: [...legacy.audits, ...result.audits] };
}

export function serialize(state, savedAt = Date.now()) { return JSON.stringify(makeEnvelope(state, savedAt)); }
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FILE_BYTES) throw new Error('存档为空或超过 8 MB');
  let envelope;
  try { envelope = JSON.parse(raw); } catch (error) { throw Object.assign(new Error('存档 JSON 无法解析', { cause: error }), { code: 'JSON_PARSE_ERROR', path: 'raw' }); }
  validateEnvelope(envelope); return envelope;
}

export function exportMarkdown(state, scope = 'today', now = Date.now()) {
  intradayV6.assertV6State(state); const day = dateKey(now);
  const rows = state.records.filter(record => scope === 'all' || record.endedAt === null || dateKey(record.registeredAt) === day || (record.endedAt !== null && dateKey(record.endedAt) === day)).sort((a,b) => b.registeredAt - a.registeredAt);
  const lines = [`# 日内机会记录 · ${scope === 'all' ? '全部保留记录' : day}`, '', `导出时间：${fullTime(now)}`, '', '> 仅手动任务记录；不读取行情、订单或成交。新机会选择即登记，HTML 入场与退出仅为人工确认时间；单笔退出或全部平仓分别结束目标交易。', '', '| 登记时间 | 品种 | 交易方向 | 机会 | 已确认关键位置 | 登记时偏见 / 市场结构 | 进展／结果 | Research Capture |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const record of rows) {
    const direction = DIRECTIONS[record.direction] || (record.direction === 'long' ? '做多' : '做空');
    const structure = ({ unjudged: '未判断', bullish: '多头', range: '震荡', bearish: '空头' })[record.structure3mAtRegistration] || record.structure3mAtRegistration;
    lines.push(`| ${fullTime(record.registeredAt)} | ${record.symbol} | ${direction} | ${setupLabel(record.type)} | ${cell(record.zone ?? '—')} | 偏见：${({ bullish: '偏多', neutral: '无偏见', bearish: '偏空' })[record.biasAtRegistration]}<br>市场结构：${structure} | ${captureRecordProgress(record)} | ${researchSummary(record)} |`);
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

export function captureRecordProgress(record) {
  if (record.endedAt === null) return record.enteredAt === null ? '已登记' : '持仓中';
  return ({ closed: '已平仓', invalid: '机会失效', canceled: '已放弃', direction: '方向改变', rules_upgrade: '规则升级' })[record.reason] || recordProgress(record);
}

export function captureMigrationMessage(error) {
  return ({ ACTIVE_RECORD_CONFLICT_IN_V5: '活动任务与历史记录冲突', V5_ZONE_DRAFT_REQUIRES_REVIEW: '未确认的位置草稿需要人工检查', V6_MIGRATION_CANDIDATE_INVALID: '旧记录的时间或结构无法安全升级', INVALID_V5_STATE: '旧版交易数据未通过校验', REVISION_CONFLICT: '其他页面已修改存档，请刷新后重新确认', PRE_UPGRADE_SNAPSHOT_FAILED: '升级前备份无法保存', CANONICAL_UPGRADE_FAILED: '升级写入失败，原存档已恢复', UPGRADE_ROLLBACK_FAILED: '无法确认升级回滚，请导出原始数据检查' })[error?.code] || '存档无法安全读取或升级';
}
