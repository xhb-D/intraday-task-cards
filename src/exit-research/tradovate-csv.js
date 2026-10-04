import { parseCsv, validationError } from './csv.js';
import { parseTradovateTime } from './time.js';

const requiredHeaders = {
  fills: ['Fill ID', 'Order ID', 'Contract', 'Product', 'B/S', 'Quantity', 'Price', 'Timestamp'],
  orders: ['Order ID', 'Contract', 'Product', 'B/S', 'Quantity', 'Type', 'Status', 'Timestamp'],
  positions: ['Position ID', 'Contract', 'Product', 'Net Pos', 'Bought', 'Sold', 'Paired Qty', 'P/L', 'Timestamp']
};
const decimal = /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
function context(raw, sourceRowNumber) {
  const numericRepresentationDifferences = [];
  const fail = (code, field) => { throw validationError(code, sourceRowNumber, field); };
  const id = (field, optional = false) => {
    const value = raw[field]?.trim();
    if (!value) { if (optional) return null; fail('INVALID_ID', field); }
    return value;
  };
  const number = (field, { optional = false, positive = false, integer = false, nonnegative = false } = {}) => {
    const value = raw[field]?.trim();
    if (!value) { if (optional) return null; fail('INVALID_NUMBER', field); }
    if (!decimal.test(value)) fail('INVALID_NUMBER', field);
    const parsed = Number(value.replaceAll(',', ''));
    if (!Number.isFinite(parsed) || (positive && parsed <= 0) || (nonnegative && parsed < 0) || (integer && !Number.isSafeInteger(parsed))) fail('INVALID_NUMBER', field);
    return parsed;
  };
  const time = (field, optional = false) => {
    if (!raw[field]?.trim() && optional) return null;
    return parseTradovateTime(raw[field], sourceRowNumber, field);
  };
  const side = () => {
    const value = raw['B/S']?.trim();
    if (!['Buy', 'Sell'].includes(value)) fail('INVALID_SIDE', 'B/S');
    return value.toLowerCase();
  };
  const has = field => Object.hasOwn(raw, field);
  const account = () => ({ accountId: has('_accountId') ? id('_accountId') : has('Account') ? id('Account') : null, accountLabel: has('Account') ? id('Account') : null });
  const aliasId = (field, expected) => { if (has(field) && id(field) !== expected) fail('INCONSISTENT_ALIAS', field); };
  const aliasNumber = (field, expected, options = {}, comparedWith = null) => {
    if (!has(field)) return;
    const actual = number(field, options);
    if (actual === expected) return;
    // A display column is not an exact binary-float serialization. Keep both values.
    if (!comparedWith || actual === null || expected === null || Math.abs(actual - expected) > 8 * Number.EPSILON * Math.max(Math.abs(actual), Math.abs(expected))) fail('INCONSISTENT_ALIAS', field);
    numericRepresentationDifferences.push({ field, comparedWith });
  };
  return { fail, id, number, time, side, has, account, aliasId, aliasNumber, numericRepresentationDifferences };
}
function parse(text, kind, normalize) {
  const parsed = parseCsv(text);
  for (const header of requiredHeaders[kind]) if (!parsed.headers.includes(header)) throw validationError('MISSING_HEADER', 1, header);
  const rows = parsed.rows.map(row => {
    const raw = Object.fromEntries(parsed.headers.map((header, index) => [header, row.values[index]]));
    return normalize(raw, row.sourceRowNumber);
  });
  return { headers: [...parsed.headers], rows, metadata: { ...parsed.metadata, kind, formatVersion: 1,
    accountField: parsed.headers.includes('_accountId') ? '_accountId' : parsed.headers.includes('Account') ? 'Account' : null,
    primaryTimeField: kind === 'fills' && parsed.headers.includes('_timestamp') ? '_timestamp' : 'Timestamp',
    localTimezone: 'unknown', externalTimezoneConfigPending: true,
    numericRepresentationDifferenceCount: rows.reduce((count, row) => count + row.numericRepresentationDifferences.length, 0) } };
}
function normalizeFill(raw, sourceRowNumber) {
  const c = context(raw, sourceRowNumber);
  const fillId = c.id('Fill ID'), orderId = c.id('Order ID');
  const quantity = c.number('Quantity', { positive: true, integer: true });
  const displayedPrice = c.number('Price', { positive: true });
  const price = c.has('_price') ? c.number('_price', { positive: true }) : displayedPrice;
  c.aliasId('_id', fillId); c.aliasId('_orderId', orderId);
  c.aliasNumber('_qty', quantity, { positive: true, integer: true }); c.aliasNumber('_price', displayedPrice, { positive: true }, 'Price');
  const displayedTime = c.time('Timestamp');
  const time = c.has('_timestamp') ? c.time('_timestamp') : displayedTime;
  let active = null;
  if (c.has('_active')) {
    if (!['true', 'false'].includes(raw._active.trim())) c.fail('INVALID_BOOLEAN', '_active');
    active = raw._active.trim() === 'true';
  }
  return { fillId, orderId, ...c.account(), product: c.id('Product'), contract: c.id('Contract'), contractId: c.id('_contractId', true),
    side: c.side(), quantity, price, displayedPrice, priceSourceField: c.has('_price') ? '_price' : 'Price', fillTimeRaw: time.raw, normalizedLocalTime: displayedTime.normalized,
    displayedTimeRaw: displayedTime.raw, time, displayedTime, active,
    commission: c.number('commission', { optional: true }), tradeDateRaw: raw._tradeDate ?? raw.Date ?? null,
    sourceRowNumber, numericRepresentationDifferences: c.numericRepresentationDifferences, rawFields: { ...raw } };
}
export function parseTradovateFillsCsv(text) {
  const result = parse(text, 'fills', normalizeFill);
  const seen = new Set();
  for (const row of result.rows) {
    if (seen.has(row.fillId)) throw validationError('DUPLICATE_FILL_ID', row.sourceRowNumber, 'Fill ID');
    seen.add(row.fillId);
  }
  return result;
}
export function parseTradovateOrdersCsv(text) {
  return parse(text, 'orders', (raw, sourceRowNumber) => {
    const c = context(raw, sourceRowNumber);
    const orderId = c.id('Order ID'); c.aliasId('orderId', orderId);
    const filledQuantity = c.number('Filled Qty', { optional: true, nonnegative: true, integer: true });
    const averageFillPrice = c.number('Avg Fill Price', { optional: true, positive: true });
    const reportedLimitPrice = c.number('Limit Price', { optional: true, positive: true });
    const reportedStopPrice = c.number('Stop Price', { optional: true, positive: true });
    c.aliasNumber('filledQty', filledQuantity, { optional: true, nonnegative: true, integer: true });
    c.aliasNumber('avgPrice', averageFillPrice, { optional: true, positive: true }, 'Avg Fill Price');
    c.aliasNumber('decimalFillAvg', averageFillPrice, { optional: true, positive: true }, 'Avg Fill Price');
    c.aliasNumber('decimalLimit', reportedLimitPrice, { optional: true, positive: true }, 'Limit Price');
    c.aliasNumber('decimalStop', reportedStopPrice, { optional: true, positive: true }, 'Stop Price');
    return { orderId, versionId: c.id('Version ID', true), lastCommandId: c.id('lastCommandId', true), ...c.account(),
      contract: c.id('Contract'), product: c.id('Product'), side: c.side(), quantity: c.number('Quantity', { positive: true, integer: true }),
      orderType: c.id('Type'), status: c.id('Status'), filledQuantity,
      averageFillPrice: c.has('decimalFillAvg') ? c.number('decimalFillAvg', { optional: true, positive: true }) : c.has('avgPrice') ? c.number('avgPrice', { optional: true, positive: true }) : averageFillPrice,
      reportedLimitPrice: c.has('decimalLimit') ? c.number('decimalLimit', { optional: true, positive: true }) : reportedLimitPrice,
      reportedStopPrice: c.has('decimalStop') ? c.number('decimalStop', { optional: true, positive: true }) : reportedStopPrice,
      orderTime: c.time('Timestamp'), fillTime: c.time('Fill Time', true), dateRaw: raw.Date ?? null,
      notionalValue: c.number('Notional Value', { optional: true }), currency: c.id('Currency', true), sourceRowNumber, numericRepresentationDifferences: c.numericRepresentationDifferences, rawFields: { ...raw } };
  });
}
export function parseTradovatePositionHistoryCsv(text) {
  return parse(text, 'positions', (raw, sourceRowNumber) => {
    const c = context(raw, sourceRowNumber);
    return { positionId: c.id('Position ID'), pairId: c.id('Pair ID', true), buyFillId: c.id('Buy Fill ID', true), sellFillId: c.id('Sell Fill ID', true),
      ...c.account(), contract: c.id('Contract'), product: c.id('Product'),
      netQuantity: c.number('Net Pos', { integer: true }), netPrice: c.number('Net Price', { optional: true }),
      boughtQuantity: c.number('Bought', { nonnegative: true, integer: true }), soldQuantity: c.number('Sold', { nonnegative: true, integer: true }),
      pairedQuantity: c.number('Paired Qty', { positive: true, integer: true }),
      averageBuyPrice: c.number('Avg. Buy', { optional: true, positive: true }), averageSellPrice: c.number('Avg. Sell', { optional: true, positive: true }),
      buyPrice: c.number('Buy Price', { optional: true, positive: true }), sellPrice: c.number('Sell Price', { optional: true, positive: true }),
      pnl: c.number('P/L'), currency: c.id('Currency', true), time: c.time('Timestamp'), boughtTime: c.time('Bought Timestamp', true),
      soldTime: c.time('Sold Timestamp', true), tradeDateRaw: raw['Trade Date'] ?? null, sourceRowNumber, numericRepresentationDifferences: c.numericRepresentationDifferences, rawFields: { ...raw } };
  });
}

// Reconstruction also validates direct callers; parser success is not an implicit trust boundary.
export function assertNormalizedFill(fill) {
  const row = Number.isSafeInteger(fill?.sourceRowNumber) && fill.sourceRowNumber >= 2 ? fill.sourceRowNumber : 0;
  const fail = (code, field) => { throw validationError(code, row, field); };
  if (!row) fail('INVALID_NORMALIZED_FILL', 'sourceRowNumber');
  for (const field of ['fillId', 'orderId', 'contract', 'product']) if (typeof fill[field] !== 'string' || !fill[field].trim() || fill[field] !== fill[field].trim()) fail('INVALID_NORMALIZED_FILL', field);
  if (fill.accountId !== null && (typeof fill.accountId !== 'string' || !fill.accountId.trim() || fill.accountId !== fill.accountId.trim())) fail('INVALID_NORMALIZED_FILL', 'accountId');
  if (!['buy', 'sell'].includes(fill.side)) fail('INVALID_SIDE', 'side');
  if (!Number.isSafeInteger(fill.quantity) || fill.quantity <= 0) fail('INVALID_NUMBER', 'quantity');
  if (typeof fill.price !== 'number' || !Number.isFinite(fill.price) || fill.price <= 0) fail('INVALID_NUMBER', 'price');
  if (fill.active !== null && typeof fill.active !== 'boolean') fail('INVALID_NORMALIZED_FILL', 'active');
  if (fill.active === false) fail('INACTIVE_FILL_UNSUPPORTED', 'active');
  const time = parseTradovateTime(fill.fillTimeRaw, row, 'fillTimeRaw');
  if (!fill.time || ['raw', 'normalized', 'sortKey', 'timezone', 'offsetMinutes'].some(key => fill.time[key] !== time[key])) fail('INVALID_NORMALIZED_FILL', 'time');
  return true;
}
