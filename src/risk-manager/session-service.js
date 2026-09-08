// Trading Risk Manager V2 — session lifecycle:
// new session, realized-balance events, undo, Hard Loss Floor update rules.
// Source of truth: sessionStartBalance + balanceEvents + FROZEN riskSnapshot.
// Derived state is always recomputed from history (deterministic undo/replay).
//
// Session rules (V2):
//   - The risk snapshot is frozen at session start; Risk Reference Balance
//     and Hard Loss Amount changes apply to the NEXT session only.
//   - A session cannot start without a configured Hard Loss Amount.
//   - Hard Loss Floor edits apply IMMEDIATELY (external constraint).

import { uid } from './utils.js';
import { calculateRiskDecision } from './risk-engine.js';
import { computeV2Snapshot } from './risk-snapshot.js';

/** Current realized balance = last event's newBalance, else session start. */
export function deriveCurrentBalance(session) {
  const events = session.balanceEvents || [];
  return events.length > 0 ? events[events.length - 1].newBalance : session.sessionStartBalance;
}

/** Normalize an account's active session into the engine input shape. */
export function deriveEngineInput(account) {
  const s = account.currentSession;
  return {
    sessionStartBalance: s.sessionStartBalance,
    previousEodBalance: s.previousEodBalance,
    tierSnapshot: s.riskSnapshot,
    currentRealizedBalance: deriveCurrentBalance(s),
    balanceHistory: s.balanceEvents || [],
    drawdownType: account.drawdownType,
    hardLossFloor: s.hardLossFloor,
  };
}

/** Compute the full risk decision for an account's active session. */
export function deriveDecision(account) {
  return calculateRiskDecision(deriveEngineInput(account));
}

/**
 * Append a realized balance update.
 * previousBalance MUST equal the currently derived balance (spec 03 §5).
 */
export function addBalanceUpdate(state, accountId, newBalance) {
  const value = Number(newBalance);
  if (!(Number.isFinite(value) && value > 0)) throw new Error('余额必须是正数');
  const next = JSON.parse(JSON.stringify(state));
  const acct = next.accounts.find((a) => a.id === accountId);
  if (!acct) throw new Error('账户不存在');
  const session = acct.currentSession;
  const previous = deriveCurrentBalance(session);
  if (Math.abs(value - previous) < 1e-9) throw new Error('余额未发生变化');
  session.balanceEvents.push({
    id: uid('evt'),
    timestamp: new Date().toISOString(),
    previousBalance: previous,
    newBalance: value,
    delta: value - previous,
  });
  return next;
}

/** Remove the final balance event and rederive all state (spec 03 §6). */
export function undoLastBalanceUpdate(state, accountId) {
  const next = JSON.parse(JSON.stringify(state));
  const acct = next.accounts.find((a) => a.id === accountId);
  if (!acct) throw new Error('账户不存在');
  acct.currentSession.balanceEvents.pop();
  return next;
}

/**
 * Start a new trading session (explicit user action only; no clock reset).
 * previousEodBalance defaults to the prior session's final realized balance;
 * startBalance defaults to previousEodBalance and may be corrected by the user.
 * The V2 risk snapshot is frozen here from the CURRENT configured
 * Risk Reference Balance + Hard Loss Amount (next-session rule).
 */
export function startNewSession(state, accountId, opts = {}) {
  const next = JSON.parse(JSON.stringify(state));
  const acct = next.accounts.find((a) => a.id === accountId);
  if (!acct) throw new Error('账户不存在');
  if (!(typeof acct.hardLossAmount === 'number' && Number.isFinite(acct.hardLossAmount) && acct.hardLossAmount > 0)) {
    throw new Error('请先设置最大亏损额度。');
  }
  const old = acct.currentSession;

  // Archive a compact summary of the ending session (allowed by spec 03 §7).
  const oldDecision = deriveDecision(acct);
  acct.previousSession = {
    id: old.id,
    endedAt: new Date().toISOString(),
    endBalance: deriveCurrentBalance(old),
    peakRealizedBalance: oldDecision.peakRealizedBalance,
    peakRealizedProfit: oldDecision.peakRealizedProfit,
  };

  const previousEod = opts.previousEodBalance !== undefined ? opts.previousEodBalance : deriveCurrentBalance(old);
  const startBalance = opts.startBalance !== undefined ? opts.startBalance : previousEod;
  for (const [label, v] of [['previousEodBalance', previousEod], ['startBalance', startBalance]]) {
    if (!(Number.isFinite(v) && v > 0)) throw new Error(`${label} 必须是正数`);
  }

  // Hard Loss Floor for the new session (per drawdown type rules).
  let floor = opts.hardLossFloor !== undefined ? opts.hardLossFloor : acct.defaultHardLossFloor;
  if (acct.drawdownType === 'NONE') floor = null;
  if (acct.drawdownType !== 'NONE' && !(Number.isFinite(floor) && floor > 0)) {
    throw new Error('该回撤类型需要确认新时段的 Hard Loss Floor');
  }

  acct.currentSession = {
    id: uid('sess'),
    startedAt: new Date().toISOString(),
    previousEodBalance: previousEod,
    sessionStartBalance: startBalance,
    riskSnapshot: computeV2Snapshot({
      riskReferenceBalance: acct.riskReferenceBalance,
      hardLossAmount: acct.hardLossAmount,
      previousEodBalance: previousEod,
    }),
    hardLossFloor: floor,
    balanceEvents: [],
  };
  return next;
}

/**
 * Build the next trading-day session for one account (V2.1 global rollover).
 * Pure construction: never mutates the account. Throws with a clear Chinese
 * reason when the account cannot start a new trading day. The conditions are
 * exactly the ones startNewSession enforces — nothing new is invented.
 *
 * Global rollover semantics (fixed): Previous EOD and Session Start both equal
 * the current realized balance; the V2 snapshot is frozen from the account's
 * LATEST configuration (next-session rule).
 */
function buildRolledOverSession(acct) {
  const old = acct.currentSession;
  const current = deriveCurrentBalance(old);
  if (!(Number.isFinite(current) && current > 0)) {
    throw new Error('当前已实现余额无效');
  }
  if (!(typeof acct.hardLossAmount === 'number' && Number.isFinite(acct.hardLossAmount) && acct.hardLossAmount > 0)) {
    throw new Error('最大亏损额度未设置');
  }
  const oldDecision = deriveDecision(acct);
  const prevSummary = {
    id: old.id,
    endedAt: new Date().toISOString(),
    endBalance: current,
    peakRealizedBalance: oldDecision.peakRealizedBalance,
    peakRealizedProfit: oldDecision.peakRealizedProfit,
  };
  let floor = acct.defaultHardLossFloor;
  if (acct.drawdownType === 'NONE') floor = null;
  if (acct.drawdownType !== 'NONE' && !(Number.isFinite(floor) && floor > 0)) {
    throw new Error('未设置默认 Hard Loss Floor（该回撤类型需要）');
  }
  const newSession = {
    id: uid('sess'),
    startedAt: new Date().toISOString(),
    previousEodBalance: current,
    sessionStartBalance: current,
    riskSnapshot: computeV2Snapshot({
      riskReferenceBalance: acct.riskReferenceBalance,
      hardLossAmount: acct.hardLossAmount,
      previousEodBalance: current,
    }),
    hardLossFloor: floor,
    balanceEvents: [],
  };
  return { prevSummary, newSession };
}

/**
 * Preflight a GLOBAL trading-day rollover against every account.
 * Pure read-only: no mutation, no writes. Returns
 *   { ok, issues: [{ id, name, reason }], preview: [{ id, name, currentBalance, nextStart }] }.
 * The target set is ALL accounts (every account always has an active session).
 */
export function preflightRollover(state) {
  const issues = [];
  for (const acct of state.accounts) {
    try {
      buildRolledOverSession(acct);
    } catch (e) {
      issues.push({ id: acct.id, name: acct.name, reason: e.message });
    }
  }
  const preview = state.accounts.map((a) => {
    const currentBalance = deriveCurrentBalance(a.currentSession);
    return { id: a.id, name: a.name, currentBalance, nextStart: currentBalance };
  });
  return { ok: issues.length === 0, issues, preview };
}

/**
 * Atomic GLOBAL trading-day rollover (V2.1): ALL OR NOTHING.
 * Clones the full state ONCE, builds the next session for EVERY account, and
 * only when every account passes does it commit the complete next state.
 * Any single failure throws and NO account changes — the caller must not
 * persist anything on throw. This doubles as the second preflight required
 * before the atomic commit (the current state is re-validated at commit time).
 */
export function rolloverAllAccounts(state) {
  const next = JSON.parse(JSON.stringify(state));
  const issues = [];
  const built = [];
  for (const acct of next.accounts) {
    try {
      built.push({ acct, ...buildRolledOverSession(acct) });
    } catch (e) {
      issues.push({ id: acct.id, name: acct.name, reason: e.message });
    }
  }
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.name}\n- ${i.reason}`).join('\n');
    throw new Error(`以下账户尚未满足新交易日要求：\n\n${detail}\n\n请完成配置后重新执行。`);
  }
  for (const { acct, prevSummary, newSession } of built) {
    acct.previousSession = prevSummary;
    acct.currentSession = newSession;
  }
  return next;
}

/**
 * Update the active session's Hard Loss Floor according to drawdown rules:
 * - EOD_TRAILING: frozen during the active session (rejected).
 * - INTRADAY_TRAILING: may be updated mid-session.
 * - STATIC: explicit edit allowed.
 * - NONE: no floor.
 * The floor is an external BALANCE LINE and takes effect IMMEDIATELY.
 */
export function updateHardLossFloor(state, accountId, newFloor) {
  const next = JSON.parse(JSON.stringify(state));
  const acct = next.accounts.find((a) => a.id === accountId);
  if (!acct) throw new Error('账户不存在');
  const value = newFloor === null ? null : Number(newFloor);
  if (value !== null && !(Number.isFinite(value) && value > 0)) throw new Error('Hard Loss Floor 必须是正数');
  switch (acct.drawdownType) {
    case 'EOD_TRAILING':
      throw new Error('EOD Trailing 的 Hard Loss Floor 在当前时段内冻结，请在开新时段时设置');
    case 'INTRADAY_TRAILING':
    case 'STATIC':
      acct.currentSession.hardLossFloor = value;
      break;
    case 'NONE':
      acct.currentSession.hardLossFloor = null;
      break;
    default:
      throw new Error('无效的回撤类型');
  }
  return next;
}
