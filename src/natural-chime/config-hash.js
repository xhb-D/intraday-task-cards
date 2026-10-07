import { validateChime } from './model.js';

export function canonicalChimeJSON(chime) {
  validateChime(chime);
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(chime));
}
export async function nativeConfigHash(chime, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new Error('当前安全环境无法验证配置哈希。');
  const bytes = new TextEncoder().encode(canonicalChimeJSON(chime));
  const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
