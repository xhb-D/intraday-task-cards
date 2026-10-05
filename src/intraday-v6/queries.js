import { ORDER } from '../model.js';

export function assertSymbol(symbol) {
  if (!ORDER.includes(symbol)) throw Object.assign(new Error('未知品种'), { code: 'V6_SYMBOL_INVALID', path: 'symbol' });
}

export function activeOpportunityForSymbol(state, symbol) {
  assertSymbol(symbol);
  const pending = state.records.filter(r => r.symbol === symbol && r.enteredAt === null && r.endedAt === null);
  if (pending.length > 1) throw Object.assign(new Error('同品种存在多个未入场机会'), { code: 'V6_PENDING_CONFLICT', path: 'records' });
  return pending[0] ?? null;
}

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export function activeTradesForSymbol(state, symbol) {
  assertSymbol(symbol);
  return state.records.filter(r => r.symbol === symbol && r.enteredAt !== null && r.endedAt === null)
    .sort((a, b) => a.enteredAt - b.enteredAt || a.registeredAt - b.registeredAt || compareId(a.id, b.id));
}

export function effectiveDirectionForSymbol(state, symbol) {
  const trades = activeTradesForSymbol(state, symbol), pending = activeOpportunityForSymbol(state, symbol);
  const directions = new Set(trades.map(r => r.direction));
  if (directions.size > 1 || trades.length && pending && pending.direction !== trades[0].direction) {
    throw Object.assign(new Error('活动记录交易方向冲突'), { code: 'V6_DIRECTION_CONFLICT', path: 'records' });
  }
  return trades[0]?.direction ?? pending?.direction ?? state.cards[symbol].direction;
}

export function recordLifecycleState(record) {
  return record.endedAt !== null ? 'ended' : record.enteredAt !== null ? 'position' : record.attention;
}
