export function toggleCardCollapsed(collapsedCards, symbol) {
  const next = new Set(collapsedCards);
  if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
  return next;
}
