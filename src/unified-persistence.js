import { copy, createWorkspace, assertState } from './model.js';
import { deserialize, makeEnvelope, validateEnvelope, MAX_FILE_BYTES } from './persistence.js';
import { DRAW_DOWN_TYPES } from './risk-manager/account-service.js';
import { migrateState, RISK_MANAGER_SCHEMA_VERSION } from './risk-manager/migration.js';

export const UNIFIED_KEY = 'trading-control-center:v1';
export const PRE_IMPORT_KEY = 'trading-control-center:v1:pre-import';
export const LEGACY_INTRADAY_KEY = 'intraday-task-cards:v1:state';
export const LEGACY_RISK_KEY = 'trading-risk-manager:v1';
export const LEGACY_APPEARANCE_KEY = 'trading-risk-manager:appearance';
const blankRisk = () => ({ schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] });
const appearance = value => value === 'light' || value === 'dark' ? value : 'system';

export function makeUnified(intraday = makeEnvelope(createWorkspace()), riskManager = blankRisk(), preferences = {}) {
  assertState(intraday.state); validateRisk(riskManager);
  return { app: 'trading-control-center', schemaVersion: 1, savedAt: Date.now(), timezone: 'Asia/Shanghai', revision: 0, sections: { intraday: copy(intraday), riskManager: copy(riskManager) }, preferences: { appearance: appearance(preferences.appearance) } };
}

const fail = (message, path, code = 'RISK_VALIDATION_ERROR') => { throw Object.assign(new Error(message), { path, code }); };
const iso = (value, path) => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) fail('时间戳无效', path); };
const finite = (value, path) => { if (!(typeof value === 'number' && Number.isFinite(value))) fail('金额无效', path); };
const positive = (value, path) => { finite(value, path); if (value <= 0) fail('金额必须为正数', path); };
const nullablePositive = (value, path) => { if (value !== null) positive(value, path); };
const nonEmptyId = (value, path, label) => { if (typeof value !== 'string' || value.trim() === '') fail(`${label} ID 无效`, path); };
const string = (value, path, label, required = false) => { if (typeof value !== 'string' || (required && value.trim() === '')) fail(`${label}无效`, path); };

function validateSnapshot(snapshot, path) {
  if (!snapshot || typeof snapshot !== 'object' || ![1, 2].includes(snapshot.version)) fail('风险快照无效', path);
  ['lowR', 'midR', 'highR', 'baseUpgradeThreshold', 'baseR'].forEach(key => positive(snapshot[key], `${path}.${key}`));
  if (!(snapshot.lowR <= snapshot.midR && snapshot.midR <= snapshot.highR)) fail('风险快照档位顺序无效', `${path}.lowR`);
  if (snapshot.baseR !== snapshot.lowR && snapshot.baseR !== snapshot.midR) fail('风险快照 Base R 无效', `${path}.baseR`);
  if (snapshot.version === 1) {
    positive(snapshot.sessionRiskBaseCapital, `${path}.sessionRiskBaseCapital`);
    if (snapshot.baseUpgradeCushion !== null) fail('V1 快照升级缓冲应为 null', `${path}.baseUpgradeCushion`);
  } else {
    positive(snapshot.sessionRiskReferenceBalance, `${path}.sessionRiskReferenceBalance`);
    positive(snapshot.sessionHardLossAmount, `${path}.sessionHardLossAmount`);
    positive(snapshot.baseUpgradeCushion, `${path}.baseUpgradeCushion`);
  }
}
export function validateRisk(state) {
  if (!state || state.schemaVersion !== RISK_MANAGER_SCHEMA_VERSION || !Array.isArray(state.accounts)) fail('风险管理器版本或账户数据无效', 'sections.riskManager');
  if (state.selectedAccountId !== null && typeof state.selectedAccountId !== 'string') fail('选中账户 ID 无效', 'sections.riskManager.selectedAccountId');
  const ids = new Set(); const sessionIds = new Set(); const eventIds = new Set();
  state.accounts.forEach((account, accountIndex) => {
    const base = `sections.riskManager.accounts[${accountIndex}]`;
    if (!account || typeof account !== 'object') fail('账户无效', base);
    nonEmptyId(account.id, `${base}.id`, '账户'); if (ids.has(account.id)) fail('账户 ID 重复或无效', `${base}.id`);
    ids.add(account.id); const session = account.currentSession;
    string(account.name, `${base}.name`, '账户名称', true); string(account.propFirm, `${base}.propFirm`, 'Prop Firm'); string(account.accountType, `${base}.accountType`, '账户类型');
    positive(account.nominalAccountSize, `${base}.nominalAccountSize`); positive(account.riskReferenceBalance, `${base}.riskReferenceBalance`); nullablePositive(account.hardLossAmount, `${base}.hardLossAmount`);
    if (!DRAW_DOWN_TYPES.includes(account.drawdownType)) fail('回撤类型无效', `${base}.drawdownType`);
    nullablePositive(account.defaultHardLossFloor, `${base}.defaultHardLossFloor`);
    if (account.drawdownType === 'NONE' && account.defaultHardLossFloor !== null) fail('无回撤限制账户的默认 Floor 必须为 null', `${base}.defaultHardLossFloor`);
    if (!session || typeof session !== 'object') fail('当前时段无效', `${base}.currentSession`);
    nonEmptyId(session.id, `${base}.currentSession.id`, '当前时段'); if (sessionIds.has(session.id)) fail('当前时段 ID 重复或无效', `${base}.currentSession.id`);
    sessionIds.add(session.id);
    iso(session.startedAt, `${base}.currentSession.startedAt`);
    ['previousEodBalance', 'sessionStartBalance'].forEach(key => positive(session[key], `${base}.currentSession.${key}`));
    nullablePositive(session.hardLossFloor, `${base}.currentSession.hardLossFloor`);
    if (account.drawdownType === 'NONE' && session.hardLossFloor !== null) fail('无回撤限制账户的当前 Floor 必须为 null', `${base}.currentSession.hardLossFloor`);
    validateSnapshot(session.riskSnapshot, `${base}.currentSession.riskSnapshot`);
    if (!Array.isArray(session.balanceEvents)) fail('余额事件必须为数组', `${base}.currentSession.balanceEvents`);
    if (account.previousSession !== null && account.previousSession !== undefined) {
      const previous = account.previousSession;
      if (!previous || typeof previous !== 'object') fail('历史时段无效', `${base}.previousSession`);
      nonEmptyId(previous.id, `${base}.previousSession.id`, '历史时段'); if (sessionIds.has(previous.id)) fail('历史时段 ID 重复或无效', `${base}.previousSession.id`);
      sessionIds.add(previous.id); iso(previous.endedAt, `sections.riskManager.accounts[${accountIndex}].previousSession.endedAt`);
      ['endBalance', 'peakRealizedBalance'].forEach(key => positive(previous[key], `sections.riskManager.accounts[${accountIndex}].previousSession.${key}`));
      finite(previous.peakRealizedProfit, `${base}.previousSession.peakRealizedProfit`);
    }
    let balance = session.sessionStartBalance;
    session.balanceEvents.forEach((event, eventIndex) => {
      const eventPath = `${base}.currentSession.balanceEvents[${eventIndex}]`;
      if (!event || typeof event !== 'object') fail('余额事件无效', eventPath);
      nonEmptyId(event.id, `${eventPath}.id`, '余额事件'); if (eventIds.has(event.id)) fail('余额事件 ID 重复或无效', `${eventPath}.id`); eventIds.add(event.id); iso(event.timestamp, `${eventPath}.timestamp`);
      ['previousBalance', 'newBalance'].forEach(key => positive(event[key], `${eventPath}.${key}`)); finite(event.delta, `${eventPath}.delta`);
      if (Math.abs(event.previousBalance - balance) > 1e-9) fail('余额事件链断裂', `${eventPath}.previousBalance`);
      if (Math.abs(event.delta - (event.newBalance - event.previousBalance)) > 1e-9) fail('余额事件 delta 无效', `${eventPath}.delta`); balance = event.newBalance;
    });
  });
  if (state.selectedAccountId !== null && !ids.has(state.selectedAccountId)) fail('选中账户不存在', 'sections.riskManager.selectedAccountId');
  return true;
}

export function validateUnified(value) {
  if (!value || value.app !== 'trading-control-center' || value.schemaVersion !== 1 || !value.sections) throw Object.assign(new Error('不是受支持的统一备份'), { path: 'envelope' });
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw Object.assign(new Error('revision 无效'), { path: 'revision' });
  if (!(typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)) || typeof value.timezone !== 'string') throw Object.assign(new Error('统一存档时间或时区无效'), { path: 'envelope' });
  validateEnvelope(value.sections.intraday); assertState(value.sections.intraday?.state); validateRisk(value.sections.riskManager); if (!value.preferences || !['system', 'light', 'dark'].includes(value.preferences.appearance)) throw Object.assign(new Error('外观偏好无效'), { path: 'preferences.appearance' }); return true;
}

export function classifyBackup(value) {
  const matches = [value?.app === 'trading-control-center' && !!value.sections, value?.app === 'intraday-task-cards' && !!value.state, (value?.app === undefined || value?.app === 'intraday-task-cards') && Number.isInteger(value?.schemaVersion) && Array.isArray(value?.accounts) && Object.hasOwn(value, 'selectedAccountId')].filter(Boolean).length;
  if (matches !== 1) throw new Error(matches ? '备份格式歧义' : '无法识别备份格式');
  return value.app === 'trading-control-center' ? 'unified' : value.app === 'intraday-task-cards' ? 'intraday' : 'risk';
}

export function parseBackupRaw(raw) {
  if (typeof raw !== 'string') throw Object.assign(new Error('备份内容必须是文本'), { code: 'JSON_PARSE_ERROR', path: 'raw' });
  if (new TextEncoder().encode(raw).byteLength > MAX_FILE_BYTES) throw Object.assign(new Error('文件超过 8 MB 限制'), { code: 'FILE_TOO_LARGE', path: 'raw' });
  try { return JSON.parse(raw); } catch (cause) { throw Object.assign(new Error('备份 JSON 无法解析'), { code: 'JSON_PARSE_ERROR', path: 'raw', cause }); }
}

export function normalizeImport(value, current) {
  const kind = classifyBackup(value); let next;
  if (kind === 'unified') { validateUnified(value); next = copy(value); }
  else if (kind === 'intraday') { const intraday = deserialize(JSON.stringify(value)); next = copy(current); next.sections.intraday = intraday; }
  else { const risk = migrateState(value); validateRisk(risk); next = copy(current); next.sections.riskManager = risk; }
  next.preferences = { appearance: appearance(next.preferences?.appearance) }; validateUnified(next); return { kind, state: next, summary: importSummary(kind, next) };
}

export function importSummary(kind, state) {
  const cards = Object.keys(state.sections.intraday.state.cards || {}).length;
  const records = state.sections.intraday.state.records?.length || 0;
  const accounts = state.sections.riskManager.accounts?.length || 0;
  return kind === 'unified' ? `将替换状态卡（${cards} 张、${records} 条记录）、风险管理器（${accounts} 个账户）及外观偏好。` : kind === 'intraday' ? `将只替换状态卡（${cards} 张、${records} 条记录）；账户和外观保持不变。` : `将只替换风险管理器（${accounts} 个账户）；状态卡和外观保持不变。`;
}

export function loadUnified(storage) {
  if (!storage?.getItem) return { state: makeUnified(), source: 'storage-unavailable' };
  let raw; try { raw = storage.getItem(UNIFIED_KEY); } catch (error) { return { state: makeUnified(), source: 'storage-unavailable', error }; }
  if (raw !== null && raw !== undefined) { try { const parsed = JSON.parse(raw); validateUnified(parsed); let notice = ''; try { const legacyRaw = storage.getItem(LEGACY_INTRADAY_KEY); const legacy = legacyRaw ? JSON.parse(legacyRaw) : null; if (Number.isSafeInteger(legacy?.savedAt) && legacy.savedAt > parsed.savedAt) notice = '检测到时间更新的旧状态卡存档；为避免双源覆盖，当前仍只读取统一存档。'; } catch (_) {} return { state: parsed, source: 'canonical', raw, notice }; } catch (error) { return { state: null, source: 'recovery-required', error, raw }; } }
  let intradayRaw; let riskRaw; let preference;
  try { intradayRaw = storage.getItem(LEGACY_INTRADAY_KEY); riskRaw = storage.getItem(LEGACY_RISK_KEY); preference = storage.getItem(LEGACY_APPEARANCE_KEY); } catch (error) { return { state: makeUnified(), source: 'storage-unavailable', error }; }
  if (intradayRaw === null && riskRaw === null) return { state: makeUnified(undefined, blankRisk(), { appearance: preference }), source: 'blank' };
  try { const intraday = intradayRaw === null ? makeEnvelope(createWorkspace()) : deserialize(intradayRaw); const risk = riskRaw === null ? blankRisk() : migrateState(JSON.parse(riskRaw)); validateRisk(risk); return { state: makeUnified(intraday, risk, { appearance: preference }), source: 'legacy' }; }
  catch (error) { return { state: null, source: 'recovery-required', error, raw: JSON.stringify({ intradayRaw, riskRaw, preference }) }; }
}

export function commitUnified(storage, state, { preImport = false, expectedRaw } = {}) {
  validateUnified(state); const next = copy(state); next.revision += 1; next.savedAt = Date.now(); const raw = JSON.stringify(next);
  if (!storage?.setItem || !storage?.getItem) throw Object.assign(new Error('本地存储不可用'), { code: 'STORAGE_UNAVAILABLE' });
  let prior;
  try { prior = storage.getItem(UNIFIED_KEY); } catch (cause) { throw Object.assign(new Error('读取统一存档失败'), { code: 'STORAGE_READ_FAILED', cause }); }
  if (expectedRaw !== undefined && prior !== expectedRaw) throw Object.assign(new Error('导入确认期间存档已被其他页面修改'), { code: 'REVISION_CONFLICT' });
  if (preImport) {
    try { storage.setItem(PRE_IMPORT_KEY, prior ?? ''); } catch (cause) { throw Object.assign(new Error('导入前快照写入失败'), { code: 'PRE_IMPORT_SNAPSHOT_FAILED', cause }); }
    try { if (storage.getItem(PRE_IMPORT_KEY) !== (prior ?? '')) throw new Error('导入前快照回读失败'); } catch (cause) { throw Object.assign(new Error('导入前快照回读失败'), { code: 'PRE_IMPORT_SNAPSHOT_FAILED', cause }); }
  }
  try { storage.setItem(UNIFIED_KEY, raw); } catch (cause) { throw Object.assign(new Error('统一存档写入失败'), { code: 'CANONICAL_WRITE_FAILED', cause }); }
  let stored;
  try { stored = storage.getItem(UNIFIED_KEY); } catch (cause) { throw Object.assign(new Error('统一存档回读失败'), { code: 'POST_WRITE_MISMATCH', cause }); }
  if (stored !== raw) throw Object.assign(new Error('统一存档回读失败；已安全停止继续修改'), { code: 'POST_WRITE_MISMATCH' });
  return next;
}
