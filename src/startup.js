import { copy, createWorkspace } from './model.js';
import { deserialize, serialize, STORE_KEY } from './persistence.js';

// Startup must always produce a usable in-memory workspace. Storage is optional.
export function loadInitialWorkspace(storage, time = Date.now()) {
  const blank = createWorkspace(time);
  if (!storage || typeof storage.getItem !== 'function') {
    return { state: blank, mode: 'storage-unavailable', lastRaw: null, error: 'StorageUnavailable' };
  }
  let raw;
  try {
    raw = storage.getItem(STORE_KEY);
  } catch (error) {
    return { state: blank, mode: 'storage-unavailable', lastRaw: null, error: error.name || 'StorageError' };
  }
  if (raw === null) return { state: blank, mode: 'blank', lastRaw: null };
  try {
    const envelope = deserialize(raw);
    const state = copy(envelope.state);
    state.lastSavedAt = envelope.savedAt;
    return { state, mode: 'restored', lastRaw: raw, savedAt: envelope.savedAt };
  } catch (error) {
    // Keep the unreadable raw data untouched. The UI offers raw export, restore, or explicit fresh start.
    return { state: blank, mode: 'recovery-required', lastRaw: raw, error: error.message || 'StorageDataError' };
  }
}

// Saving is isolated too: failed browser storage never mutates the workspace.
export function saveWorkspace(storage, state, time = Date.now()) {
  try {
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') throw new Error('StorageUnavailable');
    const raw = serialize(state, time);
    storage.setItem(STORE_KEY, raw);
    if (storage.getItem(STORE_KEY) !== raw) throw new Error('写入后读取校验失败');
    return { ok: true, raw, savedAt: time };
  } catch (error) {
    return { ok: false, error: error.name || 'StorageError' };
  }
}
