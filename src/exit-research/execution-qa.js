import { assertNormalizedFill } from './tradovate-csv.js';
import { clone, flag, samePrice, uniqueSorted, indexById, fail } from './research-common.js';

const statusOf = flags => flags.some(f => f.severity === 'blocking') ? 'CONFLICT' :
  flags.some(f => f.code.endsWith('_MISSING') || f.code.endsWith('_INCOMPLETE')) ? 'INSUFFICIENT_DATA' :
    flags.some(f => f.severity === 'review-required') ? 'WARNING' : 'PASS';
const compatible = (row, fill) => row.contract === fill.contract && row.product === fill.product &&
  (!row.accountLabel || !fill.accountLabel || row.accountLabel === fill.accountLabel);
const summarize = (flags, extra) => ({ status: statusOf(flags), ...extra, flags });

export function assessExecutionQa(trades, orders = [], positionHistory = [], { fills = null } = {}) {
  const tradeMap = indexById(trades, 'logicalTradeId');
  // Global order totals must include open positions when the caller has them.
  const sourceFills = fills ?? trades.flatMap(trade => trade.fills);
  const fillMap = indexById(sourceFills, 'fillId');
  sourceFills.forEach(assertNormalizedFill);
  const ordersById = new Map(), pairsById = new Map(), unkeyedPairs = [];
  for (const order of orders) {
    if (!order.orderId) fail('INVALID_ORDER_ID');
    if (!ordersById.has(order.orderId)) ordersById.set(order.orderId, []);
    ordersById.get(order.orderId).push(order);
  }
  for (const pair of positionHistory) {
    if (!pair.pairId) { unkeyedPairs.push(pair); continue; }
    if (!pairsById.has(pair.pairId)) pairsById.set(pair.pairId, []);
    pairsById.get(pair.pairId).push(pair);
  }
  const result = {};
  for (const [id, trade] of [...tradeMap].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const orderFlags = [], matchedOrderIds = [], orderTypes = [];
    for (const orderId of uniqueSorted([...trade.entryOrderIds, ...trade.exitOrderIds])) {
      const rows = ordersById.get(orderId) || [];
      if (!rows.length) { orderFlags.push(flag('ORDER_RECORD_MISSING')); continue; }
      matchedOrderIds.push(orderId);
      orderTypes.push({ orderId, types: uniqueSorted(rows.map(row => row.orderType)) });
      const group = sourceFills.filter(fill => fill.orderId === orderId);
      if (!group.length || rows.some(row => group.some(fill => !compatible(row, fill) || row.side !== fill.side))) {
        orderFlags.push(flag('ORDER_IDENTITY_CONFLICT', 'blocking')); continue;
      }
      const quantity = group.reduce((n, fill) => n + fill.quantity, 0);
      const price = group.reduce((n, fill) => n + fill.quantity * fill.price, 0) / quantity;
      if (!rows.some(row => row.filledQuantity === quantity && samePrice(row.averageFillPrice, price))) {
        orderFlags.push(flag(rows.every(row => row.filledQuantity === null || row.averageFillPrice === null) ? 'ORDER_TOTALS_INCOMPLETE' : 'ORDER_TOTALS_CONFLICT',
          rows.every(row => row.filledQuantity === null || row.averageFillPrice === null) ? 'review-required' : 'blocking'));
      }
    }
    if (trade.entryOrderIds.length > 1) orderFlags.push(flag('MULTI_ENTRY_ORDER_LINKED', 'informational'));
    if (trade.exitOrderIds.length > 1) orderFlags.push(flag('MULTI_EXIT_ORDER_LINKED', 'informational'));
    const historyFlags = [], matchedPairIds = [], positionIds = [], allocation = new Map();
    const tradeIds = new Set(trade.allFillIds);
    for (const [pairId, rows] of [...pairsById, ...unkeyedPairs.map(row => [null, [row]])]) {
      if (!rows.some(row => tradeIds.has(row.buyFillId) || tradeIds.has(row.sellFillId))) continue;
      if (pairId === null) { historyFlags.push(flag('PAIR_ID_MISSING')); continue; }
      matchedPairIds.push(pairId);
      if (rows.length !== 1) { historyFlags.push(flag('PAIR_ID_DUPLICATED', 'blocking')); continue; }
      const pair = rows[0], buy = fillMap.get(pair.buyFillId), sell = fillMap.get(pair.sellFillId);
      positionIds.push(pair.positionId);
      if (!buy || !sell) { historyFlags.push(flag('PAIR_FILL_MISSING')); continue; }
      if (!tradeIds.has(buy.fillId) || !tradeIds.has(sell.fillId)) { historyFlags.push(flag('PAIR_CROSSES_LOGICAL_TRADES', 'blocking')); continue; }
      if (buy.side !== 'buy' || sell.side !== 'sell' || !compatible(pair, buy) || !compatible(pair, sell) || buy.accountId !== sell.accountId) historyFlags.push(flag('PAIR_IDENTITY_CONFLICT', 'blocking'));
      if (!Number.isSafeInteger(pair.pairedQuantity) || pair.pairedQuantity <= 0) { historyFlags.push(flag('PAIR_QUANTITY_CONFLICT', 'blocking')); continue; }
      for (const fill of [buy, sell]) allocation.set(fill.fillId, (allocation.get(fill.fillId) || 0) + pair.pairedQuantity);
      if (pair.buyPrice === null || pair.sellPrice === null) historyFlags.push(flag('PAIR_PRICE_INCOMPLETE'));
      else if (!samePrice(pair.buyPrice, buy.price) || !samePrice(pair.sellPrice, sell.price)) historyFlags.push(flag('PAIR_PRICE_CONFLICT', 'blocking'));
      // P/L amount needs contract point value and fee semantics, absent from this API.
      // Check direction relationship only; fees can change the sign of a small profit.
      const movement = sell.price - buy.price;
      if (pair.pnl === null) historyFlags.push(flag('PAIR_PNL_INCOMPLETE'));
      else if (movement === 0 ? pair.pnl > 0 : Math.sign(movement) !== Math.sign(pair.pnl)) historyFlags.push(flag('PAIR_PNL_SIGN_REVIEW'));
    }
    if (!matchedPairIds.length) historyFlags.push(flag('POSITION_HISTORY_MISSING'));
    for (const fillId of trade.allFillIds) {
      const fill = fillMap.get(fillId), allocated = allocation.get(fillId) || 0;
      if (!fill) { historyFlags.push(flag('EXECUTION_FILL_MISSING', 'blocking')); continue; }
      if (allocated > fill.quantity) historyFlags.push(flag('PAIR_ALLOCATION_CONFLICT', 'blocking'));
      else if (allocated < fill.quantity) historyFlags.push(flag('PAIR_ALLOCATION_INCOMPLETE'));
    }
    historyFlags.push(flag('PNL_AMOUNT_UNVERIFIED', 'informational'));
    result[id] = {
      orders: summarize(orderFlags, { matchedOrderIds, entryOrderIds: clone(trade.entryOrderIds), exitOrderIds: clone(trade.exitOrderIds), orderTypes }),
      positionHistory: summarize(historyFlags, { matchedPairIds: uniqueSorted(matchedPairIds), positionIds: uniqueSorted(positionIds), pnlAmountVerified: false })
    };
  }
  return result;
}
