// Trading Risk Manager V2 — explicit schema migration v1 -> v2.
// PURE module: no DOM, no localStorage.
//
// Migration contract:
//   - Storage key stays trading-risk-manager:v1; schemaVersion moves 1 -> 2.
//   - configuredRiskBaseCapital -> riskReferenceBalance (amount preserved).
//   - hardLossAmount = null (NEVER guessed from nominal size, floor or
//     balance).
//   - An active V1 session keeps its frozen risk snapshot: Low/Mid/High R,
//     Base R and the base threshold are recomputed with the LEGACY formula
//     and frozen — nothing else about the session changes. The V2 Final
//     Risk tail state applies to it immediately (engine-level behavior).
//   - Accounts/sessions/history/floors/appearance are preserved untouched.

import { computeLegacySnapshot } from './risk-snapshot.js';

export const RISK_MANAGER_SCHEMA_VERSION = 2;
// Compatibility name retained for the imported V2 regression suite.

/**
 * Upgrade one V1 account object to the V2 shape (in place on a deep copy).
 */
function migrateAccount(acct) {
  if (!acct || typeof acct !== 'object') return acct;
  if (acct.riskReferenceBalance === undefined && acct.configuredRiskBaseCapital !== undefined) {
    acct.riskReferenceBalance = acct.configuredRiskBaseCapital;
  }
  delete acct.configuredRiskBaseCapital;
  if (acct.hardLossAmount === undefined) {
    acct.hardLossAmount = null;
  }
  const session = acct.currentSession;
  if (session && typeof session === 'object' && !session.riskSnapshot) {
    const legacyBase = session.sessionRiskBaseCapital !== undefined
      ? session.sessionRiskBaseCapital
      : acct.riskReferenceBalance;
    if (typeof legacyBase === 'number' && Number.isFinite(legacyBase) && legacyBase > 0) {
      session.riskSnapshot = computeLegacySnapshot({
        sessionRiskBaseCapital: legacyBase,
        previousEodBalance: session.previousEodBalance,
      });
    }
  }
  return acct;
}

/**
 * Migrate a raw persisted/imported state to the current schema.
 * Unknown/newer schemas pass through untouched (validation decides later).
 */
export function migrateState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  if (raw.schemaVersion === 1) {
    const next = JSON.parse(JSON.stringify(raw));
    next.schemaVersion = RISK_MANAGER_SCHEMA_VERSION;
    if (Array.isArray(next.accounts)) {
      next.accounts = next.accounts.map(migrateAccount);
    }
    return next;
  }
  return raw;
}
