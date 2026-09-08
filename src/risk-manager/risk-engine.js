// Trading Risk Manager V2 — deterministic risk engine.
// PURE module: no DOM, no localStorage, no clock, no side effects.
//
// All monetary math runs on integer cents internally. API boundaries use
// dollar amounts (numbers). We never round upward in a way that could
// increase legal risk.
//
// The engine consumes a FROZEN risk snapshot (computed at session start by
// risk-snapshot.js); it never derives R from account configuration, so
// mid-session config changes cannot alter an active session.

// ---- money helpers --------------------------------------------------------

/** Normalize a dollar amount to integer cents. */
function toCents(dollars) {
  return Math.round(dollars * 100);
}

/** Convert integer cents back to a dollar amount. */
function toDollars(cents) {
  return cents / 100;
}

const RISK_ENGINE_DRAW_DOWN_TYPES = ['EOD_TRAILING', 'INTRADAY_TRAILING', 'STATIC', 'NONE'];

function isFinitePositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

// ---- validation -----------------------------------------------------------

function configError(reason, detail) {
  return {
    status: 'CONFIG_ERROR',
    allowedR: null,
    lowR: null,
    midR: null,
    highR: null,
    baseR: null,
    baseUpgradeThreshold: null,
    profitLockTrigger: null,
    profitLockActive: false,
    peakRealizedBalance: null,
    peakRealizedProfit: null,
    dailyCapitalFloor: null,
    profitProtectionLine: null,
    hardLossFloor: null,
    effectiveProtectionLine: null,
    currentRealizedBalance: null,
    availableRisk: null,
    tierCap: null,
    finalRisk: null,
    bindingFloor: null,
    reason,
    detail: detail || null,
  };
}

function validateInput(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'MISSING_REQUIRED_FIELD', detail: 'input object required' };
  }
  if (!isFinitePositive(input.sessionStartBalance)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'sessionStartBalance' };
  }
  if (!isFinitePositive(input.previousEodBalance)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'previousEodBalance' };
  }
  if (!isFinitePositive(input.currentRealizedBalance)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'currentRealizedBalance' };
  }
  const snap = input.tierSnapshot;
  if (!snap || typeof snap !== 'object') {
    return { ok: false, reason: 'MISSING_REQUIRED_FIELD', detail: 'tierSnapshot required' };
  }
  for (const key of ['lowR', 'midR', 'highR', 'baseR']) {
    if (!isFinitePositive(snap[key])) {
      return { ok: false, reason: 'INVALID_VALUE', detail: `tierSnapshot.${key}` };
    }
  }
  if (!(snap.baseR === snap.lowR || snap.baseR === snap.midR)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'tierSnapshot.baseR must be Low R or Mid R (never High R)' };
  }
  if (!(snap.lowR <= snap.midR && snap.midR <= snap.highR)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'tierSnapshot tier ordering violated' };
  }
  if (!Array.isArray(input.balanceHistory)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'balanceHistory must be an array' };
  }
  if (!RISK_ENGINE_DRAW_DOWN_TYPES.includes(input.drawdownType)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'drawdownType' };
  }
  const floor = input.hardLossFloor;
  if (floor !== null && floor !== undefined && !isFinitePositive(floor)) {
    return { ok: false, reason: 'INVALID_VALUE', detail: 'hardLossFloor' };
  }
  for (const evt of input.balanceHistory) {
    if (!evt || typeof evt !== 'object' || !isFinitePositive(evt.newBalance)) {
      return { ok: false, reason: 'INVALID_VALUE', detail: 'balanceHistory event newBalance' };
    }
  }
  return { ok: true };
}

// ---- decision -------------------------------------------------------------

export function calculateRiskDecision(input) {
  const check = validateInput(input);
  if (!check.ok) {
    return configError(check.reason, check.detail);
  }

  // External floor resolution (spec §8): NONE disables the floor; other
  // drawdown modes REQUIRE a floor — never guess one.
  const hardLossFloorCents =
    input.drawdownType === 'NONE'
      ? null
      : input.hardLossFloor !== null && input.hardLossFloor !== undefined
        ? toCents(input.hardLossFloor)
        : null;

  if (input.drawdownType !== 'NONE' && hardLossFloorCents === null) {
    return configError('MISSING_REQUIRED_FIELD', 'hardLossFloor required for drawdown type');
  }

  // Source of truth: Session Start + Balance Events.
  // The engine rederives the current balance from history and validates that
  // the caller's value agrees — this keeps undo/replay deterministic.
  const historyBalances = input.balanceHistory.map((e) => toCents(e.newBalance));
  const derivedCurrent =
    historyBalances.length > 0 ? historyBalances[historyBalances.length - 1] : toCents(input.sessionStartBalance);

  if (Math.abs(derivedCurrent - toCents(input.currentRealizedBalance)) > 0.5) {
    return configError('INVALID_VALUE', 'currentRealizedBalance inconsistent with balanceHistory');
  }

  const startCents = toCents(input.sessionStartBalance);
  const snap = input.tierSnapshot;

  // Frozen tier set (session-start snapshot; never recomputed mid-session).
  const lowRCents = toCents(snap.lowR);
  const midRCents = toCents(snap.midR);
  const highRCents = toCents(snap.highR);
  const baseRCents = toCents(snap.baseR);
  const baseUpgradeThresholdCents = toCents(snap.baseUpgradeThreshold);

  // Peak realized state (spec §5)
  const realizedBalances = [startCents, ...historyBalances];
  const peakRealizedBalanceCents = Math.max(...realizedBalances);
  const peakRealizedProfitCents = Math.max(0, peakRealizedBalanceCents - startCents);

  // Profit Lock (spec §8): trigger = 2 × BaseR, historical peak latches.
  const profitLockTriggerCents = 2 * baseRCents;
  const profitLockActive = peakRealizedProfitCents >= profitLockTriggerCents;

  // Internal floors (spec §10)
  const dailyCapitalFloorCents = startCents - 3 * baseRCents;
  const profitProtectionLineCents = profitLockActive
    ? startCents + Math.ceil(peakRealizedProfitCents / 2) // 50% of peak; ceil keeps the line conservative
    : null;

  // Effective protection line (spec §11): the highest binding floor wins.
  // Tie-break order for reporting: hard floor > profit line > daily floor.
  const floors = [{ cents: dailyCapitalFloorCents, source: 'DAILY_CAPITAL_FLOOR' }];
  if (profitProtectionLineCents !== null) floors.push({ cents: profitProtectionLineCents, source: 'PROFIT_PROTECTION_LINE' });
  if (hardLossFloorCents !== null) floors.push({ cents: hardLossFloorCents, source: 'HARD_LOSS_FLOOR' });
  const effective = floors.reduce((best, f) => (f.cents >= best.cents ? f : best));
  const effectiveProtectionLineCents = effective.cents;

  // Available risk (spec §12): NOT clamped — negative values are diagnostics.
  const availableRiskCents = derivedCurrent - effectiveProtectionLineCents;

  // Tier cap (spec §13): before Profit Lock the cap is Base R; after the
  // lock, High R enters the candidates. High R is never a permanent right.
  const tierCapCents = profitLockActive ? highRCents : baseRCents;

  // Legal tier selection (spec §13): highest tier <= cap and <= available.
  const candidates = [highRCents, midRCents, lowRCents].filter(
    (r) => r <= tierCapCents && r <= availableRiskCents
  );
  const allowedRCents = candidates.length > 0 ? Math.max(...candidates) : null;

  // Status (spec §14–§16): BLOCKED only when available risk is exhausted;
  // a positive remainder below Low R becomes Final Risk, never a block.
  let status = 'ALLOWED';
  let reason = 'TRADE_ALLOWED';
  let finalRiskCents = null;

  if (hardLossFloorCents !== null && derivedCurrent <= hardLossFloorCents) {
    status = 'BLOCKED';
    reason = 'HARD_LOSS_FLOOR_REACHED';
  } else if (availableRiskCents <= 0) {
    status = 'BLOCKED';
    reason = 'PROTECTION_LINE_BREACHED';
  } else if (availableRiskCents < lowRCents) {
    status = 'TAIL_RISK';
    reason = 'FINAL_RISK';
    finalRiskCents = availableRiskCents; // Final Risk = remaining available risk
  } else if (allowedRCents < baseRCents) {
    reason = 'RISK_REDUCED';
  }

  return {
    status,
    allowedR: allowedRCents === null ? null : toDollars(allowedRCents),

    lowR: toDollars(lowRCents),
    midR: toDollars(midRCents),
    highR: toDollars(highRCents),
    baseR: toDollars(baseRCents),

    baseUpgradeThreshold: toDollars(baseUpgradeThresholdCents),
    profitLockTrigger: toDollars(profitLockTriggerCents),
    profitLockActive,

    peakRealizedBalance: toDollars(peakRealizedBalanceCents),
    peakRealizedProfit: toDollars(peakRealizedProfitCents),

    dailyCapitalFloor: toDollars(dailyCapitalFloorCents),
    profitProtectionLine:
      profitProtectionLineCents === null ? null : toDollars(profitProtectionLineCents),
    hardLossFloor: hardLossFloorCents === null ? null : toDollars(hardLossFloorCents),
    effectiveProtectionLine: toDollars(effectiveProtectionLineCents),
    bindingFloor: status === 'BLOCKED' ? effective.source : null,

    currentRealizedBalance: toDollars(derivedCurrent),
    availableRisk: toDollars(availableRiskCents),
    tierCap: toDollars(tierCapCents),

    finalRisk: finalRiskCents === null ? null : toDollars(finalRiskCents),

    reason,
  };
}
