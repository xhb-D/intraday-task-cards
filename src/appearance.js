export const APPEARANCE_STORAGE_KEY = 'trading-risk-manager:appearance';

export function normalizeAppearance(value) {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readAppearance(storage = globalThis.localStorage) {
  try { return normalizeAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY)); }
  catch (_) { return 'system'; }
}

export function applyAppearance(mode, root = document.documentElement) {
  const normalized = normalizeAppearance(mode);
  if (!root || typeof root.setAttribute !== 'function' || typeof root.removeAttribute !== 'function') return normalized;
  if (normalized === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', normalized);
  return normalized;
}

export function initAppearance(select, storage = globalThis.localStorage, root = document.documentElement, onChange = null) {
  if (!select || typeof select.addEventListener !== 'function') return { render: value => applyAppearance(value, root) };
  const render = value => { select.value = applyAppearance(value, root); };
  render(readAppearance(storage));
  select.addEventListener('change', () => {
    const next = normalizeAppearance(select.value);
    // Unified storage is authoritative when a controller is supplied.  The
    // legacy appearance key remains read-only for first-run migration.
    if (onChange) { if (onChange(next) !== false) render(next); return; }
    try { storage?.setItem(APPEARANCE_STORAGE_KEY, next); } catch (_) { /* session-only appearance */ }
    render(next);
  });
  globalThis.window?.addEventListener?.('storage', event => {
    if (event.key === APPEARANCE_STORAGE_KEY) render(event.newValue);
  });
  return { render };
}
