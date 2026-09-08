// Trading Risk Manager V2 — account CRUD and risk configuration rules.
// Pure state transforms: take state, return new state. No DOM, no storage.
//
// V2 account concepts (strictly separated):
//   nominalAccountSize      — descriptive only, never decides R.
//   riskReferenceBalance    — reference principal for the Base R upgrade
//                             threshold; never auto-raised; next-session only.
//   hardLossAmount          — the total max-loss allowance; the ONLY base
//                             that scales Low/Mid/High R. Next-session only.
//   hardLossFloor (default) — external BALANCE LINE, immediate effect.

import { uid } from './utils.js';
import { computeV2Snapshot } from './risk-snapshot.js';

export const DRAW_DOWN_TYPES = ['EOD_TRAILING', 'INTRADAY_TRAILING', 'STATIC', 'NONE'];

function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

function assertValidAccountInput(input) {
  if (!input || typeof input !== 'object') throw new Error('缺少账户信息');
  if (typeof input.name !== 'string' || input.name.trim() === '') throw new Error('账户名称不能为空');
  if (!(typeof input.nominalAccountSize === 'number' && Number.isFinite(input.nominalAccountSize) && input.nominalAccountSize > 0)) {
    throw new Error('名义账户规模必须是正数');
  }
  if (!(typeof input.riskReferenceBalance === 'number' && Number.isFinite(input.riskReferenceBalance) && input.riskReferenceBalance > 0)) {
    throw new Error('风险参考余额必须是正数');
  }
  if (!(typeof input.hardLossAmount === 'number' && Number.isFinite(input.hardLossAmount) && input.hardLossAmount > 0)) {
    throw new Error('最大亏损额度必须是正数');
  }
  if (!DRAW_DOWN_TYPES.includes(input.drawdownType)) {
    throw new Error('无效的回撤类型');
  }
  if (!(typeof input.initialBalance === 'number' && Number.isFinite(input.initialBalance) && input.initialBalance > 0)) {
    throw new Error('初始余额必须是正数');
  }
  if (input.drawdownType !== 'NONE' && !(typeof input.defaultHardLossFloor === 'number' && Number.isFinite(input.defaultHardLossFloor) && input.defaultHardLossFloor > 0)) {
    throw new Error('该回撤类型需要设置 Hard Loss Floor');
  }
}

/**
 * Create an account plus its initial trading session.
 * The initial session freezes a V2 risk snapshot from the configured
 * Risk Reference Balance and Hard Loss Amount.
 */
export function createAccount(state, input) {
  assertValidAccountInput(input);
  const next = clone(state);
  const id = uid('acct');
  const account = {
    id,
    name: input.name.trim(),
    propFirm: (input.propFirm || '').trim(),
    accountType: (input.accountType || '').trim(),
    nominalAccountSize: input.nominalAccountSize,
    riskReferenceBalance: input.riskReferenceBalance,
    hardLossAmount: input.hardLossAmount,
    drawdownType: input.drawdownType,
    defaultHardLossFloor: input.drawdownType === 'NONE' ? null : input.defaultHardLossFloor,
    previousSession: null,
    currentSession: {
      id: uid('sess'),
      startedAt: new Date().toISOString(),
      previousEodBalance: input.initialBalance,
      sessionStartBalance: input.initialBalance,
      riskSnapshot: computeV2Snapshot({
        riskReferenceBalance: input.riskReferenceBalance,
        hardLossAmount: input.hardLossAmount,
        previousEodBalance: input.initialBalance,
      }),
      hardLossFloor: input.drawdownType === 'NONE' ? null : input.defaultHardLossFloor,
      balanceEvents: [],
    },
  };
  next.accounts.push(account);
  if (next.selectedAccountId === null || next.selectedAccountId === undefined) {
    next.selectedAccountId = id;
  }
  return next;
}

/**
 * Edit account fields. Risk configuration edits are NEXT-SESSION ONLY:
 * the active session's frozen riskSnapshot is never recomputed.
 * Hard Loss Floor edits are IMMEDIATE (external constraint) and sync into
 * the active session.
 */
export function updateAccountMeta(state, accountId, meta) {
  const next = clone(state);
  const acct = next.accounts.find((a) => a.id === accountId);
  if (!acct) throw new Error('账户不存在');
  if (meta.name !== undefined) {
    if (typeof meta.name !== 'string' || meta.name.trim() === '') throw new Error('账户名称不能为空');
    acct.name = meta.name.trim();
  }
  if (meta.propFirm !== undefined) acct.propFirm = String(meta.propFirm || '').trim();
  if (meta.accountType !== undefined) acct.accountType = String(meta.accountType || '').trim();
  if (meta.nominalAccountSize !== undefined) {
    const n = Number(meta.nominalAccountSize);
    if (!(Number.isFinite(n) && n > 0)) throw new Error('名义账户规模必须是正数');
    acct.nominalAccountSize = n;
  }
  if (meta.riskReferenceBalance !== undefined) {
    const n = Number(meta.riskReferenceBalance);
    if (!(Number.isFinite(n) && n > 0)) throw new Error('风险参考余额必须是正数');
    acct.riskReferenceBalance = n;
  }
  if (meta.hardLossAmount !== undefined) {
    const h = meta.hardLossAmount === null || meta.hardLossAmount === '' ? null : Number(meta.hardLossAmount);
    if (h !== null && !(Number.isFinite(h) && h > 0)) throw new Error('最大亏损额度必须是正数');
    acct.hardLossAmount = h;
  }
  if (meta.drawdownType !== undefined) {
    if (!DRAW_DOWN_TYPES.includes(meta.drawdownType)) throw new Error('无效的回撤类型');
    acct.drawdownType = meta.drawdownType;
    if (meta.drawdownType === 'NONE') {
      acct.defaultHardLossFloor = null;
      acct.currentSession.hardLossFloor = null;
    }
  }
  if (meta.defaultHardLossFloor !== undefined) {
    const f = meta.defaultHardLossFloor;
    if (f !== null && !(Number.isFinite(f) && f > 0)) throw new Error('Hard Loss Floor 必须是正数');
    if (acct.drawdownType !== 'NONE' && (f === null || f === undefined)) {
      throw new Error('该回撤类型需要设置 Hard Loss Floor');
    }
    acct.defaultHardLossFloor = f;
    if (acct.drawdownType !== 'NONE' && f !== null) {
      // Explicit user edit: sync the floor into the active session so the
      // risk calculation never sits in a CONFIG_ERROR state (IMMEDIATE rule).
      acct.currentSession.hardLossFloor = f;
    }
  }
  return next;
}

export function deleteAccount(state, accountId) {
  const next = clone(state);
  const idx = next.accounts.findIndex((a) => a.id === accountId);
  if (idx === -1) throw new Error('账户不存在');
  next.accounts.splice(idx, 1);
  if (next.selectedAccountId === accountId) {
    next.selectedAccountId = next.accounts.length > 0 ? next.accounts[0].id : null;
  }
  return next;
}

export function selectAccount(state, accountId) {
  const next = clone(state);
  if (!next.accounts.some((a) => a.id === accountId)) throw new Error('账户不存在');
  next.selectedAccountId = accountId;
  return next;
}
