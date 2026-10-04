export const SLIPPAGE_MODEL_VERSION = 'NONE_V1';
export function stopFill(direction, bar, stopPrice, closeTime) {
  const long = direction === 'LONG';
  if (long ? bar.open <= stopPrice : bar.open >= stopPrice) return { triggered: true, price: bar.open, time: bar.openTime,
    timeRange: { startAt: bar.openTime, endAt: bar.openTime, semantics: 'MODEL_BAR_OPEN' }, reason: 'STOP_GAP_THROUGH' };
  if (long ? bar.low <= stopPrice : bar.high >= stopPrice) return { triggered: true, price: stopPrice, time: null,
    timeRange: { startAt: bar.openTime, endAt: closeTime, semantics: 'BAR_INTERVAL_END_EXCLUSIVE' }, reason: 'STOP_TRIGGERED' };
  return { triggered: false };
}
export const stopMayBeTouched = (direction, bar, stop) => direction === 'LONG' ? bar.low <= stop : bar.high >= stop;
