// Trading Risk Manager V2 — locked risk-engine test cases.
// The engine consumes a FROZEN risk snapshot; R scaling and Base threshold
// construction live in risk-snapshot.js and are covered in v2-spec.test.js.
// Pure engine tests: no DOM, no localStorage, no clock.

import * as engine from '../../src/risk-manager/risk-engine.js';
import { computeV2Snapshot } from '../../src/risk-manager/risk-snapshot.js';
import { createSuite } from './harness.js';

// ---- helpers -------------------------------------------------------------

// Standard fixture: Hard Loss Amount 2000, Risk Reference Balance 50000
// -> Low 100 / Mid 150 / High 200, upgrade threshold 51200.
function snap(input) {
  return computeV2Snapshot({
    riskReferenceBalance: input.ref !== undefined ? input.ref : 50000,
    hardLossAmount: input.hardLoss !== undefined ? input.hardLoss : 2000,
    previousEodBalance: input.prevEod !== undefined ? input.prevEod : (input.start !== undefined ? input.start : 51400),
  });
}

function dec(input) {
  return {
    sessionStartBalance: input.start,
    previousEodBalance: input.prevEod !== undefined ? input.prevEod : input.start,
    tierSnapshot: input.tierSnapshot !== undefined ? input.tierSnapshot : snap(input),
    currentRealizedBalance: input.current !== undefined ? input.current : input.start,
    balanceHistory: input.history || [],
    drawdownType: input.drawdownType || 'NONE',
    hardLossFloor: input.hardFloor !== undefined ? input.hardFloor : null,
  };
}

function run(input) {
  return engine.calculateRiskDecision(dec(input));
}

function eventsOf(...balances) {
  let prev = null;
  return balances.map((b) => {
    const evt = { id: `evt_${b}`, timestamp: '2026-08-11T00:00:00+08:00', previousBalance: prev, newBalance: b, delta: prev === null ? 0 : b - prev };
    prev = b;
    return evt;
  });
}

// ---- suite ---------------------------------------------------------------

export function runRiskEngineTests() {
  const s = createSuite('risk-engine');

  // ============ A. Core cases (hardLoss 2000 snapshot, Mid Base R) ============

  s.test('A1 — opening Mid Base R (full decision)', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400 });
    s.assertEq(d.status, 'ALLOWED', 'status');
    s.assertEq(d.lowR, 100);
    s.assertEq(d.midR, 150);
    s.assertEq(d.highR, 200);
    s.assertEq(d.baseUpgradeThreshold, 51200);
    s.assertEq(d.baseR, 150);
    s.assertEq(d.profitLockActive, false);
    s.assertEq(d.dailyCapitalFloor, 50950);
    s.assertEq(d.effectiveProtectionLine, 50950);
    s.assertEq(d.availableRisk, 450);
    s.assertEq(d.allowedR, 150);
    s.assertEq(d.finalRisk, null);
    s.assertEq(d.reason, 'TRADE_ALLOWED');
  });

  s.test('A2 — opening Low Base R (below threshold)', () => {
    const d = run({ start: 51400, prevEod: 51199.99, current: 51400 });
    s.assertEq(d.baseR, 100);
    s.assertEq(d.baseUpgradeThreshold, 51200);
  });

  s.test('A3 — exact threshold qualifies Mid Base R', () => {
    const d = run({ start: 51400, prevEod: 51200, current: 51400 });
    s.assertEq(d.baseR, 150);
  });

  s.test('A4 — small realized profit (+100) does not unlock High R', () => {
    const d = run({ start: 51400, current: 51500, history: eventsOf(51500) });
    s.assertEq(d.peakRealizedBalance, 51500);
    s.assertEq(d.peakRealizedProfit, 100);
    s.assertEq(d.profitLockActive, false);
    s.assertEq(d.allowedR, 150);
  });

  s.test('A5 — +250 below 2R lock trigger, AllowedR <= BaseR', () => {
    const d = run({ start: 51400, current: 51650, history: eventsOf(51650) });
    s.assertEq(d.peakRealizedProfit, 250);
    s.assertEq(d.profitLockActive, false);
    s.assert(d.allowedR <= 150, `AllowedR ${d.allowedR} must be <= 150`);
    s.assertEq(d.allowedR, 150);
  });

  s.test('A6 — exact +300 activates Profit Lock', () => {
    const d = run({ start: 51400, current: 51700, history: eventsOf(51700) });
    s.assertEq(d.profitLockTrigger, 300);
    s.assertEq(d.profitLockActive, true);
    s.assertEq(d.profitProtectionLine, 51550);
    s.assertEq(d.availableRisk, 150);
    s.assertEq(d.allowedR, 150);
  });

  s.test('A7 — +400 unlocks High R', () => {
    const d = run({ start: 51400, current: 51800, history: eventsOf(51800) });
    s.assertEq(d.peakRealizedProfit, 400);
    s.assertEq(d.profitProtectionLine, 51600);
    s.assertEq(d.availableRisk, 200);
    s.assertEq(d.allowedR, 200);
  });

  s.test('A8 — peak +600, current +400: pullback auto-downgrade', () => {
    const d = run({ start: 51400, current: 51800, history: eventsOf(52000, 51800) });
    s.assertEq(d.peakRealizedProfit, 600);
    s.assertEq(d.profitProtectionLine, 51700);
    s.assertEq(d.availableRisk, 100);
    s.assertEq(d.allowedR, 100);
    s.assertEq(d.status, 'ALLOWED');
    s.assertEq(d.reason, 'RISK_REDUCED');
  });

  s.test('A9 — peak +600, current +300: at profit floor, BLOCKED', () => {
    const d = run({ start: 51400, current: 51700, history: eventsOf(52000, 51700) });
    s.assertEq(d.profitProtectionLine, 51700);
    s.assertEq(d.availableRisk, 0);
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.reason, 'PROTECTION_LINE_BREACHED');
    s.assertEq(d.bindingFloor, 'PROFIT_PROTECTION_LINE');
  });

  s.test('A10 — loss approaches 3R floor: Low R only', () => {
    const d = run({ start: 51400, current: 51050, history: eventsOf(51050) });
    s.assertEq(d.dailyCapitalFloor, 50950);
    s.assertEq(d.availableRisk, 100);
    s.assertEq(d.allowedR, 100);
    s.assertEq(d.status, 'ALLOWED');
    s.assertEq(d.reason, 'RISK_REDUCED');
  });

  s.test('A11 — full 3R budget consumed: BLOCKED', () => {
    const d = run({ start: 51400, current: 50950, history: eventsOf(50950) });
    s.assertEq(d.availableRisk, 0);
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.bindingFloor, 'DAILY_CAPITAL_FLOOR');
  });

  // ============ C. Hard Loss Floor ============

  s.test('C1 — hard floor dominates internal floor', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51250, drawdownType: 'EOD_TRAILING', hardFloor: 51100, history: eventsOf(51250) });
    s.assertEq(d.effectiveProtectionLine, 51100);
    s.assertEq(d.availableRisk, 150);
    s.assertEq(d.allowedR, 150);
  });

  s.test('C2 — hard floor leaves less than Low R: TAIL_RISK (Final Risk)', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400, drawdownType: 'EOD_TRAILING', hardFloor: 51350 });
    s.assertEq(d.availableRisk, 50);
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 50);
  });

  s.test('C3 — current at hard floor: HARD_LOSS_FLOOR_REACHED', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400, drawdownType: 'EOD_TRAILING', hardFloor: 51400 });
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.reason, 'HARD_LOSS_FLOOR_REACHED');
    s.assertEq(d.bindingFloor, 'HARD_LOSS_FLOOR');
  });

  s.test('C4 — below hard floor: BLOCKED with HARD_LOSS_FLOOR_REACHED', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51300, drawdownType: 'EOD_TRAILING', hardFloor: 51350, history: eventsOf(51300) });
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.reason, 'HARD_LOSS_FLOOR_REACHED');
  });

  // ============ D. Boundary precision (High R eligible state) ============
  // Lock active: start 51400, peak 52000 (+600) => profitFloor 51700, tierCap 200.

  function boundaryState(available) {
    const current = 51700 + available;
    return run({ start: 51400, current, history: eventsOf(52000, current) });
  }

  s.test('D1 — Available 199.99 => AllowedR 150', () => {
    s.assertEq(boundaryState(199.99).allowedR, 150);
  });
  s.test('D2 — Available 200.00 => AllowedR 200', () => {
    s.assertEq(boundaryState(200.0).allowedR, 200);
  });
  s.test('D3 — Available 149.99 => AllowedR 100', () => {
    s.assertEq(boundaryState(149.99).allowedR, 100);
  });
  s.test('D4 — Available 150.00 => AllowedR 150', () => {
    s.assertEq(boundaryState(150.0).allowedR, 150);
  });
  s.test('D5 — Available 99.99 => TAIL_RISK Final Risk 99.99 (NOT BLOCKED)', () => {
    const d = boundaryState(99.99);
    s.assertEq(d.status, 'TAIL_RISK');
    s.assertEq(d.finalRisk, 99.99);
    s.assertEq(d.allowedR, null);
  });
  s.test('D6 — Available 100.00 => AllowedR 100', () => {
    s.assertEq(boundaryState(100.0).allowedR, 100);
  });

  // ============ Engine invariants ============

  s.test('INV — invariants hold across core states', () => {
    const states = [
      run({ start: 51400, prevEod: 51400, current: 51400 }),
      run({ start: 51400, current: 51800, history: eventsOf(51800) }),
      run({ start: 51400, current: 51800, history: eventsOf(52000, 51800) }),
      run({ start: 51400, current: 50950, history: eventsOf(50950) }),
      run({ start: 51400, current: 51250, drawdownType: 'EOD_TRAILING', hardFloor: 51100 }),
      run({ start: 51400, current: 51850, history: eventsOf(52000, 51850) }),
      run({ start: 51400, current: 50950.01, history: eventsOf(50950.01) }),
    ];
    for (const d of states) {
      if (d.allowedR !== null) {
        s.assert(d.allowedR <= d.highR + 1e-6, `allowedR <= highR (${d.allowedR} vs ${d.highR})`);
        s.assert(d.allowedR <= d.tierCap + 1e-6, `allowedR <= tierCap (${d.allowedR} vs ${d.tierCap})`);
        s.assert(d.allowedR <= d.availableRisk + 1e-6, `allowedR <= availableRisk (${d.allowedR} vs ${d.availableRisk})`);
      }
      if (d.status === 'TAIL_RISK') {
        s.assertEq(d.finalRisk, d.availableRisk, 'finalRisk equals availableRisk');
        s.assert(d.finalRisk > 0, 'finalRisk strictly positive');
        s.assert(d.finalRisk < d.lowR, 'finalRisk below Low R');
      }
      s.assert(d.baseR === d.lowR || d.baseR === d.midR, 'baseR in {lowR, midR}');
      s.assert(d.effectiveProtectionLine >= d.dailyCapitalFloor - 1e-6, 'effective >= dailyCapitalFloor');
      if (d.profitLockActive) s.assert(d.effectiveProtectionLine >= d.profitProtectionLine - 1e-6, 'effective >= profitProtectionLine when locked');
      if (d.hardLossFloor !== null) s.assert(d.effectiveProtectionLine >= d.hardLossFloor - 1e-6, 'effective >= hardLossFloor');
      s.assert(d.peakRealizedProfit >= 0, 'peakRealizedProfit never negative');
    }
  });

  s.test('INV — availableRisk is NOT clamped: negative diagnostic preserved', () => {
    const d = run({ start: 51400, current: 50800, history: eventsOf(50800) });
    s.assertEq(d.availableRisk, -150);
    s.assertEq(d.status, 'BLOCKED');
    s.assertEq(d.reason, 'PROTECTION_LINE_BREACHED');
    s.assertEq(d.bindingFloor, 'DAILY_CAPITAL_FLOOR');
  });

  s.test('INV — BLOCKED only at AvailableRisk <= 0', () => {
    for (const available of [0.01, 50, 99.99]) {
      const current = 50950 + available;
      const d = run({ start: 51400, current, history: eventsOf(current) });
      s.assertEq(d.status, 'TAIL_RISK', `available ${available} must be TAIL_RISK`);
    }
  });

  // ============ Configuration errors ============

  s.test('CONFIG — missing tier snapshot => CONFIG_ERROR', () => {
    const d = engine.calculateRiskDecision({
      sessionStartBalance: 51400,
      previousEodBalance: 51400,
      tierSnapshot: null,
      currentRealizedBalance: 51400,
      balanceHistory: [],
      drawdownType: 'NONE',
      hardLossFloor: null,
    });
    s.assertEq(d.status, 'CONFIG_ERROR');
    s.assertEq(d.reason, 'MISSING_REQUIRED_FIELD');
  });

  s.test('CONFIG — invalid Base R (High R as base) => CONFIG_ERROR', () => {
    const bad = { ...snap({}), baseR: 200 };
    const d = run({ start: 51400, tierSnapshot: bad });
    s.assertEq(d.status, 'CONFIG_ERROR');
    s.assertEq(d.reason, 'INVALID_VALUE');
  });

  s.test('CONFIG — tier ordering violated => CONFIG_ERROR', () => {
    const bad = { ...snap({}), lowR: 200, midR: 150 };
    const d = run({ start: 51400, tierSnapshot: bad });
    s.assertEq(d.status, 'CONFIG_ERROR');
  });

  s.test('CONFIG — non-NONE drawdown without hard floor => CONFIG_ERROR', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400, drawdownType: 'EOD_TRAILING', hardFloor: null });
    s.assertEq(d.status, 'CONFIG_ERROR');
    s.assertEq(d.reason, 'MISSING_REQUIRED_FIELD');
  });

  s.test('CONFIG — NONE drawdown ignores hard floor', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400, drawdownType: 'NONE', hardFloor: 40000 });
    s.assertEq(d.status, 'ALLOWED');
    s.assertEq(d.hardLossFloor, null);
  });

  s.test('CONFIG — invalid drawdownType => CONFIG_ERROR', () => {
    const d = run({ start: 51400, prevEod: 51400, current: 51400, drawdownType: 'FROZEN', hardFloor: 50000 });
    s.assertEq(d.status, 'CONFIG_ERROR');
    s.assertEq(d.reason, 'INVALID_VALUE');
  });

  s.test('CONFIG — balanceHistory must be an array', () => {
    const d = engine.calculateRiskDecision({
      sessionStartBalance: 51400,
      previousEodBalance: 51400,
      tierSnapshot: snap({}),
      currentRealizedBalance: 51400,
      balanceHistory: 'not-an-array',
      drawdownType: 'NONE',
      hardLossFloor: null,
    });
    s.assertEq(d.status, 'CONFIG_ERROR');
  });

  // ============ Session-start Base R never High ============

  s.test('RULE — opening Base R is never High R, even at huge balance', () => {
    const d = run({ start: 500000, prevEod: 500000, current: 500000 });
    s.assertEq(d.baseR, 150); // Mid at most; never 200
    s.assert(d.baseR !== d.highR, 'baseR !== highR');
    s.assertEq(d.allowedR, 150); // tierCap = baseR before lock
  });

  return s.results;
}
