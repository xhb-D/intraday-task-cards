import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoordinator, CHIME_RUN_KEY } from '../src/natural-chime/coordinator.js';
import { createScheduler } from '../src/natural-chime/scheduler.js';
import { defaultChime } from '../src/natural-chime/model.js';

function makeStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
}

function makeClock(startAt = 0) {
  let now = startAt; let nextId = 1;
  const timeouts = new Map(); const intervals = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay = 0) { const id = nextId++; timeouts.set(id, { fn, at: now + Math.max(0, delay) }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn, delay = 0) { const id = nextId++; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    async advanceTo(target) {
      now = target; let guard = 0;
      while (guard++ < 100) {
        const due = [...timeouts.entries()].filter(([, item]) => item.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, item] = due; timeouts.delete(id); await item.fn();
      }
      assert.ok(guard < 100, 'timer loop must settle');
    },
    nextTimeouts() { return [...timeouts.values()].map(item => item.at).sort((a, b) => a - b); },
    timeoutCount() { return timeouts.size; },
    intervalCount() { return intervals.size; }
  };
}

function makeLockManager() {
  let held = false;
  return { request(_name, _options, callback) {
    if (held) return Promise.resolve(callback(null));
    held = true;
    let result;
    try { result = callback({ name: 'lock' }); }
    catch (error) { held = false; return Promise.reject(error); }
    return Promise.resolve(result).finally(() => { held = false; });
  } };
}

function makeChannelBus() {
  const channels = new Set();
  return class TestBroadcastChannel {
    constructor(name) { this.name = name; this.listeners = new Set(); channels.add(this); }
    addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
    removeEventListener(_type, listener) { this.listeners.delete(listener); }
    postMessage(data) { for (const channel of channels) if (channel !== this && channel.name === this.name) queueMicrotask(() => channel.listeners.forEach(listener => listener({ data }))); }
    close() { channels.delete(this); }
  };
}

function makeEnvironment({ storage = makeStorage(), locks = makeLockManager(), BroadcastChannel = makeChannelBus(), clock = makeClock(), id = 'tab' } = {}) {
  const documentListeners = new Map(); const windowListeners = new Map();
  const document = { visibilityState: 'visible', addEventListener(type, listener) { documentListeners.set(type, listener); }, removeEventListener(type) { documentListeners.delete(type); }, fire(type) { documentListeners.get(type)?.(); } };
  return {
    localStorage: storage, navigator: { locks }, document, BroadcastChannel, crypto: { randomUUID: () => id },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    addEventListener(type, listener) { windowListeners.set(type, listener); }, removeEventListener(type) { windowListeners.delete(type); },
    fire(type) { windowListeners.get(type)?.(); }, clock
  };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };

test('Coordinator requires unlocked audio before changing shared run intent', async () => {
  const storage = makeStorage(); const environment = makeEnvironment({ storage });
  const coordinator = createCoordinator({ environment, isAudioUnlocked: () => true, isDataCurrent: () => true });
  const rejected = await coordinator.start();
  assert.equal(rejected.ok, false); assert.equal(storage.getItem(CHIME_RUN_KEY), null);
  coordinator.setAudioUnlocked(true);
  const started = await coordinator.start();
  assert.equal(started.ok, true); assert.equal(JSON.parse(storage.getItem(CHIME_RUN_KEY)).intent, 'running');
  const paused = coordinator.pause();
  assert.equal(paused.ok, true); assert.equal(JSON.parse(storage.getItem(CHIME_RUN_KEY)).intent, 'paused');
  coordinator.destroy();
});

test('Two same-origin tabs never both hold the Web Lock; hidden leader releases without pausing intent', async () => {
  const storage = makeStorage(); const locks = makeLockManager(); const BroadcastChannel = makeChannelBus();
  const envA = makeEnvironment({ storage, locks, BroadcastChannel, id: 'a' });
  const envB = makeEnvironment({ storage, locks, BroadcastChannel, id: 'b' });
  const audio = { unlocked: true };
  const a = createCoordinator({ environment: envA, isAudioUnlocked: () => audio.unlocked });
  const b = createCoordinator({ environment: envB, isAudioUnlocked: () => audio.unlocked });
  a.setAudioUnlocked(true); b.setAudioUnlocked(true);
  assert.equal((await a.start()).ok, true); await flush();
  assert.equal(a.getStatus().leader, true);
  assert.equal((await b.start()).ok, true); await flush();
  assert.equal([a, b].filter(item => item.getStatus().leader).length, 1);
  envA.document.visibilityState = 'hidden'; envA.document.fire('visibilitychange'); await flush();
  assert.equal(a.getStatus().leader, false);
  assert.equal(JSON.parse(storage.getItem(CHIME_RUN_KEY)).intent, 'running');
  assert.equal([a, b].filter(item => item.getStatus().leader).length, 0);
  b.destroy(); a.destroy();
});

test('Fallback lease must be read-back verified and any lease change stops output', async () => {
  const clock = makeClock(1000); const storage = makeStorage();
  const environment = makeEnvironment({ storage, locks: null, clock, id: 'fallback' });
  const coordinator = createCoordinator({ environment, isAudioUnlocked: () => true, timings: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval } });
  coordinator.setAudioUnlocked(true); assert.equal((await coordinator.start()).ok, true);
  await clock.advanceTo(1300); await clock.advanceTo(1600);
  assert.equal(coordinator.getStatus().leader, true); assert.equal(await coordinator.canOutput(), true);
  const intent = JSON.parse(storage.getItem(CHIME_RUN_KEY));
  storage.setItem('trading-control-center:natural-chime:lease:v1', JSON.stringify({ version: 1, ownerTabId: 'other', leaseToken: 'other-token', runGeneration: intent.generation, heartbeatAt: 1600, expiresAt: 9000 }));
  assert.equal(await coordinator.canOutput(), false); assert.equal(coordinator.getStatus().leader, false);
  assert.equal(JSON.parse(storage.getItem('trading-control-center:natural-chime:lease:v1')).leaseToken, 'other-token', 'do not delete a lease no longer owned by this tab');
  coordinator.destroy();
});

function schedulerHarness(startAt) {
  const clock = makeClock(startAt); let chime = defaultChime(); const announced = [];
  let listener;
  const coordinator = {
    getStatus: () => ({ leader: true, runIntent: 'running', audioUnlocked: true, visible: true }),
    canOutput: async () => true,
    subscribe(callback) { listener = callback; return () => { listener = null; }; }
  };
  const output = { async announce(...args) { announced.push(args); return { sound: { ok: true }, speech: { status: 'off' }, notification: { status: 'off' } }; } };
  const scheduler = createScheduler({ coordinator, output, getChime: () => chime, environment: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval }, timings: { now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setInterval: clock.setInterval, clearInterval: clock.clearInterval } });
  listener({ leader: true, runIntent: 'running', audioUnlocked: true, visible: true });
  return { clock, scheduler, announced, setChime(value) { chime = value; }, listener: value => listener?.(value) };
}
const BEIJING_MIDNIGHT = Date.UTC(2025, 0, 1, 0, 0, 0) - 8 * 60 * 60_000;

test('Scheduler emits an early event at its future boundary and a main event once', async () => {
  const start = BEIJING_MIDNIGHT + 4 * 60_000 + 29_000; const h = schedulerHarness(start);
  assert.ok(h.clock.nextTimeouts().includes(start + 1000));
  await h.clock.advanceTo(start + 1000);
  assert.equal(h.announced.length, 1); assert.equal(h.announced[0][0], 'early');
  const mainAt = BEIJING_MIDNIGHT + 5 * 60_000;
  await h.clock.advanceTo(mainAt);
  assert.equal(h.announced.length, 2); assert.equal(h.announced[1][0], 'main');
  h.scheduler.destroy(); assert.equal(h.clock.timeoutCount(), 0); assert.equal(h.clock.intervalCount(), 0);
});

test('Scheduler omits past early reminders, drops late main events, and isolates a changed slot', async () => {
  const start = BEIJING_MIDNIGHT + 4 * 60_000 + 31_000; const h = schedulerHarness(start);
  assert.equal(h.announced.length, 0);
  const boundary = BEIJING_MIDNIGHT + 5 * 60_000;
  await h.clock.advanceTo(boundary + 2000);
  assert.equal(h.announced.length, 0, 'a late main event is never replayed');
  h.scheduler.destroy();

  const at = BEIJING_MIDNIGHT + (12 * 60 + 1) * 60_000; const isolated = schedulerHarness(at);
  const next = defaultChime(); next.slots[1] = { ...next.slots[1], enabled: true, preset: '3', minutes: 3 };
  isolated.setChime(next); isolated.scheduler.update('slot-2');
  const due = isolated.clock.nextTimeouts();
  assert.ok(due.includes(BEIJING_MIDNIGHT + (12 * 60 + 5) * 60_000), 'unchanged five-minute slot retains its original next boundary');
  assert.ok(due.includes(BEIJING_MIDNIGHT + (12 * 60 + 3) * 60_000), 'changed three-minute slot uses its own next future boundary');
  isolated.listener({ leader: false, runIntent: 'running', audioUnlocked: true, visible: true });
  assert.equal(isolated.clock.timeoutCount(), 0, 'leader loss cancels all pending events');
  isolated.scheduler.destroy();
});
