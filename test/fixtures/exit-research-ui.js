import { createWorkspace, changeStructure, changeDirection, chooseSetup, markEntered, markExited, recordInitialStop, recordBofToPb } from '../../src/model.js';
import { makeEnvelope } from '../../src/persistence.js';
import { makeUnified } from '../../src/unified-persistence.js';
import { fillRow, orderRow, positionRow, fillsCsv, makeCsv, ORDER_HEADERS, POSITION_HEADERS } from './tradovate/synthetic.js';
export const UI_T = Date.UTC(2037, 0, 1), UI_P = 300000;
export function workbenchFixture() {
  const state = createWorkspace(UI_T - 10000), rawFills = [], rawOrders = [], rawPositions = [], series = [], ids = {};
  function opportunity(symbol, setup, i, stop = 99, conversion = false) {
    const t = UI_T + i * 3600000;
    changeStructure(state, symbol, 'range', t - 4000); changeDirection(state, symbol, 'long', t - 3000);
    chooseSetup(state, symbol, setup, t - 2000); markEntered(state, symbol, t, true);
    if (stop !== null) recordInitialStop(state, symbol, stop, t + 1000);
    if (conversion) recordBofToPb(state, symbol, t + UI_P + 20000);
    markExited(state, symbol, t + 3 * UI_P, true);
    ids[symbol + i] = state.records.at(-1).id;
    return t;
  }
  function execution(product, i, account = 'SYNTHETIC-A', suffix = '') {
    const t = UI_T + i * 3600000, n = `${i}${suffix || '0'}`;
    const enterId = 'synthetic-fill-entry-' + n, exitId = 'synthetic-fill-exit-' + n;
    const entryOrder = 'synthetic-order-entry-' + n, exitOrder = 'synthetic-order-exit-' + n;
    const common = { account, accountId: account, product, contract: product + 'Z9', quantity: '2' };
    rawFills.push(fillRow({ ...common, fillId: enterId, orderId: entryOrder, price: '100', time: new Date(t).toISOString() }), fillRow({ ...common, fillId: exitId, orderId: exitOrder, side: 'Sell', price: '108', time: new Date(t + 3 * UI_P).toISOString() }));
    for (const [id, side, price] of [[entryOrder, 'Buy', '100'], [exitOrder, 'Sell', '108']]) rawOrders.push(orderRow({ 'Order ID': id, orderId: id, Account: account, Contract: common.contract, Product: product, 'B/S': side, avgPrice: price, 'Avg Fill Price': price, decimalFillAvg: price, filledQty: '2', 'Filled Qty': '2' }));
    rawPositions.push(positionRow({ 'Position ID': 'synthetic-position-' + n, 'Pair ID': 'synthetic-pair-' + n, 'Buy Fill ID': enterId, 'Sell Fill ID': exitId, Account: account, Contract: common.contract, Product: product, 'Buy Price': '100', 'Sell Price': '108', 'P/L': '16' }));
    const family = { MGC: 'GC', MES: 'ES', MCL: 'CL' }[product];
    if (!series.some(s => s.researchFamily === family)) {
      const bars = [[100, 107, 99.5, 107], [107, 109, 106, 108], [108, 112, 108, 111], [111, 112, 109, 110]].map(([open, high, low, close], j) => ({ openTime: t + j * UI_P, open, high, low, close, volume: 10 }));
      series.push({ seriesId: 'SYNTHETIC-' + family, role: 'EXECUTION_PRIMARY', provider: 'SYNTHETIC', providerSymbol: 'SYNTH:' + common.contract, researchFamily: family, product, contract: common.contract, priceSourceMode: 'EXACT_EXECUTION_CONTRACT', timeframeMs: UI_P, timestampSemantics: 'BAR_OPEN_TIME', timezone: 'UTC', coverageStart: t, coverageEnd: t + 4 * UI_P, bars });
    }
  }
  opportunity('GC', 'mtf_pb', 0); execution('MGC', 0);
  opportunity('ES', 'htf_bof', 1, 99, true); execution('MES', 1);
  opportunity('CL', 'htf_bof', 2, null); execution('MCL', 2);
  opportunity('GC', 'mtf_pb', 3); execution('MGC', 3, 'SYNTHETIC-A', 'a'); execution('MGC', 3, 'SYNTHETIC-B', 'b');
  return { state, ids, unified: makeUnified(makeEnvelope(state, UI_T + 4 * 3600000)), fills: fillsCsv(rawFills), orders: makeCsv(ORDER_HEADERS, rawOrders), positions: makeCsv(POSITION_HEADERS, rawPositions), bundle: { schemaVersion: 1, source: 'SYNTHETIC-UI-QA', sourceVersion: '1', createdAt: UI_T, series } };
}
