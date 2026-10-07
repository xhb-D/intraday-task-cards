import { CHIME_RUN_KEY, CHIME_LEASE_KEY, CHIME_LOCK_NAME } from './coordinator.js';
import { isNativeChimeDevMode } from './execution-backend.js';

// Machine-local capability preference. Never enters Unified/backup or writes canonical configuration.
export const CHIME_EXECUTION_MODE_KEY = 'trading-control-center:natural-chime:execution-mode:v1';
export function readChimeExecutionPreference(storage, search = '') {
  if (isNativeChimeDevMode(search)) return { mode: 'native', devOverride: true };
  try {
    const raw = storage?.getItem(CHIME_EXECUTION_MODE_KEY);
    if (raw == null) return { mode: 'browser', startRequired: false };
    const p = JSON.parse(raw);
    if (p.version !== 1 || !['browser', 'native'].includes(p.mode) || typeof p.startRequired !== 'boolean' || Object.keys(p).some(k => !['version', 'mode', 'startRequired'].includes(k))) throw Error('invalid preference');
    return p;
  } catch { return { mode: 'native', invalid: true, startRequired: true }; } // Unknown state cannot restore a browser engine.
}

// Verify both frozen browser coordination mechanisms after global PAUSE. Never edit leases on behalf of another tab.
export async function verifyBrowserQuiescent({ backend, storage, locks, now = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)), attempts = 50 }) {
  for (let i = 0; i < attempts; i++) {
    const s = backend.getStatus(), run = JSON.parse(storage.getItem(CHIME_RUN_KEY) || 'null'), raw = storage.getItem(CHIME_LEASE_KEY);
    if (s.leader || s.runIntent !== 'paused' || s.coordinationError || run?.intent !== 'paused' || run.version !== 1) return false;
    let leaseClear = raw === null;
    if (raw !== null) {
      const lease = JSON.parse(raw);
      leaseClear = lease.version === 1 && Number.isFinite(lease.expiresAt) && Number.isFinite(lease.heartbeatAt) && now() >= lease.heartbeatAt && lease.expiresAt <= now();
    }
    let lockClear = true;
    if (locks?.request) {
      lockClear = false;
      await locks.request(CHIME_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, lock => { lockClear = Boolean(lock); });
    } else if (s.supported && s.mode === 'web-lock') return false;
    if (leaseClear && lockClear) return true;
    await wait(200);
  }
  return false;
}

export function createChimeModeSwitch({ backend, createNative, storage, verifyBrowser, reload, onChange = () => {} }) {
  let busy = false, message = '';
  const status = () => ({ busy, message });
  async function switchMode(next) {
    if (busy || !['browser', 'native'].includes(next) || next === backend.mode) return { ok: false };
    busy = true; message = ''; onChange(status());
    try {
      if (backend.mode === 'browser') {
        const result = await backend.pause();
        if (!result?.ok || !(await verifyBrowser())) throw Error('尚未确认浏览器报时权已释放；未启用后台助手。');
        backend.stopForSwitch?.();
        const native = createNative();
        // An already-running helper must also be stopped before explicit mode setup changes its snapshot.
        if (!(await native.pause()).ok || native.getStatus().runtimeState !== 'PAUSED') throw Error('无法连接并确认后台助手已暂停；浏览器保持暂停。');
        if (!(await native.settingsSaved()).ok || native.getStatus().configState !== 'IN_SYNC') throw Error('当前配置未被后台助手确认；浏览器保持暂停。');
      } else {
        if (!(await backend.pause()).ok || backend.getStatus().runtimeState !== 'PAUSED') throw Error('无法确认后台助手已暂停；禁止切回浏览器以避免重复报时。');
      }
      const raw = JSON.stringify({ version: 1, mode: next, startRequired: true });
      storage.setItem(CHIME_EXECUTION_MODE_KEY, raw);
      if (storage.getItem(CHIME_EXECUTION_MODE_KEY) !== raw) throw Error('无法保存本机模式；当前引擎保持暂停。');
      message = '模式已保存，重载后请明确点击开始报时。'; reload(); return { ok: true };
    } catch (error) { message = error.message; return { ok: false, message }; }
    finally { busy = false; onChange(status()); }
  }
  return { switchMode, getStatus: status };
}
