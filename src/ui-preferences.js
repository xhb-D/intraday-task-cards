export function toggleCardCollapsed(collapsedCards, symbol) {
  const next = new Set(collapsedCards);
  if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
  return next;
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
