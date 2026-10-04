import { clone, samePrice, uniqueSorted } from './research-common.js';
import { rAtPrice } from './r-math.js';
const sameMarket = (a, b) => ['provider', 'providerSymbol', 'researchFamily', 'product', 'contract', 'priceSourceMode'].every(key => a[key] === b[key]) && (a.proxyForContract ?? null) === (b.proxyForContract ?? null);
export function analyzeHoldingPath(trade, primary, detail = null) {
  const startAt = trade.actualEntryTime, endAt = trade.actualExitTime, flags = [], segments = [], coverageGaps = [];
  if (detail && (!sameMarket(primary, detail) || detail.role !== 'EXECUTION_DETAIL')) return { valid: false, qualityReasons: ['DETAIL_MARKET_MISMATCH'] };
  if (detail && (detail.timeframeMs >= primary.timeframeMs || primary.timeframeMs % detail.timeframeMs !== 0)) return { valid: false, qualityReasons: ['DETAIL_TIMEFRAME_INVALID'] };
  const relevant = primary.bars.filter(bar => bar.openTime < endAt && bar.openTime + primary.timeframeMs > startAt);
  let cursor = startAt, detailUsed = false;
  for (const bar of relevant) {
    const closeAt = bar.openTime + primary.timeframeMs;
    if (bar.openTime > cursor) coverageGaps.push({ startAt: cursor, endAt: Math.min(bar.openTime, endAt) });
    cursor = Math.max(cursor, Math.min(closeAt, endAt));
    const boundary = bar.openTime < startAt || closeAt > endAt;
    const fine = detail?.bars.filter(b => b.openTime >= bar.openTime && b.openTime + detail.timeframeMs <= closeAt) ?? [];
    const completeDetail = detail && fine.length === primary.timeframeMs / detail.timeframeMs && fine.every((b, i) => b.openTime === bar.openTime + i * detail.timeframeMs);
    if (completeDetail && (!samePrice(fine[0].open, bar.open) || !samePrice(fine.at(-1).close, bar.close) ||
      !samePrice(fine.reduce((value, b) => Math.max(value, b.high), -Infinity), bar.high) || !samePrice(fine.reduce((value, b) => Math.min(value, b.low), Infinity), bar.low))) return { valid: false, qualityReasons: ['DETAIL_AGGREGATION_CONFLICT'] };
    const selected = completeDetail ? fine.map(b => ({ bar: b, timeframeMs: detail.timeframeMs, seriesId: detail.seriesId })) : [{ bar, timeframeMs: primary.timeframeMs, seriesId: primary.seriesId }];
    if (completeDetail) detailUsed = true;
    else if (boundary && detail) flags.push('DETAIL_COVERAGE_INCOMPLETE');
    for (const item of selected) {
      const b = item.bar, end = b.openTime + item.timeframeMs;
      if (b.openTime >= endAt || end <= startAt) continue;
      const fullyContained = b.openTime >= startAt && end <= endAt;
      if (!fullyContained) flags.push('INTRABAR_BOUNDARY_AMBIGUOUS');
      segments.push({ ...clone(b), timeframeMs: item.timeframeMs, seriesId: item.seriesId, closeTime: end, fullyContained,
        entryOverlap: b.openTime < startAt, exitOverlap: end > endAt });
    }
  }
  if (cursor < endAt) coverageGaps.push({ startAt: cursor, endAt });
  // A zero-duration position needs a bar covering its instant, never a fabricated interval.
  if (startAt === endAt && !primary.bars.some(b => b.openTime <= startAt && b.openTime + primary.timeframeMs > startAt)) coverageGaps.push({ startAt, endAt });
  const complete = !coverageGaps.length && (relevant.length > 0 || startAt === endAt);
  if (!complete) flags.push('MARKET_DATA_INCOMPLETE');
  if (primary.bars.some((b, i) => i > 0 && b.openTime > primary.bars[i - 1].openTime + primary.timeframeMs && primary.bars[i - 1].openTime + primary.timeframeMs < endAt && b.openTime > startAt)) flags.push('MARKET_DATA_GAP');
  return { valid: true, holdingWindow: { startAt, endAt, intervalSemantics: 'CLOSED' }, segments,
    coverageStatus: complete ? 'COMPLETE' : 'INCOMPLETE', coverageGaps, detailModeUsed: detailUsed ? 'ON_DEMAND' : 'NONE', qualityReasons: uniqueSorted(flags) };
}
export function holdingExcursions(trade, path) {
  const confirmed = [trade.actualEntryPrice, trade.actualExitPrice], possible = [...confirmed];
  for (const bar of path.segments) {
    possible.push(bar.high, bar.low);
    // Boundary OHLC has no timestamp for its first/last print. Only wholly
    // held bars and the independently known execution endpoints are confirmed.
    if (bar.fullyContained) confirmed.push(bar.high, bar.low);
  }
  if (possible.some(price => rAtPrice(trade, price) === null)) return { valid: false, qualityReasons: ['R_NUMERIC_OVERFLOW'] };
  const extreme = (values, favorable) => values.reduce((best, price) => {
    const r = rAtPrice(trade, price), chosen = rAtPrice(trade, best);
    return (favorable ? r > chosen : r < chosen) ? price : best;
  });
  function output(favorable) {
    const confirmedPrice = extreme(confirmed, favorable), possibleExtremePrice = extreme(possible, favorable);
    const confirmedSignedR = rAtPrice(trade, confirmedPrice), possibleSignedR = rAtPrice(trade, possibleExtremePrice);
    const magnitude = r => Math.max(0, favorable ? r : -r);
    const exact = path.coverageStatus === 'COMPLETE' && confirmedPrice === possibleExtremePrice;
    return { exact, partial: path.coverageStatus !== 'COMPLETE', confirmedR: magnitude(confirmedSignedR),
      possibleMaxR: path.coverageStatus === 'COMPLETE' ? magnitude(possibleSignedR) : null,
      confirmedPrice, possibleExtremePrice: path.coverageStatus === 'COMPLETE' ? possibleExtremePrice : null,
      ...(favorable ? {} : { worstR: confirmedSignedR }), qualityFlags: [...path.qualityReasons] };
  }
  return { mfe: output(true), mae: output(false) };
}
