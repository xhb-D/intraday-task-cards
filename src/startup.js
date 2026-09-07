import { copy, createWorkspace } from './model.js';
import { diagnosticFromError } from './diagnostics.js';
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
    const diagnostic = diagnosticFromError(error, { phase: 'storage_read' });
    return { state: blank, mode: 'storage-unavailable', lastRaw: null, error: diagnostic.errorCode, diagnostic };
  }
  if (raw === null) return { state: blank, mode: 'blank', lastRaw: null };
  try {
    const envelope = deserialize(raw);
    const state = copy(envelope.state);
    state.lastSavedAt = envelope.savedAt;
    return { state, mode: 'restored', lastRaw: raw, savedAt: envelope.savedAt };
  } catch (error) {
    // Keep the unreadable raw data untouched. The UI offers raw export, restore, or explicit fresh start.
    const diagnostic = diagnosticFromError(error, { phase: 'startup_restore' });
    return { state: blank, mode: 'recovery-required', lastRaw: raw, error: diagnostic.errorCode, diagnostic };
  }
}

// Saving is isolated too: failed browser storage never mutates the workspace.
export function saveWorkspace(storage, state, time = Date.now(), { allowWrite = true } = {}) {
  if (!allowWrite) {
    const diagnostic = diagnosticFromError(Object.assign(new Error('外部页面已写入较新存档'), { code: 'EXTERNAL_WRITE_CONFLICT' }), { phase: 'external_write' });
    return { ok: false, error: 'Conflict', diagnostic };
  }
  if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') {
    const diagnostic = diagnosticFromError(new Error('StorageUnavailable'), { phase: 'storage_write' });
    return { ok: false, error: diagnostic.errorCode, diagnostic };
  }
  let raw;
  try {
    raw = serialize(state, time);
  } catch (error) {
    const diagnostic = diagnosticFromError(error, { phase: 'serialization' });
    return { ok: false, error: diagnostic.errorCode, diagnostic };
  }
  try {
    storage.setItem(STORE_KEY, raw);
    if (storage.getItem(STORE_KEY) !== raw) throw new Error('写入后读取校验失败');
    return { ok: true, raw, savedAt: time };
  } catch (error) {
    const diagnostic = diagnosticFromError(error, { phase: 'storage_write' });
    return { ok: false, error: diagnostic.errorCode, diagnostic };
  }
}
