export const CHIME_RUN_KEY = 'trading-control-center:natural-chime:run:v1';
export const CHIME_LEASE_KEY = 'trading-control-center:natural-chime:lease:v1';
export const CHIME_CHANNEL = 'trading-control-center:natural-chime:v1';
export const CHIME_LOCK_NAME = 'trading-control-center:natural-chime-audible-leader';
const HEARTBEAT_MS = 2000;
const LEASE_TTL_MS = 8000;
const CLAIM_SETTLE_MS = 300;
const VERIFY_SETTLE_MS = 300;

function randomId(environment) {
  try { return environment.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
}
function parseRun(raw) {
  if (raw === null) return { version: 1, intent: 'paused', generation: 0, updatedAt: 0 };
  const item = JSON.parse(raw);
  if (!item || Object.keys(item).length !== 4 || Object.keys(item).some(key => !['version', 'intent', 'generation', 'updatedAt'].includes(key)) || item.version !== 1 || !['running', 'paused'].includes(item.intent) || !Number.isSafeInteger(item.generation) || item.generation < 0 || !Number.isFinite(item.updatedAt)) throw new Error('invalid run record');
  return item;
}
function parseLease(raw) {
  if (raw === null) return null;
  const item = JSON.parse(raw);
  const expected = ['version', 'ownerTabId', 'leaseToken', 'runGeneration', 'heartbeatAt', 'expiresAt'];
  if (!item || Object.keys(item).length !== expected.length || Object.keys(item).some(key => !expected.includes(key)) || item.version !== 1 || typeof item.ownerTabId !== 'string' || !item.ownerTabId || typeof item.leaseToken !== 'string' || !item.leaseToken || !Number.isSafeInteger(item.runGeneration) || item.runGeneration < 0 || !Number.isFinite(item.heartbeatAt) || !Number.isFinite(item.expiresAt) || item.expiresAt <= item.heartbeatAt) throw new Error('invalid lease');
  return item;
}

export function createCoordinator({ environment = globalThis, isDataCurrent = () => true, isAudioUnlocked = () => true, onChange = () => {}, timings = {} } = {}) {
  const now = timings.now || (() => Date.now());
  const setTimer = timings.setTimeout || environment.setTimeout?.bind(environment) || setTimeout;
  const clearTimer = timings.clearTimeout || environment.clearTimeout?.bind(environment) || clearTimeout;
  const setIntervalFn = timings.setInterval || environment.setInterval?.bind(environment) || setInterval;
  const clearIntervalFn = timings.clearInterval || environment.clearInterval?.bind(environment) || clearInterval;
  const storage = (() => { try { return environment.localStorage; } catch { return null; } })();
  const tabId = randomId(environment);
  let intent = { version: 1, intent: 'paused', generation: 0, updatedAt: 0 };
  let leader = false; let leaderId = null; let leaderToken = null; let leaderMode = null;
  let visible = environment.document?.visibilityState !== 'hidden'; let audioUnlocked = false; let invalidated = false;
  let channel = null; let coordinationError = ''; let locksUsable = Boolean(environment.navigator?.locks?.request);
  let lockRequesting = false; let releaseLock = null; let retryTimer = null; let heartbeatTimer = null; let electionTimer = null; let verificationTimer = null;
  const claims = new Map();
  const listeners = new Set();

  function status() {
    let contextUnlocked = false;
    try { contextUnlocked = isAudioUnlocked() === true; } catch { contextUnlocked = false; }
    return { runIntent: intent.intent, generation: intent.generation, leader, leaderId, selfId: tabId, visible, audioUnlocked: audioUnlocked && contextUnlocked, invalidated, coordinationError, mode: leaderMode, supported: Boolean(locksUsable || (storage && channel)) };
  }
  function emit() { onChange(status()); listeners.forEach(listener => listener(status())); }
  function eligible(preview = false) { return !invalidated && visible && audioUnlocked && status().audioUnlocked && isDataCurrent() && (preview || intent.intent === 'running'); }
  function channelPost(message) { try { channel?.postMessage({ ...message, tabId, generation: intent.generation, sentAt: now() }); } catch { coordinationError = '同源消息通道不可用。'; } }
  function readRun() { if (!storage) throw new Error('localStorage unavailable'); return parseRun(storage.getItem(CHIME_RUN_KEY)); }
  function writeRun(next) {
    if (!storage) throw new Error('localStorage unavailable');
    const raw = JSON.stringify(next); storage.setItem(CHIME_RUN_KEY, raw);
    if (storage.getItem(CHIME_RUN_KEY) !== raw) throw new Error('run record verification failed');
    intent = next; channelPost({ type: 'intent', record: next }); emit(); return true;
  }
  function syncRun() {
    try { intent = readRun(); coordinationError = ''; }
    catch { intent = { version: 1, intent: 'paused', generation: 0, updatedAt: now() }; coordinationError = '无法验证同源报时运行状态；已停止声音。'; release('runtime-read-failed'); }
    emit();
  }
  function setLeader(value, mode = null, id = value ? tabId : null, token = null) {
    const changed = leader !== value || leaderMode !== (value ? mode : null) || leaderId !== id;
    leader = value; leaderMode = value ? mode : null; leaderId = value ? id : null; leaderToken = value ? token : null;
    if (changed) emit();
  }
  function clearLeaseIfOwned() {
    if (!['lease', 'lease-preview'].includes(leaderMode) || !storage || !leaderToken) return;
    try {
      const current = parseLease(storage.getItem(CHIME_LEASE_KEY));
      if (current?.ownerTabId === tabId && current.leaseToken === leaderToken) storage.removeItem(CHIME_LEASE_KEY);
    } catch { /* lease expiry is the safe fallback */ }
  }
  function clearTimers() {
    if (retryTimer) clearTimer(retryTimer); retryTimer = null;
    if (heartbeatTimer) clearIntervalFn(heartbeatTimer); heartbeatTimer = null;
    if (electionTimer) clearTimer(electionTimer); electionTimer = null;
    if (verificationTimer) clearTimer(verificationTimer); verificationTimer = null;
  }
  function release(reason = 'released') {
    clearTimers();
    if (leaderMode === 'lease' || leaderMode === 'lease-preview') clearLeaseIfOwned();
    if (releaseLock) { const resolve = releaseLock; releaseLock = null; resolve(); }
    if (leader) channelPost({ type: 'release', reason, leaderToken });
    setLeader(false);
  }
  function retryElection(delay = 250) {
    if (retryTimer) return;
    retryTimer = setTimer(() => { retryTimer = null; compete(); }, delay);
  }
  function webLockCompetend() {
    if (!locksUsable || lockRequesting || leader || !eligible()) return;
    lockRequesting = true;
    Promise.resolve(environment.navigator.locks.request(CHIME_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock || !eligible()) { leaderId = lock ? null : 'other'; emit(); return undefined; }
      setLeader(true, 'web-lock', tabId, `web-lock:${tabId}`);
      return new Promise(resolve => { releaseLock = resolve; });
    })).catch(() => {
      locksUsable = false; coordinationError = 'Web Locks 不可用，正在尝试本地租约协调。'; emit(); fallbackCompete();
    }).finally(() => { lockRequesting = false; if (!leader && eligible()) retryElection(HEARTBEAT_MS); });
  }
  function validCurrentLease() {
    try {
      const lease = parseLease(storage?.getItem(CHIME_LEASE_KEY) ?? null);
      if (lease && now() < lease.heartbeatAt) { coordinationError = '系统时钟发生变化，租约状态不明确；已停止声音。'; return undefined; }
      return lease && lease.expiresAt > now() ? lease : null;
    } catch { coordinationError = '无法验证同源租约；已停止声音。'; return undefined; }
  }
  function becomeLeaseLeader(lease) {
    leaderToken = lease.leaseToken; setLeader(true, 'lease', tabId, lease.leaseToken);
    channelPost({ type: 'lease', lease });
    heartbeatTimer = setIntervalFn(() => renewLease(), HEARTBEAT_MS);
  }
  function renewLease() {
    if (!leader || leaderMode !== 'lease' || !eligible()) { release('eligibility-lost'); return; }
    try {
      const current = parseLease(storage.getItem(CHIME_LEASE_KEY));
      if (!current || current.expiresAt <= now() || now() < current.heartbeatAt || current.ownerTabId !== tabId || current.leaseToken !== leaderToken || current.runGeneration !== intent.generation) { coordinationError = '同源租约发生变化或过期；本页已停止声音。'; release('lease-lost'); emit(); return; }
      const next = { ...current, heartbeatAt: now(), expiresAt: now() + LEASE_TTL_MS };
      const raw = JSON.stringify(next); storage.setItem(CHIME_LEASE_KEY, raw);
      if (storage.getItem(CHIME_LEASE_KEY) !== raw) throw new Error('lease verification failed');
      channelPost({ type: 'lease', lease: next });
    } catch { coordinationError = '无法续租；本页已停止声音。'; release('lease-renew-failed'); emit(); }
  }
  function fallbackCompete() {
    if (leader || electionTimer || !eligible()) return;
    if (!storage || !channel) { coordinationError = '缺少可验证的同源协调能力；报时输出已停用。'; emit(); return; }
    let existing = validCurrentLease();
    if (existing === undefined) { emit(); return; }
    if (existing && existing.ownerTabId !== tabId) { leaderId = existing.ownerTabId; emit(); retryElection(Math.max(250, existing.expiresAt - now() + 5)); return; }
    claims.clear(); claims.set(tabId, now()); channelPost({ type: 'claim' });
    electionTimer = setTimer(() => {
      electionTimer = null;
      if (!eligible()) return;
      existing = validCurrentLease();
      if (existing && existing.ownerTabId !== tabId) { leaderId = existing.ownerTabId; emit(); retryElection(Math.max(250, existing.expiresAt - now() + 5)); return; }
      const contenders = [...claims.entries()].filter(([, at]) => now() - at <= CLAIM_SETTLE_MS + 100).map(([id]) => id).sort();
      if (contenders[0] !== tabId) { leaderId = contenders[0] || null; emit(); retryElection(HEARTBEAT_MS); return; }
      const lease = { version: 1, ownerTabId: tabId, leaseToken: randomId(environment), runGeneration: intent.generation, heartbeatAt: now(), expiresAt: now() + LEASE_TTL_MS };
      try {
        storage.setItem(CHIME_LEASE_KEY, JSON.stringify(lease));
        const readBack = parseLease(storage.getItem(CHIME_LEASE_KEY));
        if (!readBack || readBack.ownerTabId !== tabId || readBack.leaseToken !== lease.leaseToken || readBack.runGeneration !== intent.generation) throw new Error('lease was overwritten');
        channelPost({ type: 'claim', provisional: true, lease });
        verificationTimer = setTimer(() => {
          verificationTimer = null;
          const verified = validCurrentLease();
          if (eligible() && verified?.ownerTabId === tabId && verified.leaseToken === lease.leaseToken && verified.runGeneration === intent.generation) becomeLeaseLeader(verified);
          else retryElection(HEARTBEAT_MS);
        }, VERIFY_SETTLE_MS);
      } catch { coordinationError = '同源租约无法确认；没有页面获得报时权。'; emit(); retryElection(HEARTBEAT_MS); }
    }, CLAIM_SETTLE_MS);
  }
  function compete() { syncRun(); if (!eligible()) { release('not-eligible'); return; } if (locksUsable) webLockCompetend(); else fallbackCompete(); }

  function onMessage(event) {
    const message = event?.data;
    if (!message || message.tabId === tabId) return;
    if (message.type === 'claim') { claims.set(message.tabId, Number(message.sentAt) || now()); if (!electionTimer && eligible() && !leader) retryElection(150); }
    if (message.type === 'intent' && message.record) {
      try { intent = parseRun(JSON.stringify(message.record)); if (intent.intent === 'paused') release('global-pause'); else compete(); }
      catch { coordinationError = '同源运行状态消息无效；已停止声音。'; release('invalid-runtime-message'); }
      emit();
    }
    if (message.type === 'release') {
      if (leaderId === message.tabId) leaderId = null;
      if (!leader && eligible()) retryElection(150);
      emit();
    }
    if (message.type === 'lease') {
      try {
        const lease = parseLease(JSON.stringify(message.lease));
        if (lease.runGeneration === intent.generation && lease.expiresAt > now() && lease.ownerTabId !== tabId) leaderId = lease.ownerTabId;
      } catch { /* invalid broadcasts never grant leadership */ }
      if (!leader && eligible()) retryElection(150);
      emit();
    }
  }
  function onStorage(event) {
    if (event?.key === CHIME_RUN_KEY) { syncRun(); if (intent.intent === 'running') compete(); else release('global-pause'); }
    if (event?.key === CHIME_LEASE_KEY) {
      const lease = validCurrentLease();
      if (lease && lease.ownerTabId !== tabId) leaderId = lease.ownerTabId;
      else if (!lease || lease.ownerTabId === tabId) leaderId = null;
      if (!leader && eligible()) retryElection(150);
      emit();
    }
  }
  function onVisibility() {
    visible = environment.document?.visibilityState !== 'hidden';
    if (!visible) release('hidden'); else { syncRun(); if (intent.intent === 'running') compete(); }
    emit();
  }
  function onPageHide() { visible = false; release('pagehide'); emit(); }
  try { if (environment.BroadcastChannel) { channel = new environment.BroadcastChannel(CHIME_CHANNEL); channel.addEventListener?.('message', onMessage); if (!channel.addEventListener) channel.onmessage = onMessage; } } catch { channel = null; }
  try { intent = readRun(); } catch { coordinationError = '无法读取同源报时状态；报时输出已停用。'; }
  environment.document?.addEventListener?.('visibilitychange', onVisibility);
  environment.addEventListener?.('pagehide', onPageHide);
  environment.addEventListener?.('pageshow', onVisibility);
  environment.addEventListener?.('focus', onVisibility);
  environment.addEventListener?.('storage', onStorage);

  return {
    getStatus: status,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async start() {
      if (!visible || !isDataCurrent()) return { ok: false, message: '请在当前可见且存档有效的页面启动报时。' };
      if (!audioUnlocked || !status().audioUnlocked) return { ok: false, message: '音频尚未由本页面的用户操作解锁；未启动报时。' };
      let previous;
      try { previous = readRun(); const next = { version: 1, intent: 'running', generation: previous.generation + 1, updatedAt: now() }; writeRun(next); coordinationError = ''; compete(); return { ok: true }; }
      catch { intent = previous || intent; coordinationError = '无法写入并验证同源报时状态；未启动。'; emit(); return { ok: false, message: coordinationError }; }
    },
    pause() {
      try { const previous = readRun(); writeRun({ version: 1, intent: 'paused', generation: previous.generation + 1, updatedAt: now() }); release('global-pause'); coordinationError = ''; emit(); return { ok: true }; }
      catch { coordinationError = '无法安全暂停同源运行状态；本页已停止并显示错误。'; release('pause-write-failed'); emit(); return { ok: false, message: coordinationError }; }
    },
    setAudioUnlocked(value) { audioUnlocked = value === true; if (!audioUnlocked) release('audio-locked'); else if (intent.intent === 'running') compete(); emit(); },
    invalidate(reason = 'external-conflict') { invalidated = true; coordinationError = reason; release('invalidated'); emit(); },
    settingsChanged() { if (intent.intent === 'running' && eligible()) compete(); emit(); },
    async runPreview(action) {
      if (!visible || !audioUnlocked || invalidated || !isDataCurrent()) return { ok: false, message: '当前页面不具备试听条件。' };
      try { intent = readRun(); } catch { coordinationError = '无法确认同源报时状态；未试听。'; emit(); return { ok: false, message: coordinationError }; }
      if (leader && await canOutput()) return action();
      if (locksUsable) {
        try {
          let result = { ok: false, message: '另一个页面正在负责报时；本页没有试听权限。' };
          await environment.navigator.locks.request(CHIME_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) return;
            setLeader(true, 'web-lock-preview', tabId, `preview:${tabId}`);
            try { result = await action(); } finally { setLeader(false); }
          });
          return result;
        } catch { locksUsable = false; }
      }
      if (!storage || !channel) return { ok: false, message: '无法验证同源试听权；未播放。' };
      const lease = validCurrentLease();
      if (lease === undefined) return { ok: false, message: coordinationError || '无法验证同源试听权；未播放。' };
      if (lease && lease.expiresAt > now()) return { ok: false, message: '另一个页面正在负责报时；本页没有试听权限。' };
      const previewLease = { version: 1, ownerTabId: tabId, leaseToken: randomId(environment), runGeneration: intent.generation, heartbeatAt: now(), expiresAt: now() + LEASE_TTL_MS };
      try {
        storage.setItem(CHIME_LEASE_KEY, JSON.stringify(previewLease));
        const verify = parseLease(storage.getItem(CHIME_LEASE_KEY));
        if (verify?.leaseToken !== previewLease.leaseToken) throw new Error('preview lease mismatch');
        await new Promise(resolve => setTimer(resolve, VERIFY_SETTLE_MS));
        const again = validCurrentLease();
        if (again?.leaseToken !== previewLease.leaseToken) throw new Error('preview lease lost');
        setLeader(true, 'lease-preview', tabId, previewLease.leaseToken);
        return await action();
      } catch { return { ok: false, message: '无法验证同源试听权；未播放。' }; }
      finally { release('preview-complete'); }
    },
    async canOutput() {
      const preview = ['web-lock-preview', 'lease-preview'].includes(leaderMode);
      if (!leader || !eligible(preview) || (!preview && intent.intent !== 'running')) return false;
      try {
        const latest = readRun();
        if (latest.generation !== intent.generation || latest.intent !== intent.intent) { intent = latest; release('run-intent-changed'); emit(); return false; }
      } catch { coordinationError = '无法确认同源报时状态；已停止声音。'; release('runtime-read-failed'); emit(); return false; }
      if (leaderMode === 'lease' || leaderMode === 'lease-preview') {
        const lease = validCurrentLease();
        const verified = Boolean(lease && lease.ownerTabId === tabId && lease.leaseToken === leaderToken && lease.runGeneration === intent.generation && lease.expiresAt > now());
        if (!verified) { coordinationError ||= '无法验证当前同源租约；已停止声音。'; release('lease-unverified'); emit(); }
        return verified;
      }
      if (leaderMode === 'web-lock-preview') return visible && audioUnlocked && !invalidated && isDataCurrent();
      return leaderMode === 'web-lock' && visible && audioUnlocked && !invalidated && isDataCurrent();
    },
    destroy() { release('destroy'); clearTimers(); environment.document?.removeEventListener?.('visibilitychange', onVisibility); environment.removeEventListener?.('pagehide', onPageHide); environment.removeEventListener?.('pageshow', onVisibility); environment.removeEventListener?.('focus', onVisibility); environment.removeEventListener?.('storage', onStorage); try { channel?.close(); } catch {} }
  };
}
