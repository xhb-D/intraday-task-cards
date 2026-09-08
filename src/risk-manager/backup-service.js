// Trading Risk Manager V2 — JSON export/import and full-state validation.
// Import is two-phase: parse -> migrate -> validate -> (preview/confirm) -> replace.
// If any phase fails, current state is never touched.
//
// V1 backups (schemaVersion 1) are accepted and auto-migrated to V2 —
// legacy JSON never loses data because of a missing hardLossAmount.

import { DRAW_DOWN_TYPES } from './account-service.js';
import { migrateState, RISK_MANAGER_SCHEMA_VERSION } from './migration.js';

const SUPPORTED_SCHEMA_VERSIONS = [1, RISK_MANAGER_SCHEMA_VERSION];

/** Backup filename: trading-risk-manager-backup-YYYY-MM-DD-HHmm.json */
export function buildExportFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `trading-risk-manager-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}.json`
  );
}

/** Serialize complete app state to JSON. */
export function exportAppState(state) {
  return JSON.stringify(state, null, 2);
}

function isFinitePositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function validateEvent(evt, errors, path) {
  if (!evt || typeof evt !== 'object') { errors.push(`${path}: 事件必须为对象`); return; }
  if (!isFinitePositive(evt.newBalance)) errors.push(`${path}.newBalance: 必须是正数`);
  if (evt.previousBalance !== null && !isFinitePositive(evt.previousBalance)) errors.push(`${path}.previousBalance: 必须是正数`);
  if (typeof evt.delta !== 'number' || !Number.isFinite(evt.delta)) errors.push(`${path}.delta: 必须是数字`);
}

function validateSnapshot(snapshot, errors, path) {
  if (!snapshot || typeof snapshot !== 'object') { errors.push(`${path}: 缺少风险快照`); return; }
  if (snapshot.version !== 1 && snapshot.version !== 2) errors.push(`${path}.version: 必须是 1 或 2`);
  for (const key of ['lowR', 'midR', 'highR', 'baseR']) {
    if (!isFinitePositive(snapshot[key])) errors.push(`${path}.${key}: 必须是正数`);
  }
  if (snapshot.version === 2 && !isFinitePositive(snapshot.sessionHardLossAmount)) {
    errors.push(`${path}.sessionHardLossAmount: 必须是正数`);
  }
}

function validateSession(session, errors, path) {
  if (!session || typeof session !== 'object') { errors.push(`${path}: 缺少当前时段`); return; }
  if (typeof session.id !== 'string' || session.id === '') errors.push(`${path}.id: 必须是非空字符串`);
  if (!isFinitePositive(session.previousEodBalance)) errors.push(`${path}.previousEodBalance: 必须是正数`);
  if (!isFinitePositive(session.sessionStartBalance)) errors.push(`${path}.sessionStartBalance: 必须是正数`);
  if (!Array.isArray(session.balanceEvents)) {
    errors.push(`${path}.balanceEvents: 必须是数组`);
  } else {
    session.balanceEvents.forEach((evt, i) => validateEvent(evt, errors, `${path}.balanceEvents[${i}]`));
  }
  const floor = session.hardLossFloor;
  if (floor !== null && !isFinitePositive(floor)) errors.push(`${path}.hardLossFloor: 必须是正数或 null`);
  validateSnapshot(session.riskSnapshot, errors, `${path}.riskSnapshot`);
}

function validateAccount(acct, errors, path) {
  if (!acct || typeof acct !== 'object') { errors.push(`${path}: 账户必须为对象`); return; }
  if (typeof acct.id !== 'string' || acct.id === '') errors.push(`${path}.id: 必须是非空字符串`);
  if (typeof acct.name !== 'string' || acct.name.trim() === '') errors.push(`${path}.name: 不能为空`);
  if (!isFinitePositive(acct.nominalAccountSize)) errors.push(`${path}.nominalAccountSize: 必须是正数`);
  if (!isFinitePositive(acct.riskReferenceBalance)) errors.push(`${path}.riskReferenceBalance: 必须是正数`);
  const hardLoss = acct.hardLossAmount;
  if (hardLoss !== null && !isFinitePositive(hardLoss)) errors.push(`${path}.hardLossAmount: 必须是正数或 null`);
  if (!DRAW_DOWN_TYPES.includes(acct.drawdownType)) errors.push(`${path}.drawdownType: 无效的回撤类型`);
  const floor = acct.defaultHardLossFloor;
  if (floor !== null && !isFinitePositive(floor)) errors.push(`${path}.defaultHardLossFloor: 必须是正数或 null`);
  validateSession(acct.currentSession, errors, `${path}.currentSession`);
}

/**
 * Validate a full backup. Returns { ok: true, state } or { ok: false, error }.
 * V1 backups are migrated first; validation runs on the migrated V2 state.
 * Pure validation — never mutates anything.
 */
export function validateImport(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '备份内容必须是对象' };
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) {
    return { ok: false, error: `不支持的 schemaVersion: ${parsed.schemaVersion}（支持 ${SUPPORTED_SCHEMA_VERSIONS.join(' / ')}）` };
  }
  const state = migrateState(parsed);
  if (state.schemaVersion !== RISK_MANAGER_SCHEMA_VERSION) {
    return { ok: false, error: `迁移失败: schemaVersion ${state.schemaVersion}` };
  }
  if (state.selectedAccountId !== null && typeof state.selectedAccountId !== 'string') {
    return { ok: false, error: 'selectedAccountId 必须是字符串或 null' };
  }
  if (!Array.isArray(state.accounts)) {
    return { ok: false, error: 'accounts 必须是数组' };
  }
  const errors = [];
  state.accounts.forEach((acct, i) => validateAccount(acct, errors, `accounts[${i}]`));
  if (state.selectedAccountId !== null && !state.accounts.some((a) => a.id === state.selectedAccountId)) {
    errors.push('selectedAccountId 指向不存在的账户');
  }
  if (errors.length > 0) {
    return { ok: false, error: `校验失败:\n- ${errors.join('\n- ')}` };
  }
  return { ok: true, state };
}

/**
 * Import a backup: migrate + validate first; only then return the
 * replacement state. Throws on invalid import — the caller keeps the
 * current state untouched.
 */
export function importAppState(state, raw) {
  const res = validateImport(raw);
  if (!res.ok) throw new Error(res.error);
  return res.state;
}
