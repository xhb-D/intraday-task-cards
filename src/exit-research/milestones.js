import { thresholdPrice } from './r-math.js';
export const MILESTONE_LEVELS = Object.freeze([2, 4, 6, 8, 10]);
export function holdingMilestones(trade, path) {
  const reached = (price, threshold) => trade.direction === 'LONG' ? price >= threshold : price <= threshold;
  const result = {};
  for (const multiple of MILESTONE_LEVELS) {
    const threshold = thresholdPrice(trade, multiple), confirmed = [], possible = [];
    if (threshold === null) {
      result[`${multiple}R`] = { thresholdPrice: null, status: 'DATA_INCOMPLETE', firstReachedBarOpen: null, firstReachedBarClose: null, firstReachConfirmed: false, qualityFlags: ['R_NUMERIC_OVERFLOW'] }; continue;
    }
    for (const b of path.segments) {
      const extreme = trade.direction === 'LONG' ? b.high : b.low;
      if (!reached(extreme, threshold)) continue;
      const hit = { openTime: b.openTime, closeTime: b.closeTime, seriesId: b.seriesId };
      possible.push(hit);
      if (b.fullyContained) confirmed.push(hit);
    }
    const exitConfirmed = reached(trade.actualExitPrice, threshold), firstPossible = possible[0] ?? null, firstConfirmed = confirmed[0] ?? null;
    const status = firstConfirmed || exitConfirmed ? 'CONFIRMED_REACHED' : path.coverageStatus !== 'COMPLETE' ? 'DATA_INCOMPLETE' : firstPossible ? 'POSSIBLE_BOUNDARY_REACHED' : 'NOT_REACHED';
    const firstReachConfirmed = Boolean(firstConfirmed && firstPossible?.openTime === firstConfirmed.openTime && path.coverageStatus === 'COMPLETE');
    result[`${multiple}R`] = { thresholdPrice: threshold, status,
      firstReachedBarOpen: firstPossible?.openTime ?? null, firstReachedBarClose: firstPossible?.closeTime ?? null,
      firstReachConfirmed, firstConfirmedBarOpen: firstConfirmed?.openTime ?? null, firstConfirmedBarClose: firstConfirmed?.closeTime ?? null,
      confirmedObservationAt: exitConfirmed ? trade.actualExitTime : null, firstReachedSeriesId: firstPossible?.seriesId ?? null,
      qualityFlags: [...path.qualityReasons, ...(!firstReachConfirmed && status === 'CONFIRMED_REACHED' ? ['FIRST_REACH_TIME_UNCERTAIN'] : [])] };
  }
  return result;
}
