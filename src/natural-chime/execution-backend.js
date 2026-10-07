// Selection is performed once, before creating any audible browser engine. No automatic fallback.
export function createChimeExecutionBackend({ nativeMode, createBrowser, createNative }) {
  return nativeMode ? createNative() : createBrowser();
}
export function isNativeChimeDevMode(search = '') { return Boolean(search) && new URLSearchParams(search).get('nativeChime') === '1'; }
