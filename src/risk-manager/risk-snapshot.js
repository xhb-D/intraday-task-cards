// Trading Risk Manager V2 — risk snapshot construction.
// PURE module: no DOM, no localStorage, no clock.
//
// A session's risk parameters are FROZEN at session start:
//   - V2 snapshots derive R from Hard Loss Amount (5% / 7.5% / 10%) and
//     the Base upgrade threshold from Risk Reference Balance + 60% cushion.
//   - Legacy V1 snapshots freeze the old capital-scaled tiers so an active
//     V1 session continues unchanged after migration.
//
// Config changes (Risk Reference Balance / Hard Loss Amount) never recompute
// an active session's snapshot — they apply to the NEXT session only.

const CENTS_SCALE = 100;

function round2(dollars) {
  return Math.round(dollars * CENTS_SCALE) / CENTS_SCALE;
}

/**
 * V2 snapshot — the single legal R model.
 * R tiers scale ONLY from Hard Loss Amount:
 *   Low  = 5%, Mid = 7.5%, High = 10%
 * Base upgrade threshold = Risk Reference Balance + 60% × Hard Loss Amount.
 * Base R = Mid only at/above the threshold, otherwise Low. Never High.
 */
export function computeV2Snapshot({ riskReferenceBalance, hardLossAmount, previousEodBalance }) {
  if (!(typeof riskReferenceBalance === 'number' && Number.isFinite(riskReferenceBalance) && riskReferenceBalance > 0)) {
    throw new Error('风险参考余额必须是正数');
  }
  if (!(typeof hardLossAmount === 'number' && Number.isFinite(hardLossAmount) && hardLossAmount > 0)) {
    throw new Error('最大亏损额度必须是正数');
  }
  if (!(typeof previousEodBalance === 'number' && Number.isFinite(previousEodBalance) && previousEodBalance > 0)) {
    throw new Error('上一交易日 EOD 余额必须是正数');
  }
  const lowR = round2(hardLossAmount * 0.05);
  const midR = round2(hardLossAmount * 0.075);
  const highR = round2(hardLossAmount * 0.1);
  const baseUpgradeCushion = round2(hardLossAmount * 0.6);
  const baseUpgradeThreshold = round2(riskReferenceBalance + baseUpgradeCushion);
  const baseR = previousEodBalance >= baseUpgradeThreshold ? midR : lowR;
  return {
    version: 2,
    sessionRiskReferenceBalance: riskReferenceBalance,
    sessionHardLossAmount: hardLossAmount,
    lowR,
    midR,
    highR,
    baseUpgradeCushion,
    baseUpgradeThreshold,
    baseR,
  };
}

/**
 * Legacy V1 snapshot — migration only. Freezes the old capital-scaled tiers
 * (Risk Base Capital / 50000 reference) for an already-active session so its
 * Low/Mid/High R, Base R and thresholds never change mid-session.
 */
export function computeLegacySnapshot({ sessionRiskBaseCapital, previousEodBalance }) {
  if (!(typeof sessionRiskBaseCapital === 'number' && Number.isFinite(sessionRiskBaseCapital) && sessionRiskBaseCapital > 0)) {
    throw new Error('sessionRiskBaseCapital 必须是正数');
  }
  if (!(typeof previousEodBalance === 'number' && Number.isFinite(previousEodBalance) && previousEodBalance > 0)) {
    throw new Error('上一交易日 EOD 余额必须是正数');
  }
  const scale = sessionRiskBaseCapital / 50000;
  const lowR = round2(100 * scale);
  const midR = round2(150 * scale);
  const highR = round2(200 * scale);
  const baseUpgradeThreshold = round2(sessionRiskBaseCapital * 1.024);
  const baseR = previousEodBalance >= baseUpgradeThreshold ? midR : lowR;
  return {
    version: 1,
    sessionRiskBaseCapital,
    lowR,
    midR,
    highR,
    baseUpgradeCushion: null,
    baseUpgradeThreshold,
    baseR,
  };
}
