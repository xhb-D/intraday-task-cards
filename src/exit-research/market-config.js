export const DEFAULT_CONTEXT_MARKET_V1 = Object.freeze({ GC: 'GC1!', ES: 'ES1!', CL: 'CL1!' });
export const PRICE_SOURCE_MODES = Object.freeze(['EXACT_EXECUTION_CONTRACT', 'SAME_EXPIRY_LARGE_CONTRACT_PROXY', 'CONTINUOUS_CONTRACT_PROXY']);
export const MARKET_TIMEFRAMES = Object.freeze({ PRIMARY: 300000, DETAIL: 60000, CONTEXT: 1800000 });
export const DETAIL_MODE = 'ON_DEMAND';
export function resolveContextMarket(trade, defaults = DEFAULT_CONTEXT_MARKET_V1) {
  const explicit = typeof trade.contextSymbol === 'string' && trade.contextSymbol.trim() ? trade.contextSymbol : null;
  return { resolvedContextSymbol: explicit ?? defaults[trade.researchFamily] ?? null,
    contextSymbolSource: explicit ? 'TASK_CARD_EXPLICIT' : defaults[trade.researchFamily] ? 'DEFAULT_RESEARCH_CONFIG' : 'UNRESOLVED' };
}
