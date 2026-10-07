import { nativeConfigHash } from './config-hash.js';

export const NATIVE_PROTOCOL = 2;
export function createNativeHelperBackend({ getCanonical, isDataCurrent, onChange = () => {}, fetch: fetcher = globalThis.fetch, base = 'https://127.0.0.1:17839', hash = nativeConfigHash, timeoutMs = 5000 }) {
  let token = null, tail = Promise.resolve(), pendingRefresh = null, actionCount = 0;
  let snapshot = { mode: 'native', connectionState: 'DISCONNECTED', runtimeState: 'UNKNOWN', configState: 'UNKNOWN', protocolVersion: null, nativeVoices: [], capabilities: {}, message: '', appliedConfigHash: null };
  function changed() { onChange(getStatus()); }
  function getStatus() { return { ...snapshot, nativeVoices: [...snapshot.nativeVoices], busy: actionCount > 0 }; }
  function compatible(data) {
    const c = data?.capabilities;
    return data?.ok === true && data.protocolVersion === NATIVE_PROTOCOL && c?.scheduler === 'natural-five-slot-v1' && c.sound === true && c.speech === true && c.appliedSnapshot === true && typeof c.notification === 'boolean';
  }
  function issue(code, message) { return Object.assign(new Error(message), { code }); }
  async function request(route, body) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const options = { signal: controller.signal, credentials: 'omit', cache: 'no-store' };
      if (body !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chime-Token': token || '' }, body: JSON.stringify(body) });
      let response;
      try { response = await fetcher(base + route, options); } catch (cause) { throw issue('DISCONNECTED', `后台助手连接中断；当前后台运行状态未知。${cause.name || ''}`); }
      let data;
      try { data = await response.json(); } catch { throw issue('ERROR', '后台助手返回无效响应。'); }
      if (!response.ok || data?.ok !== true) throw issue(data?.error === 'VERSION_MISMATCH' ? 'VERSION_MISMATCH' : 'ERROR', data?.message || data?.error || `HTTP ${response.status}`);
      if (!compatible(data)) { snapshot.protocolVersion = data?.protocolVersion ?? null; throw issue('VERSION_MISMATCH', '后台助手版本或必需能力不兼容。'); }
      return data;
    } finally { clearTimeout(timer); }
  }
  function failed(error) {
    token = null;
    snapshot = { ...snapshot, connectionState: ['DISCONNECTED', 'VERSION_MISMATCH'].includes(error.code) ? error.code : 'ERROR', runtimeState: 'UNKNOWN',
      configState: 'UNKNOWN', message: error.message };
    changed(); return { ok: false, message: error.message };
  }
  function queue(action, run) {
    if (action) { actionCount += 1; changed(); }
    const promise = tail.then(run).catch(failed).finally(() => { if (action) { actionCount -= 1; changed(); } });
    tail = promise.then(() => {}); return promise;
  }
  async function handshake() {
    const health = await request('/health');
    if (typeof health.sessionToken !== 'string' || !health.sessionToken) throw issue('VERSION_MISMATCH', '后台助手缺少控制握手。');
    token = health.sessionToken;
    snapshot = { ...snapshot, protocolVersion: health.protocolVersion, capabilities: health.capabilities };
  }
  async function readStatus() {
    const data = await request('/status');
    if (!['RUNNING', 'PAUSED'].includes(data.runtimeState) || !['NONE', 'VALID', 'CORRUPT'].includes(data.snapshotState) || (data.snapshotState === 'VALID' && !/^[a-f0-9]{64}$/.test(data.appliedConfigHash || ''))) throw issue('ERROR', '后台助手执行/配置状态无效。');
    const canonical = getCanonical();
    const currentHash = canonical?.chime ? await hash(canonical.chime) : null;
    snapshot = { ...snapshot, connectionState: 'CONNECTED', runtimeState: data.runtimeState, configState: data.snapshotState === 'NONE' ? 'NONE' : data.snapshotState === 'CORRUPT' ? 'CORRUPT' : data.appliedConfigHash === currentHash ? 'IN_SYNC' : 'MISMATCH',
      appliedConfigHash: data.appliedConfigHash, appliedRevision: data.appliedRevision, nextEvents: data.nextEvents || [], capabilities: data.capabilities, message: '', helperStatus: data };
    changed(); return data;
  }
  async function syncCanonical() {
    if (!isDataCurrent()) throw issue('ERROR', '统一存档只读、冲突或尚未安全保存；未同步后台助手。');
    await handshake();
    const canonical = getCanonical(), chime = structuredClone(canonical.chime), revision = canonical.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) throw issue('ERROR', '统一存档版本无效。');
    const configHash = await hash(chime);
    const latestHash = await hash(getCanonical().chime);
    if (!isDataCurrent() || getCanonical().revision !== revision || latestHash !== configHash) throw issue('ERROR', '配置在同步前发生变化；未应用过期快照。');
    const ack = await request('/config/apply', { protocolVersion: NATIVE_PROTOCOL, canonicalRevision: revision, configHash, chime });
    if (ack.appliedConfigHash !== configHash || ack.appliedRevision !== revision || ack.snapshotState !== 'VALID') throw issue('ERROR', '后台助手配置确认不一致。');
    return { configHash, revision };
  }
  function refresh() {
    if (pendingRefresh) return pendingRefresh;
    pendingRefresh = queue(false, async () => {
      await handshake(); await readStatus();
      const data = await request('/voices');
      if (!Array.isArray(data.voices) || data.voices.some(v => typeof v.identifier !== 'string' || typeof v.name !== 'string' || !/^zh-/i.test(v.language || ''))) throw issue('ERROR', '后台中文声音列表无效。');
      snapshot.nativeVoices = data.voices; changed(); return { ok: true };
    }).finally(() => { pendingRefresh = null; });
    return pendingRefresh;
  }
  return {
    mode: 'native', getStatus, refresh,
    // Telemetry and reconnect NEVER apply; only explicit actions or canonical-save callbacks do.
    settingsSaved() { return queue(true, async () => { await syncCanonical(); await readStatus(); return { ok: true }; }); },
    start() { return queue(true, async () => {
      const applied = await syncCanonical();
      const latestHash = await hash(getCanonical().chime);
      if (!isDataCurrent() || latestHash !== applied.configHash) throw issue('ERROR', '配置在START前变化；未启动。');
      await request('/start', { protocolVersion: NATIVE_PROTOCOL }); const status = await readStatus();
      if (status.runtimeState !== 'RUNNING' || snapshot.configState !== 'IN_SYNC') throw issue('ERROR', '后台助手尚未确认当前配置RUNNING。');
      return { ok: true };
    }); },
    pause() { return queue(true, async () => { await handshake(); await request('/pause', { protocolVersion: NATIVE_PROTOCOL }); const status = await readStatus(); if (status.runtimeState !== 'PAUSED') throw issue('ERROR', '后台助手未确认PAUSED。'); return { ok: true }; }); },
    preview() { return queue(true, async () => { await syncCanonical(); await request('/preview', { protocolVersion: NATIVE_PROTOCOL }); await readStatus(); return { ok: true }; }); },
    invalidate() { snapshot.message = '统一存档当前只读；后台运行状态以助手为准，不会自动修改或接管。'; changed(); },
    getVoices() { return snapshot.nativeVoices.map(v => ({ voiceURI: v.identifier, name: v.name, lang: v.language })); }
  };
}
