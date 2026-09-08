// Trading Risk Manager V2 — mandatory V2 specification tests (PHASE 25).
// Covers R scaling, Base threshold, 3R, Final Risk, Profit Lock, Effective
// Protection, active-session migration, account migration, backup migration.
// Pure tests: no DOM, no localStorage.

import * as engine from '../../src/risk-manager/risk-engine.js';
import * as BackupService from '../../src/risk-manager/backup-service.js';
import { migrateState } from '../../src/risk-manager/migration.js';
import { computeV2Snapshot } from '../../src/risk-manager/risk-snapshot.js';
import { createSuite } from './harness.js';

function snapshot(overrides = {}) {
  return computeV2Snapshot({
    riskReferenceBalance: overrides.ref !== undefined ? overrides.ref : 50000,
    hardLossAmount: overrides.hardLoss !== undefined ? overrides.hardLoss : 2000,
    previousEodBalance: overrides.prevEod !== undefined ? overrides.prevEod : 51400,
  });
}

function dec(overrides = {}) {
  return {
    sessionStartBalance: overrides.start,
    previousEodBalance: overrides.prevEod !== undefined ? overrides.prevEod : overrides.start,
    tierSnapshot: overrides.tierSnapshot !== undefined ? overrides.tierSnapshot : snapshot(overrides),
    currentRealizedBalance: overrides.current !== undefined ? overrides.current : overrides.start,
    balanceHistory: overrides.history || [],
    drawdownType: overrides.drawdownType || 'NONE',
    hardLossFloor: overrides.hardFloor !== undefined ? overrides.hardFloor : null,
  };
}

function run(overrides = {}) {
  return engine.calculateRiskDecision(dec(overrides));
}

function eventsOf(...balances) {
  let prev = null;
  return balances.map((b) => {
    const evt = { id: `evt_${b}`, timestamp: '2026-08-11T00:00:00+08:00', previousBalance: prev, newBalance: b, delta: prev === null ? 0 : b - prev };
    prev = b;
    return evt;
  });
}

function buildV1State() {
  return {
    schemaVersion: 1,
    selectedAccountId: 'acct_1',
    accounts: [
      {
        id: 'acct_1',
        name: 'Legacy',
        propFirm: '',
        accountType: '',
        nominalAccountSize: 50000,
        configuredRiskBaseCapital: 50000,
        drawdownType: 'NONE',
        defaultHardLossFloor: null,
        previousSession: null,
        currentSession: {
          id: 'sess_1',
          startedAt: '2026-08-10T00:00:00.000Z',
          previousEodBalance: 51100,
          sessionStartBalance: 51100,
          sessionRiskBaseCapital: 50000,
          hardLossFloor: null,
          balanceEvents: [
            { id: 'evt_1', timestamp: '2026-08-11T00:00:00.000Z', previousBalance: 51100, newBalance: 51200, delta: 100 },
            { id: 'evt_2', timestamp: '2026-08-11T01:00:00.000Z', previousBalance: 51200, newBalance: 50850, delta: -350 },
          ],
        },
      },
    ],
  };
}

export function runV2SpecTests() {
  const s = createSuite('v2-spec');

  // ---- 25.1 R scaling: Hard Loss Amount is the ONLY scaling base ----

  s.test('25.1 — hardLoss 2000 => 100 / 150 / 200', () => {
    const snap = snapshot({ hardLoss: 2000 });
    s.assertEq(snap.lowR, 100);
    s.assertEq(snap.midR, 150);
    s.assertEq(snap.highR, 200);
    const d = run({ start: 51400, hardLoss: 2000 });
    s.assertEq(d.lowR, 100);
    s.assertEq(d.midR, 150);
    s.assertEq(d.highR, 200);
  });

  s.test('25.1 — hardLoss 3000 => 150 / 225 / 300', () => {
    const snap = snapshot({ hardLoss: 3000 });
    s.assertEq(snap.lowR, 150);
    s.assertEq(snap.midR, 225);
    s.assertEq(snap.highR, 300);
    const d = run({ start: 51400, hardLoss: 3000 });
    s.assertEq(d.lowR, 150);
    s.assertEq(d.midR, 225);
    s.assertEq(d.highR, 300);
  });

  s.test('25.1 — hardLoss 4500 => 225 / 337.50 / 450', () => {
    const snap = snapshot({ hardLoss: 4500 });
    s.assertEq(snap.lowR, 225);
    s.assertEq(snap.midR, 337.5);
    s.assertEq(snap.highR, 450);
    const d = run({ start: 51400, hardLoss: 4500 });
    s.assertEq(d.lowR, 225);
    s.assertEq(d.midR, 337.5);
    s.assertEq(d.highR, 450);
  });

  s.test('25.1 — R does NOT scale with nominal account size', () => {
    const small = snapshot({ hardLoss: 2000 });
    const big = snapshot({ hardLoss: 2000, ref: 150000 });
    s.assertEq(big.lowR, small.lowR);
    s.assertEq(big.midR, small.midR);
    s.assertEq(big.highR, small.highR);
  });

  // ---- 25.2 Base upgrade threshold ----

  s.test('25.2 — ref 50000 / hardLoss 2000 => threshold 51200 (cushion 1200)', () => {
    const snap = snapshot({ ref: 50000, hardLoss: 2000 });
    s.assertEq(snap.baseUpgradeCushion, 1200);
    s.assertEq(snap.baseUpgradeThreshold, 51200);
  });

  s.test('25.2 — prevEod 51199.99 => Base R = Low (100)', () => {
    const d = run({ start: 51400, prevEod: 51199.99, current: 51400 });
    s.assertEq(d.baseUpgradeThreshold, 51200);
    s.assertEq(d.baseR, 100);
  });

  s.test('25.2 — prevEod 51200 => Base R = Mid (150)', () => {
    const d = run({ start: 51400, prevEod: 51200, current: 51400 });
    s.assertEq(d.baseR, 150);
  });

  // ---- 25.3 Daily 3R hard limit ----

  s.test('25.3 — start 51200 / baseR 150 => dailyCapitalFloor 50750', () => {
    const d = run({ start: 51200, prevEod: 51200, current: 51200 });
    s.assertEq(d.baseR, 150);
    s.assertEq(d.dailyCapitalFloor, 50750);
  });

  s.test('25.3 — 3R is a hard budget: plan never exceeds it', () => {
    const d = run({ start: 51200, prevEod: 51200, current: 50750, history: eventsOf(50750) });
    s.assertEq(d.availableRisk, 0);
    s.assertEq(d.status, 'BLOCKED');
  });

  // ---- 25.4 Final Risk ----

  // start 51400, baseR 150 => dailyFloor 50950. available = current - 50950.
  function tailCurrent(available) {
    return 50950 + available;
  }

  s.test('25.4 — available 100 => standard Low R (ALLOWED)', () => {
    const current = tailCurrent(100);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'ALLOWED');
    s.assertEq(d.allowedR, 100);
    s.assertEq(d.finalRisk, null);
  });

  s.test('25.4 — available 99.99 => Final Risk 99.99, NOT BLOCKED', () => {
    const current = tailCurrent(99.99);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 99.99);
  });

  s.test('25.4 — available 50 => Final Risk 50', () => {
    const current = tailCurrent(50);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 50);
  });

  s.test('25.4 — available 0.01 => Final Risk 0.01', () => {
    const current = tailCurrent(0.01);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 0.01);
  });

  s.test('25.4 — available 0 => BLOCKED', () => {
    const current = tailCurrent(0);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.allowedR, null);
  });

  s.test('25.4 — available -0.01 => BLOCKED', () => {
    const current = tailCurrent(-0.01);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'BLOCKED');
  });

  s.test('25.4 — Final Risk is NOT a fixed tier', () => {
    const current = tailCurrent(47);
    const d = run({ start: 51400, current, history: eventsOf(current) });
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 47);
    // Standard tiers are only ever Low/Mid/High.
    s.assert(d.finalRisk !== d.lowR && d.finalRisk !== d.midR && d.finalRisk !== d.highR, 'final risk is not a tier');
  });

  // ---- 25.5 Profit Lock ----

  s.test('25.5 — baseR 150 => profitLockTrigger 300', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400 });
    s.assertEq(d.baseR, 150);
    s.assertEq(d.profitLockTrigger, 300);
  });

  s.test('25.5 — peak profit 600 => protection line increment 300 (50%)', () => {
    const d = run({ start: 51400, current: 51800, history: eventsOf(52000, 51800) });
    s.assertEq(d.peakRealizedProfit, 600);
    s.assertEq(d.profitProtectionLine, 51700);
    s.assertEq(d.profitProtectionLine - 51400, 300, '50% of 600 peak profit');
  });

  s.test('25.5 — High R only becomes a candidate after the lock, subject to available risk', () => {
    const d = run({ start: 51400, current: 51750, history: eventsOf(52000, 51750) });
    s.assertEq(d.profitLockActive, true);
    s.assertEq(d.tierCap, 200);
    s.assertEq(d.availableRisk, 50);
    s.assertEq(d.status, 'TAIL_RISK', 'High R is never a free pass: still bounded by available risk');
    s.assertEq(d.finalRisk, 50);
  });

  // ---- 25.6 Effective protection line ----

  s.test('25.6 — effective = max(daily, profit protection, hard floor)', () => {
    // Lock active: profit line 51700 > daily 50950; hard floor 51200 below -> 51700.
    const lockState = run({ start: 51400, current: 51800, history: eventsOf(52000, 51800), drawdownType: 'EOD_TRAILING', hardFloor: 51200 });
    s.assertEq(lockState.profitProtectionLine, 51700);
    s.assertEq(lockState.effectiveProtectionLine, 51700);

    // Hard floor above all -> hard floor wins.
    const hardState = run({ start: 51400, current: 51900, history: eventsOf(52000, 51900), drawdownType: 'EOD_TRAILING', hardFloor: 51800 });
    s.assertEq(hardState.effectiveProtectionLine, 51800);

    // No lock, no hard floor -> daily capital floor wins.
    const dailyState = run({ start: 51400, current: 51400 });
    s.assertEq(dailyState.dailyCapitalFloor, 50950);
    s.assertEq(dailyState.effectiveProtectionLine, 50950);
  });

  s.test('25.6 — peak drawdown never lowers the profit protection line', () => {
    const atPeak = run({ start: 51400, current: 52000, history: eventsOf(52000) });
    const afterPullback = run({ start: 51400, current: 51800, history: eventsOf(52000, 51800) });
    s.assertEq(atPeak.profitProtectionLine, 51700);
    s.assertEq(afterPullback.profitProtectionLine, 51700, 'line stays latched at peak');
  });

  // ---- 25.7 Active session migration ----

  s.test('25.7 — migrated active session keeps all frozen values; Final Risk applies', () => {
    const migrated = migrateState(buildV1State());
    const a = migrated.accounts[0];
    const session = a.currentSession;
    s.assertEq(session.previousEodBalance, 51100, 'Previous EOD unchanged');
    s.assertEq(session.sessionStartBalance, 51100, 'Session Start unchanged');
    s.assertEq(session.balanceEvents.length, 2, 'history unchanged');
    s.assertEq(session.hardLossFloor, null, 'Hard Loss Floor unchanged');
    const snap = session.riskSnapshot;
    s.assertEq(snap.baseR, 100, 'Base R unchanged');
    s.assertEq(snap.lowR, 100, 'Low R snapshot unchanged');
    s.assertEq(snap.midR, 150, 'Mid R snapshot unchanged');
    s.assertEq(snap.highR, 200, 'High R snapshot unchanged');
    s.assertEq(snap.baseUpgradeThreshold, 51200, 'threshold unchanged');

    const d = engine.calculateRiskDecision({
      sessionStartBalance: session.sessionStartBalance,
      previousEodBalance: session.previousEodBalance,
      tierSnapshot: snap,
      currentRealizedBalance: 50850,
      balanceHistory: session.balanceEvents,
      drawdownType: a.drawdownType,
      hardLossFloor: session.hardLossFloor,
    });
    s.assertEq(d.peakRealizedBalance, 51200, 'peak unchanged');
    s.assertEq(d.dailyCapitalFloor, 50800, '3R floor unchanged');
    s.assertEq(d.availableRisk, 50);
    s.assertEq(d.status, 'TAIL_RISK', 'Final Risk instead of legacy BLOCKED');
    s.assertEq(d.finalRisk, 50);
  });

  // ---- 25.8 Account migration ----

  s.test('25.8 — configuredRiskBaseCapital 50000 -> riskReferenceBalance 50000, hardLossAmount null', () => {
    const migrated = migrateState(buildV1State());
    const a = migrated.accounts[0];
    s.assertEq(a.riskReferenceBalance, 50000);
    s.assertEq(a.hardLossAmount, null);
    s.assertEq(a.configuredRiskBaseCapital, undefined);
  });

  // ---- 25.9 Backup migration ----

  s.test('25.9 — V1 JSON import migrates and preserves existing data', () => {
    const raw = JSON.stringify(buildV1State());
    const res = BackupService.validateImport(raw);
    s.assertEq(res.ok, true, res.error || '');
    s.assertEq(res.state.schemaVersion, 2);
    const a = res.state.accounts[0];
    s.assertEq(a.riskReferenceBalance, 50000, 'reference preserved');
    s.assertEq(a.hardLossAmount, null, 'hard loss never guessed');
    s.assertEq(a.currentSession.previousEodBalance, 51100, 'EOD preserved');
    s.assertEq(a.currentSession.balanceEvents.length, 2, 'history preserved');
    s.assertEq(a.currentSession.riskSnapshot.version, 1, 'legacy snapshot preserved');
  });

  return s.results;
}
