import { assertState, copy } from './model.js';

export const APP_ID = 'intraday-task-cards';
export const SCHEMA_VERSION = 3;
export const STORE_KEY = 'intraday-task-cards:v1:state';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

export function makeEnvelope(state, savedAt = Date.now()) {
  assertState(state);
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, savedAt, state: copy(state), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser-local' };
}
export function validateEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || envelope.schemaVersion !== SCHEMA_VERSION || !Number.isSafeInteger(envelope.savedAt) || typeof envelope.timezone !== 'string') throw Object.assign(new Error('不是受支持的状态卡备份，或版本不兼容'), { code: 'SCHEMA_ERROR', path: 'envelope' });
  assertState(envelope.state); return true;
}
export function serialize(state, savedAt = Date.now()) { return JSON.stringify(makeEnvelope(state, savedAt)); }
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_FILE_BYTES) throw new Error('存档为空或超过 8 MB');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { throw Object.assign(new Error('存档 JSON 无法解析', { cause: error }), { code: 'JSON_PARSE_ERROR', path: 'raw' }); }
  let envelope;
  try { envelope = migrateEnvelope(parsed); } catch (error) { throw Object.assign(new Error('存档迁移失败', { cause: error }), { code: 'MIGRATION_ERROR', path: 'envelope' }); }
  validateEnvelope(envelope); return envelope;
}
export function exportMarkdown(state, scope = 'today', now = Date.now()) {
  assertState(state); const day = dateKey(now);
  const rows = state.records.filter(record => scope === 'all' || record.endedAt === null || dateKey(record.registeredAt) === day || dateKey(record.endedAt) === day).sort((a,b) => b.registeredAt - a.registeredAt);
  const lines = [`# 日内机会记录 · ${scope === 'all' ? '全部保留记录' : day}`, '', `导出时间：${fullTime(now)}`, '', '> 仅手动任务记录；不读取行情、订单或成交。入场确认即已执行，全部平仓才结束。', '', '| 登记时间 | 品种 | 交易方向 | 机会 | 已确认关键位置 | 登记时偏见 / 3M市场结构 | 进展／结果 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) lines.push(`| ${fullTime(r.registeredAt)} | ${r.symbol} | ${r.direction === 'long' ? '多' : '空'} | ${({pullback:'趋势回调',range:'区间反转',reversal:'趋势反转'})[r.type]} | ${cell(r.zone)} | 偏见：${({bullish:'偏多',neutral:'无偏见',bearish:'偏空'})[r.biasAtRegistration]}<br>3M市场结构：${({unjudged:'未判断',bullish:'多头',range:'震荡',bearish:'空头'})[r.structure3mAtRegistration]} | ${r.endedAt !== null ? ({invalid:'失效',canceled:'已取消',direction:'方向改变结束',closed:'已平仓'})[r.reason] : r.enteredAt !== null ? '持仓中' : '已登记'} |`);
  if (!rows.length) lines.push('', '本范围内尚无已登记且仍保留的记录。');
  return lines.concat(['', '---', '阶段起止时间和当前任务草稿保存在完整 JSON 备份中。']).join('\n');
}
export const dateKey = time => { const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const timeText = time => { const d = new Date(time); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(value => String(value).padStart(2,'0')).join(':'); };
export const fullTime = time => `${dateKey(time)} ${timeText(time)}`;
const cell = value => String(value).replace(/\|/g, '&#124;').replace(/[\r\n]+/g, '<br>');

function migrateEnvelope(envelope) {
  if (!envelope || envelope.app !== APP_ID || ![1, 2].includes(envelope.schemaVersion)) return envelope;
  const migrated = copy(envelope);
  if (migrated.schemaVersion === 1) migrateV1ToV2(migrated);
  if (migrated.schemaVersion === 2) migrateV2ToV3(migrated);
  return migrated;
}

function migrateV1ToV2(migrated) {
  const state = migrated.state;
  if (!state || !state.cards || !Array.isArray(state.records)) return;
  state.schemaVersion = 2;
  for (const card of Object.values(state.cards)) {
    card.bias = 'neutral'; card.structure3m = 'unjudged';
    card.needsStructureReview = Boolean(card.opportunity && card.opportunity.enteredAt === null);
    if (!card.opportunity) card.direction = 'none';
    if (card.opportunity) {
      card.opportunity.biasAtRegistration = card.opportunity.registeredAt === null ? null : 'neutral';
      card.opportunity.structure3mAtRegistration = card.opportunity.registeredAt === null ? null : 'unjudged';
      card.opportunity.invalidReason = null;
    }
  }
  for (const record of state.records) {
    record.biasAtRegistration = 'neutral'; record.structure3mAtRegistration = 'unjudged'; record.invalidReason = null;
  }
  migrated.schemaVersion = 2;
}

function migrateV2ToV3(migrated) {
  const state = migrated.state;
  if (!state || !state.cards || !Array.isArray(state.records)) return;
  state.schemaVersion = 3;
  for (const card of Object.values(state.cards)) if (card.opportunity) migrateOpportunity(card.opportunity);
  for (const record of state.records) migrateOpportunity(record);
  migrated.schemaVersion = 3;
}

function migrateOpportunity(opportunity) {
  if (!opportunity || typeof opportunity !== 'object') return;
  if (opportunity.attention === 'near') opportunity.attention = 'wait';
  if (!Array.isArray(opportunity.stages)) return;
  const stages = [];
  for (const source of opportunity.stages) {
    const stage = source && typeof source === 'object' ? { ...source, state: source.state === 'near' ? 'wait' : source.state } : source;
    const previous = stages.at(-1);
    if (previous?.state === 'wait' && stage?.state === 'wait' && previous.end === stage.start) previous.end = stage.end;
    else stages.push(stage);
  }
  opportunity.stages = stages;
  if (stages.length) opportunity.stageSince = stages.at(-1).start;
}
