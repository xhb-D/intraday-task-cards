import { validationError } from './csv.js';
import { assertNormalizedFill } from './tradovate-csv.js';

const clone = value => structuredClone(value);
const unique = values => [...new Set(values)];
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function sum(values, row) {
  let total = 0, compensation = 0;
  for (const value of values) {
    const adjusted = value - compensation;
    const next = total + adjusted;
    compensation = (next - total) - adjusted;
    total = next;
    if (!Number.isFinite(total)) throw validationError('NUMERIC_OVERFLOW', row, 'vwap');
  }
  return total;
}
function vwap(fills) {
  if (!fills.length) return null;
  const quantity = fills.reduce((total, fill) => total + fill.quantity, 0);
  return sum(fills.map(fill => fill.price * fill.quantity), fills.at(-1).sourceRowNumber) / quantity;
}
function outputTrade(facts, net) {
  const entry = facts.entry, exit = facts.exit;
  const entryOrderIds = unique(entry.map(fill => fill.orderId)), exitOrderIds = unique(exit.map(fill => fill.orderId));
  const first = entry[0], lastExit = exit.at(-1);
  const qualityFlags = [];
  if (entryOrderIds.length > 1) qualityFlags.push('MULTI_ENTRY_ORDER');
  if (exitOrderIds.length > 1) qualityFlags.push('MULTI_EXIT_ORDER');
  if (facts.reAdd) qualityFlags.push('RE_ADD_AFTER_EXIT_STARTED');
  if (qualityFlags.length) qualityFlags.push('UNSUPPORTED_SCALE_PATTERN');
  if (net !== 0) qualityFlags.push('OPEN_POSITION_AT_FILE_END');
  const quantity = entry.reduce((total, fill) => total + fill.quantity, 0);
  const exitQuantity = exit.reduce((total, fill) => total + fill.quantity, 0);
  if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(exitQuantity)) throw validationError('NUMERIC_OVERFLOW', first.sourceRowNumber, 'quantity');
  return {
    logicalTradeId: 'lt:' + encodeURIComponent(JSON.stringify([first.accountId, first.contract, first.fillId, net === 0 ? lastExit.fillId : null])),
    status: net === 0 ? 'closed' : 'open', accountId: first.accountId, product: first.product, contract: first.contract, direction: facts.direction,
    quantity, exitQuantity, remainingQuantity: Math.abs(net),
    entryStartedAt: clone(first.time), entryCompletedAt: clone(entry.at(-1).time), entryVwap: vwap(entry),
    exitStartedAt: lastExit ? clone(exit[0].time) : null, exitCompletedAt: net === 0 ? clone(lastExit.time) : null, exitVwap: vwap(exit),
    entryFillIds: entry.map(fill => fill.fillId), exitFillIds: exit.map(fill => fill.fillId), entryOrderIds, exitOrderIds,
    allFillIds: facts.all.map(fill => fill.fillId), sourceRows: facts.all.map(fill => fill.sourceRowNumber), fills: clone(facts.all), qualityFlags
  };
}
export function reconstructLogicalTrades(fills, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['initialPositionMode', 'assumeFlatAtStart'].includes(key))) throw validationError('INVALID_INITIAL_BOUNDARY_OPTIONS', 0, 'options');
  const initialPositionMode = Object.hasOwn(options, 'initialPositionMode') ? options.initialPositionMode : 'REQUIRE_FLAT';
  if (!['REQUIRE_FLAT', 'KNOWN_INITIAL_POSITION'].includes(initialPositionMode)) throw validationError('INVALID_INITIAL_BOUNDARY_OPTIONS', 0, 'initialPositionMode');
  if (Object.hasOwn(options, 'assumeFlatAtStart') && typeof options.assumeFlatAtStart !== 'boolean') throw validationError('INVALID_INITIAL_BOUNDARY_OPTIONS', 0, 'assumeFlatAtStart');
  const assumeFlatAtStart = Object.hasOwn(options, 'assumeFlatAtStart') && options.assumeFlatAtStart === true;
  if (initialPositionMode === 'KNOWN_INITIAL_POSITION' && assumeFlatAtStart) throw validationError('INVALID_INITIAL_BOUNDARY_OPTIONS', 0, 'assumeFlatAtStart');
  if (!Array.isArray(fills)) throw validationError('INVALID_FILLS_INPUT', 0, 'fills');
  const seen = new Set(), groups = new Map();
  for (const fill of fills) {
    assertNormalizedFill(fill);
    if (seen.has(fill.fillId)) throw validationError('DUPLICATE_FILL_ID', fill.sourceRowNumber, 'fillId');
    seen.add(fill.fillId);
    const key = JSON.stringify([fill.accountId, fill.contract]);
    if (!groups.has(key)) groups.set(key, []);
    const group = groups.get(key);
    if (group.length && group[0].product !== fill.product) throw validationError('INCONSISTENT_CONTRACT_PRODUCT', fill.sourceRowNumber, 'product');
    if (group.length && (group[0].time.offsetMinutes === null) !== (fill.time.offsetMinutes === null)) throw validationError('MIXED_TIME_BASIS', fill.sourceRowNumber, 'time');
    if (group.some(previous => previous.sourceRowNumber === fill.sourceRowNumber)) throw validationError('DUPLICATE_SOURCE_ROW', fill.sourceRowNumber, 'sourceRowNumber');
    group.push(fill);
  }
  // Validate source facts, but do not infer any positions without a caller-confirmed boundary.
  if (initialPositionMode === 'KNOWN_INITIAL_POSITION' || !assumeFlatAtStart) return {
    status: initialPositionMode === 'KNOWN_INITIAL_POSITION' ? 'KNOWN_INITIAL_POSITION_UNSUPPORTED' : 'WINDOW_START_FLAT_UNCONFIRMED',
    initialPositionMode, closedTrades: [], openPositions: [], fills: clone(fills),
    metadata: { fillCount: fills.length, groupCount: groups.size, closedTradeCount: null, openPositionCount: null, flagCounts: {} }
  };
  const closedTrades = [], openPositions = [];
  for (const key of [...groups.keys()].sort(compareText)) {
    const sorted = [...groups.get(key)].sort((a, b) => compareText(a.time.sortKey, b.time.sortKey) || a.sourceRowNumber - b.sourceRowNumber);
    let net = 0, facts = null;
    for (const fill of sorted) {
      const signed = fill.side === 'buy' ? fill.quantity : -fill.quantity;
      if (net === 0) facts = { direction: signed > 0 ? 'LONG' : 'SHORT', entry: [], exit: [], all: [], reAdd: false };
      const sameDirection = (facts.direction === 'LONG') === (signed > 0);
      if (!sameDirection && fill.quantity > Math.abs(net)) throw validationError('RECONSTRUCTION_REVERSAL_CROSS_ZERO', fill.sourceRowNumber, 'quantity');
      if (sameDirection) { if (facts.exit.length) facts.reAdd = true; facts.entry.push(fill); }
      else facts.exit.push(fill);
      facts.all.push(fill); net += signed;
      if (!Number.isSafeInteger(net)) throw validationError('NUMERIC_OVERFLOW', fill.sourceRowNumber, 'quantity');
      if (net === 0) { closedTrades.push(outputTrade(facts, net)); facts = null; }
    }
    if (facts) openPositions.push(outputTrade(facts, net));
  }
  const flagCounts = {};
  for (const trade of [...closedTrades, ...openPositions]) for (const flag of trade.qualityFlags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  return { closedTrades, openPositions, fills: clone(fills), metadata: { fillCount: fills.length, groupCount: groups.size, closedTradeCount: closedTrades.length, openPositionCount: openPositions.length, flagCounts } };
}
