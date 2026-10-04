import { initialRisk, rAtPrice } from './r-math.js';
export function calculateProtectionR(previousR, knownMfeR, stage) {
  return Math.max(previousR, stage.givebackPct === null ? previousR : knownMfeR * (1 - stage.givebackPct), stage.minimumLockR ?? previousR);
}
export function protectionAtR(trade, protectionR, executionTickSize = null) {
  const risk = initialRisk(trade, { tickSize: executionTickSize });
  if (!risk.valid || !Number.isFinite(protectionR)) return { valid: false, qualityReasons: risk.qualityReasons.length ? risk.qualityReasons : ['PROTECTION_INVALID'] };
  const theoreticalPrice = trade.actualEntryPrice + (trade.direction === 'LONG' ? 1 : -1) * protectionR * risk.initialRiskPoints;
  let price = theoreticalPrice;
  if (executionTickSize !== null) {
    const units = theoreticalPrice / executionTickSize;
    if (!Number.isFinite(units) || Math.abs(units) > Number.MAX_SAFE_INTEGER) return { valid: false, qualityReasons: ['TICK_NUMERIC_OVERFLOW'] };
    // Correct only floating representation error around a grid point; otherwise round adversely.
    const nearest = Math.round(units), tolerance = Math.min(1e-7, 8 * Number.EPSILON * Math.max(1, Math.abs(units)));
    const gridUnits = Math.abs(units - nearest) <= tolerance ? nearest : trade.direction === 'LONG' ? Math.floor(units) : Math.ceil(units);
    price = gridUnits * executionTickSize;
  }
  const roundedR = rAtPrice(trade, price);
  if (roundedR === null) return { valid: false, qualityReasons: ['PROTECTION_PRICE_INVALID'] };
  return { valid: true, protectionR, theoreticalPrice, price, roundedR, tickSize: executionTickSize,
    qualityReasons: executionTickSize === null ? ['TICK_ROUNDING_UNAVAILABLE'] : [] };
}
