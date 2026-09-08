// Trading Risk Manager V1 — persistence adapter. Persistence ONLY.
// No risk logic here. Future adapters (e.g. Supabase) can replace this module
// without touching the risk engine.

export const STORAGE_KEY = 'trading-risk-manager:v1';

function resolveStorage(storage) {
  if (storage) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

/** Load and parse app state. Corrupt/absent storage returns null — never invents account state. */
export function loadAppState(storage, key = STORAGE_KEY) {
  const store = resolveStorage(storage);
  if (!store) return null;
  const raw = store.getItem(key);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist app state immediately (single write after a fully validated mutation). */
export function saveAppState(state, storage, key = STORAGE_KEY) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Remove persisted state. */
export function clearAppState(storage, key = STORAGE_KEY) {
  const store = resolveStorage(storage);
  if (!store) return false;
  store.removeItem(key);
  return true;
}
