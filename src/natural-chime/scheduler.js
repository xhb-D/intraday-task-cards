import { earlyTarget, mergeDueEvents, nextBoundary, clockLabel } from './time.js';
import { periodMinutes } from './model.js';

export function createScheduler({ coordinator, output, getChime, onStatus = () => {}, environment = globalThis, timings = {} }) {
  const now = timings.now || (() => Date.now());
  const setTimer = timings.setTimeout || environment.setTimeout?.bind(environment) || setTimeout;
  const clearTimer = timings.clearTimeout || environment.clearTimeout?.bind(environment) || clearTimeout;
  const setIntervalFn = timings.setInterval || environment.setInterval?.bind(environment) || setInterval;
  const clearIntervalFn = timings.clearInterval || environment.clearInterval?.bind(environment) || clearInterval;
  const slots = new Map(); const timers = new Map();
  let watchdog = null; let destroyed = false; let statusMessage = '';

  function eligible(slotId) {
    const slot = getChime()?.slots?.find(item => item.slotId === slotId);
    return Boolean(slot?.enabled && !slot.paused);
  }
  function clearTimers() { for (const id of timers.values()) clearTimer(id); timers.clear(); }
  function clearSlot(slotId) { slots.delete(slotId); recompute(); }
  function slotEvents() {
    const values = [];
    for (const [slotId, scheduled] of slots) {
      if (!eligible(slotId)) continue;
      values.push({ kind: 'main', targetAt: scheduled.boundaryAt, boundaryAt: scheduled.boundaryAt, slotId });
      if (scheduled.earlyAt !== null && scheduled.earlyAt > now()) values.push({ kind: 'early', targetAt: scheduled.earlyAt, boundaryAt: scheduled.boundaryAt, earlySeconds: scheduled.earlySeconds, slotId });
    }
    return values;
  }
  function rescheduleSlot(slot) {
    const current = now(); const boundaryAt = nextBoundary(periodMinutes(slot), current);
    const earlyAt = earlyTarget(boundaryAt, slot.earlySeconds, current);
    slots.set(slot.slotId, { boundaryAt, earlyAt, earlySeconds: slot.earlySeconds, periodMinutes: periodMinutes(slot) });
  }
  function scheduleAll({ reset = false } = {}) {
    const chime = getChime();
    const allowed = new Set((chime?.slots || []).filter(slot => slot.enabled && !slot.paused).map(slot => slot.slotId));
    for (const slotId of [...slots.keys()]) if (!allowed.has(slotId)) slots.delete(slotId);
    for (const slot of chime?.slots || []) {
      if (!allowed.has(slot.slotId)) continue;
      const prior = slots.get(slot.slotId);
      const sameSettings = prior && prior.periodMinutes === periodMinutes(slot) && prior.earlySeconds === slot.earlySeconds;
      if (reset || !sameSettings || !prior || prior.boundaryAt <= now()) rescheduleSlot(slot);
    }
    recompute();
  }
  function recompute() {
    clearTimers();
    if (destroyed || !coordinator.getStatus().leader || !coordinator.getStatus().runIntent || !coordinator.getStatus().audioUnlocked || !coordinator.getStatus().visible) return;
    const events = mergeDueEvents(slotEvents());
    for (const event of events) {
      const key = `${event.kind}:${event.targetSecond}`;
      const id = setTimer(() => fire(key, event), Math.max(0, event.targetAt - now()));
      timers.set(key, id);
    }
    if (!watchdog) watchdog = setIntervalFn(() => {
      if (!coordinator.getStatus().leader) { clearIntervalFn(watchdog); watchdog = null; return; }
      const current = now();
      for (const [slotId, scheduled] of slots) if (scheduled.boundaryAt <= current) {
        const slot = getChime()?.slots?.find(item => item.slotId === slotId);
        if (slot?.enabled && !slot.paused) rescheduleSlot(slot);
      }
      recompute();
    }, 10_000);
  }
  async function fire(key, scheduledEvent) {
    timers.delete(key);
    const status = coordinator.getStatus();
    if (!status.leader || !status.runIntent || !status.visible || !status.audioUnlocked || !(await coordinator.canOutput())) { scheduleAll(); return; }
    const late = now() - scheduledEvent.targetAt;
    if (scheduledEvent.kind === 'main' && late > 1500) { for (const slotId of scheduledEvent.slotIds) { const slot = getChime()?.slots?.find(item => item.slotId === slotId); if (slot) rescheduleSlot(slot); } scheduleAll(); return; }
    if (scheduledEvent.kind === 'early' && now() >= scheduledEvent.boundaryAt) { scheduleAll(); return; }
    const validSlotIds = scheduledEvent.slotIds.filter(slotId => {
      const slot = getChime()?.slots?.find(item => item.slotId === slotId);
      const scheduled = slots.get(slotId);
      const targetAt = scheduledEvent.kind === 'main' ? scheduled?.boundaryAt : scheduled?.earlyAt;
      return slot?.enabled && !slot.paused && targetAt !== null && targetAt !== undefined && Math.floor(targetAt / 1000) === scheduledEvent.targetSecond;
    });
    const canStillOutput = async () => {
      const latest = getChime();
      const stillEligible = scheduledEvent.slotIds.some(slotId => {
        const slot = latest?.slots?.find(item => item.slotId === slotId);
        const scheduled = slots.get(slotId);
        const targetAt = scheduledEvent.kind === 'main' ? scheduled?.boundaryAt : scheduled?.earlyAt;
        return slot?.enabled && !slot.paused && targetAt !== null && targetAt !== undefined && Math.floor(targetAt / 1000) === scheduledEvent.targetSecond;
      });
      return stillEligible && coordinator.canOutput();
    };
    if (!validSlotIds.length || !(await canStillOutput())) { scheduleAll(); return; }
    const chime = getChime();
    const result = await output.announce(scheduledEvent.kind, scheduledEvent.boundaryAt, scheduledEvent.earlySeconds || 0, chime, clockLabel, canStillOutput);
    const issues = [result.sound.reason, result.speech.message, result.notification.message].filter(Boolean);
    statusMessage = issues.join(' '); onStatus(statusMessage, result);
    const latestChime = getChime();
    if (scheduledEvent.kind === 'main') for (const slotId of validSlotIds) {
      const slot = latestChime.slots.find(item => item.slotId === slotId);
      if (slot) rescheduleSlot(slot);
    }
    scheduleAll();
  }
  const unsubscribe = coordinator.subscribe(status => {
    if (!status.leader || !status.runIntent || !status.visible || !status.audioUnlocked || status.invalidated) {
      clearTimers(); slots.clear();
      if (watchdog) { clearIntervalFn(watchdog); watchdog = null; }
    } else scheduleAll();
  });

  return {
    update(changedSlotId = null) {
      if (!coordinator.getStatus().leader) return;
      if (changedSlotId) {
        const slot = getChime()?.slots?.find(item => item.slotId === changedSlotId);
        if (slot?.enabled && !slot.paused) rescheduleSlot(slot); else slots.delete(changedSlotId);
        scheduleAll();
      } else scheduleAll();
    },
    stop() { clearTimers(); slots.clear(); if (watchdog) clearIntervalFn(watchdog); watchdog = null; },
    getStatus() { return { message: statusMessage, scheduledSlots: slots.size }; },
    destroy() { destroyed = true; this.stop(); unsubscribe(); }
  };
}
