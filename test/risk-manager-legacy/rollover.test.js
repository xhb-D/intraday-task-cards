// Trading Risk Manager V2.1 — mandatory global trading-day rollover tests (Test A–K).
// Covers: multi-account atomic rollover, per-account snapshots, all-or-nothing
// failure atomicity, confirmation-cancel neutrality, re-entry guard, selection
// persistence, history preservation, reload persistence, risk regression.
// Pure tests: no DOM, no localStorage.

import * as AccountService from '../../src/risk-manager/account-service.js';
import * as SessionService from '../../src/risk-manager/session-service.js';
import * as engine from '../../src/risk-manager/risk-engine.js';
import { computeV2Snapshot } from '../../src/risk-manager/risk-snapshot.js';
import { createReentryGuard } from '../../src/risk-manager/utils.js';
import { RISK_MANAGER_SCHEMA_VERSION as SCHEMA_VERSION } from '../../src/risk-manager/migration.js';
import { createSuite } from './harness.js';

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
}

function makeAccount(state, overrides = {}) {
  return AccountService.createAccount(state, {
    name: overrides.name || 'Account',
    nominalAccountSize: overrides.nominal !== undefined ? overrides.nominal : 50000,
    riskReferenceBalance: overrides.ref !== undefined ? overrides.ref : 50000,
    hardLossAmount: overrides.hardLoss !== undefined ? overrides.hardLoss : 2000,
    drawdownType: overrides.drawdownType || 'NONE',
    defaultHardLossFloor: overrides.floor !== undefined ? overrides.floor : null,
    initialBalance: overrides.initial !== undefined ? overrides.initial : 50000,
  });
}

/** Two accounts A and B. A default hardLoss 2000; B defaults 3000 unless overridden. */
function twoAccountState(a = {}, b = {}) {
  let s = makeAccount(emptyState(), { name: 'Account A', hardLoss: 2000, ...a });
  s = makeAccount(s, { name: 'Account B', hardLoss: 3000, ...b });
  return s;
}

function setBalance(state, accountId, balance) {
  return SessionService.addBalanceUpdate(state, accountId, balance);
}

function snapshotOf(acct) {
  return acct.currentSession.riskSnapshot;
}

export function runRolloverTests() {
  const s = createSuite('rollover');

  // ---- Test A - two-account successful rollover ----

  s.test('A — both accounts roll to Previous EOD = current realized balance', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const next = SessionService.rolloverAllAccounts(state);
    const a = next.accounts[0];
    const b = next.accounts[1];
    s.assertEq(a.previousSession.endBalance, 49796, 'A previous EOD');
    s.assertEq(a.currentSession.previousEodBalance, 49796, 'A prevEod stored');
    s.assertEq(a.currentSession.sessionStartBalance, 49796, 'A start stored');
    s.assertEq(b.previousSession.endBalance, 49908, 'B previous EOD');
    s.assertEq(b.currentSession.previousEodBalance, 49908, 'B prevEod stored');
    s.assertEq(b.currentSession.sessionStartBalance, 49908, 'B start stored');
    s.assertEq(a.currentSession.balanceEvents.length, 0, 'A events reset');
    s.assertEq(b.currentSession.balanceEvents.length, 0, 'B events reset');
    s.assertEq(a.currentSession.riskSnapshot.version, 2, 'A v2 snapshot');
    s.assertEq(b.currentSession.riskSnapshot.version, 2, 'B v2 snapshot');
  });

  // ---- Test B - different hard loss amounts produce independent snapshots ----

  s.test('B — A(2000) and B(3000) get independent snapshots', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const next = SessionService.rolloverAllAccounts(state);
    const a = snapshotOf(next.accounts[0]);
    const b = snapshotOf(next.accounts[1]);
    s.assertEq(a.lowR, 100); s.assertEq(a.midR, 150); s.assertEq(a.highR, 200);
    s.assertEq(a.sessionHardLossAmount, 2000, 'A hard loss snapshot');
    s.assertEq(b.lowR, 150); s.assertEq(b.midR, 225); s.assertEq(b.highR, 300);
    s.assertEq(b.sessionHardLossAmount, 3000, 'B hard loss snapshot');
    s.assertEq(a.baseUpgradeThreshold, 51200, 'A threshold (50000 + 60%*2000)');
    s.assertEq(b.baseUpgradeThreshold, 51800, 'B threshold (50000 + 60%*3000)');
  });

  // ---- Test C - missing hard loss amount fails atomically ----

  s.test('C — B without hard loss amount: FAIL, no account changes', () => {
    let state = twoAccountState();
    state.accounts[1].hardLossAmount = null; // config cleared after creation
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const before = JSON.stringify(state);
    let threw = false;
    try { SessionService.rolloverAllAccounts(state); } catch (e) { threw = true; }
    s.assertEq(threw, true, 'must throw');
    s.assertEq(JSON.stringify(state), before, 'original state untouched');
    s.assertEq(state.accounts[0].currentSession.sessionStartBalance, 50000, 'A unchanged');
    s.assertEq(state.accounts[1].currentSession.sessionStartBalance, 50000, 'B unchanged');
    s.assertEq(state.accounts[0].previousSession, null, 'A no archive');
    s.assertEq(state.accounts[1].previousSession, null, 'B no archive');
  });

  s.test('C — preflight reports the blocking account with reason', () => {
    let state = twoAccountState();
    state.accounts[1].hardLossAmount = null; // config cleared after creation
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const pre = SessionService.preflightRollover(state);
    s.assertEq(pre.ok, false, 'preflight fails');
    s.assertEq(pre.issues.length, 1, 'exactly one blocking account');
    s.assertEq(pre.issues[0].name, 'Account B', 'blocking account identified');
    s.assertEq(pre.issues[0].reason, '最大亏损额度未设置', 'reason message');
    const before = JSON.stringify(state);
    const pre2 = SessionService.preflightRollover(state);
    s.assertEq(JSON.stringify(state), before, 'preflight is read-only');
    s.assertEq(JSON.stringify(pre2), JSON.stringify(pre), 'preflight is deterministic');
  });

  // ---- Test D - snapshot creation failure is atomic ----

  s.test('D — one account cannot build a snapshot: ALL unchanged', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    // Corrupt B's config so computeV2Snapshot throws (invalid risk reference).
    state.accounts[1].riskReferenceBalance = 0;
    const before = JSON.stringify(state);
    const pre = SessionService.preflightRollover(state);
    s.assertEq(pre.ok, false, 'preflight fails');
    s.assertEq(pre.issues[0].name, 'Account B', 'B is the failing account');
    let threw = false;
    try { SessionService.rolloverAllAccounts(state); } catch (e) { threw = true; }
    s.assertEq(threw, true, 'commit throws');
    s.assertEq(JSON.stringify(state), before, 'state fully unchanged');
    s.assertEq(state.accounts[0].previousSession, null, 'A unchanged');
    s.assertEq(state.accounts[1].previousSession, null, 'B unchanged');
  });

  // ---- Test E - confirmation cancelled ----

  s.test('E — cancellation performs zero business-state changes', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const before = JSON.stringify(state);
    const pre = SessionService.preflightRollover(state);
    s.assertEq(pre.ok, true, 'preflight would pass (confirmation would be shown)');
    // Cancelling = not calling rolloverAllAccounts; state must be identical.
    s.assertEq(JSON.stringify(state), before, 'no mutation from preview/preflight');
  });

  // ---- Test F - double execution protection ----

  s.test('F — re-entry guard blocks a second concurrent commit', () => {
    const guard = createReentryGuard();
    s.assertEq(guard.tryAcquire(), true, 'first acquisition succeeds');
    s.assertEq(guard.tryAcquire(), false, 'second acquisition blocked (double click)');
    s.assertEq(guard.locked, true, 'guard is locked');
    guard.release();
    s.assertEq(guard.tryAcquire(), true, 'after release acquisition succeeds again');
    guard.release();
  });

  s.test('F — two sequential rollovers create exactly two distinct sessions', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    const first = SessionService.rolloverAllAccounts(state);
    const firstSessionA = first.accounts[0].currentSession.id;
    const firstSessionB = first.accounts[1].currentSession.id;
    const second = SessionService.rolloverAllAccounts(first);
    s.assertEq(second.accounts[0].currentSession.id !== firstSessionA, true, 'A new session id');
    s.assertEq(second.accounts[1].currentSession.id !== firstSessionB, true, 'B new session id');
    s.assertEq(second.accounts[0].previousSession.endBalance, 49796, 'A archived once');
    s.assertEq(second.accounts[1].previousSession.endBalance, 49908, 'B archived once');
    s.assertEq(second.accounts[0].previousSession.id, firstSessionA, 'previous session is first session');
  });

  // ---- Test G - selection persistence ----

  s.test('G — selected account is preserved after global rollover', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    state = AccountService.selectAccount(state, state.accounts[1].id);
    const selectedId = state.selectedAccountId;
    const next = SessionService.rolloverAllAccounts(state);
    s.assertEq(next.selectedAccountId, selectedId, 'selection unchanged');
    s.assertEq(next.selectedAccountId, state.accounts[1].id, 'still points to B');
  });

  // ---- Test H - existing histories preserved per existing rollover rules ----

  s.test('H — history/peak archived per existing semantics; new session starts clean', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 50100);
    state = setBalance(state, state.accounts[0].id, 51200);
    state = setBalance(state, state.accounts[0].id, 50850);
    const oldEvents = state.accounts[0].currentSession.balanceEvents.length;
    s.assertEq(oldEvents, 3, 'setup events recorded');
    const next = SessionService.rolloverAllAccounts(state);
    const a = next.accounts[0];
    s.assertEq(a.previousSession.endBalance, 50850, 'archived end balance');
    s.assertEq(a.previousSession.peakRealizedBalance, 51200, 'archived peak balance');
    s.assertEq(a.previousSession.peakRealizedProfit, 1200, 'archived peak profit');
    s.assertEq(a.currentSession.balanceEvents.length, 0, 'new session has no events');
    s.assertEq(a.currentSession.sessionStartBalance, 50850, 'new start is current balance');
  });

  // ---- Test I - reload persistence (serialize/deserialize round-trip) ----

  s.test('I — rolled-over state survives a reload (serialize round-trip)', () => {
    let state = twoAccountState();
    state = setBalance(state, state.accounts[0].id, 49796);
    state = setBalance(state, state.accounts[1].id, 49908);
    state = AccountService.selectAccount(state, state.accounts[1].id);
    const next = SessionService.rolloverAllAccounts(state);
    const reloaded = JSON.parse(JSON.stringify(next)); // simulates localStorage round-trip
    s.assertEq(reloaded.schemaVersion, SCHEMA_VERSION, 'schema unchanged (no migration)');
    s.assertEq(reloaded.accounts[0].currentSession.sessionStartBalance, 49796, 'A start restored');
    s.assertEq(reloaded.accounts[1].currentSession.sessionStartBalance, 49908, 'B start restored');
    s.assertEq(reloaded.accounts[0].currentSession.previousEodBalance, 49796, 'A EOD restored');
    s.assertEq(reloaded.accounts[1].currentSession.previousEodBalance, 49908, 'B EOD restored');
    s.assertEq(reloaded.accounts[0].currentSession.riskSnapshot.version, 2, 'A snapshot restored');
    s.assertEq(reloaded.accounts[1].currentSession.riskSnapshot.version, 2, 'B snapshot restored');
    s.assertEq(reloaded.selectedAccountId, next.selectedAccountId, 'selection restored');
    const decisionA = SessionService.deriveDecision(reloaded.accounts[0]);
    s.assertEq(decisionA.status, 'ALLOWED', 'restored A session is decidable');
  });

  // ---- Test K - risk model regression (must remain untouched) ----

  s.test('K — hard loss 2000 still yields 100/150/200', () => {
    const snap = computeV2Snapshot({ riskReferenceBalance: 50000, hardLossAmount: 2000, previousEodBalance: 51400 });
    s.assertEq(snap.lowR, 100); s.assertEq(snap.midR, 150); s.assertEq(snap.highR, 200);
  });

  s.test('K — 99.99 available risk is FINAL_RISK (TAIL_RISK)', () => {
    // start 51400, baseR 100 => daily capital floor 51100; current 51199.99 => available 99.99
    const d = engine.calculateRiskDecision({
      sessionStartBalance: 51400,
      previousEodBalance: 51400,
      tierSnapshot: { version: 2, lowR: 100, midR: 150, highR: 200, baseR: 100, baseUpgradeThreshold: 51200 },
      currentRealizedBalance: 51199.99,
      balanceHistory: [{ id: 'e1', previousBalance: 51400, newBalance: 51199.99, delta: -200.01, timestamp: '2026-08-19T00:00:00Z' }],
      drawdownType: 'NONE',
      hardLossFloor: null,
    });
    s.assertEq(d.status, 'TAIL_RISK', 'tail risk status');
    s.assertEq(d.finalRisk, 99.99, 'final risk equals remaining available');
    s.assertEq(d.allowedR, null, 'no standard R allowed');
  });

  s.test('K — 0 available risk is BLOCKED', () => {
    // start 51400, baseR 100 => floor 51100; current 51100 => available 0
    const d = engine.calculateRiskDecision({
      sessionStartBalance: 51400,
      previousEodBalance: 51400,
      tierSnapshot: { version: 2, lowR: 100, midR: 150, highR: 200, baseR: 100, baseUpgradeThreshold: 51200 },
      currentRealizedBalance: 51100,
      balanceHistory: [{ id: 'e1', previousBalance: 51400, newBalance: 51100, delta: -300, timestamp: '2026-08-19T00:00:00Z' }],
      drawdownType: 'NONE',
      hardLossFloor: null,
    });
    s.assertEq(d.status, 'BLOCKED', 'blocked status');
    s.assertEq(d.availableRisk, 0, 'available risk zero');
  });

  return s.results;
}
