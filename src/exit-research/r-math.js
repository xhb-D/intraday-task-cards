export function initialRisk(trade, { tickSize = null } = {}) {
  const entry = trade.actualEntryPrice, stop = trade.initialStop;
  const initialRiskPoints = Math.abs(entry - stop);
  const valid = ['LONG', 'SHORT'].includes(trade.direction) && Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && stop > 0 &&
    Number.isFinite(initialRiskPoints) && initialRiskPoints > 0 && (trade.direction === 'LONG' ? stop < entry : stop > entry);
  if (!valid) return { valid: false, initialRiskPoints: null, initialRiskTicks: null, qualityReasons: [stop === null || stop === undefined ? 'INITIAL_STOP_MISSING' : 'INITIAL_STOP_INVALID'] };
  if (tickSize !== null && (!Number.isFinite(tickSize) || tickSize <= 0)) return { valid: false, initialRiskPoints: null, initialRiskTicks: null, qualityReasons: ['EXECUTION_TICK_SIZE_INVALID'] };
  const ticks = tickSize === null ? null : initialRiskPoints / tickSize;
  if (ticks !== null && !Number.isFinite(ticks)) return { valid: false, initialRiskPoints: null, initialRiskTicks: null, qualityReasons: ['R_NUMERIC_OVERFLOW'] };
  return { valid: true, initialRiskPoints, initialRiskTicks: ticks, qualityReasons: [] };
}
export function rAtPrice(trade, price) {
  const risk = initialRisk(trade);
  if (!risk.valid || !Number.isFinite(price) || price <= 0) return null;
  const result = (trade.direction === 'LONG' ? price - trade.actualEntryPrice : trade.actualEntryPrice - price) / risk.initialRiskPoints;
  return Number.isFinite(result) ? result : null;
}
export function thresholdPrice(trade, multiple) {
  const risk = initialRisk(trade);
  if (!risk.valid || !Number.isFinite(multiple) || multiple < 0) return null;
  const result = trade.actualEntryPrice + (trade.direction === 'LONG' ? 1 : -1) * multiple * risk.initialRiskPoints;
  return Number.isFinite(result) ? result : null;
}
