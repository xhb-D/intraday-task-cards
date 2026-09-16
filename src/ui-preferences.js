export const COMMODITY_PREFERENCES_KEY = 'intraday-task-cards:v1:commodity-preferences';

export function toggleCardCollapsed(collapsedCards, symbol) {
  const next = new Set(collapsedCards);
  if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
  return next;
}

export function normalizeCommodityPreferences(value, symbols) {
  const allowed = new Set(symbols);
  const hiddenSymbols = Array.isArray(value?.hiddenSymbols)
    ? [...new Set(value.hiddenSymbols.filter(symbol => allowed.has(symbol)))]
    : [];
  return {
    hiddenSymbols,
    managerExpanded: hiddenSymbols.length > 0 && value?.managerExpanded === true,
  };
}

export function loadCommodityPreferences(storage, symbols) {
  try {
    const raw = storage?.getItem?.(COMMODITY_PREFERENCES_KEY);
    return normalizeCommodityPreferences(raw ? JSON.parse(raw) : null, symbols);
  } catch (_) {
    return normalizeCommodityPreferences(null, symbols);
  }
}

export function saveCommodityPreferences(storage, preferences, symbols) {
  const normalized = normalizeCommodityPreferences(preferences, symbols);
  try {
    storage?.setItem?.(COMMODITY_PREFERENCES_KEY, JSON.stringify(normalized));
    return true;
  } catch (_) {
    return false;
  }
}

export function setCommodityHidden(preferences, symbol, hidden, symbols) {
  const current = normalizeCommodityPreferences(preferences, symbols);
  const next = new Set(current.hiddenSymbols);
  if (hidden) next.add(symbol); else next.delete(symbol);
  return normalizeCommodityPreferences({ hiddenSymbols: [...next], managerExpanded: current.managerExpanded }, symbols);
}

export function setCommodityManagerExpanded(preferences, managerExpanded, symbols) {
  return normalizeCommodityPreferences({ ...preferences, managerExpanded }, symbols);
}

export function visibleCommoditySymbols(symbols, preferences) {
  const hidden = new Set(normalizeCommodityPreferences(preferences, symbols).hiddenSymbols);
  return symbols.filter(symbol => !hidden.has(symbol));
}

export function preserveScrollPosition(render, viewport = globalThis) {
  const scrollX = Number.isFinite(viewport?.scrollX) ? viewport.scrollX : 0;
  const scrollY = Number.isFinite(viewport?.scrollY) ? viewport.scrollY : 0;
  const restore = () => viewport?.scrollTo?.(scrollX, scrollY);
  try {
    return render();
  } finally {
    restore();
    viewport?.requestAnimationFrame?.(restore);
  }
}
