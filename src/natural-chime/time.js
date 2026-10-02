export const CHIME_TIMEZONE = 'Asia/Shanghai';
const MINUTE = 60_000;
const formatterCache = new Map();

function formatter(timeZone) {
  if (!formatterCache.has(timeZone)) formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }));
  return formatterCache.get(timeZone);
}

export function zonedParts(timeMs, timeZone = CHIME_TIMEZONE) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(timeMs)).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function zonedMidnight(parts, timeZone) {
  const targetWall = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let guess = targetWall;
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(guess, timeZone);
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = targetWall - actualWall;
    if (correction === 0) return guess;
    guess += correction;
  }
  return guess;
}

function nextCalendarDay(parts) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

export function nextBoundary(periodMinutes, nowMs = Date.now(), timeZone = CHIME_TIMEZONE) {
  if (!Number.isInteger(periodMinutes) || periodMinutes < 1 || periodMinutes > 1440) throw new RangeError('periodMinutes must be an integer from 1 to 1440');
  if (!Number.isFinite(nowMs)) throw new TypeError('nowMs must be finite');
  const parts = zonedParts(nowMs, timeZone);
  const start = zonedMidnight(parts, timeZone);
  const period = periodMinutes * MINUTE;
  if (periodMinutes === 1440) return zonedMidnight(nextCalendarDay(parts), timeZone);
  const elapsed = nowMs - start;
  const candidate = start + (Math.floor(elapsed / period) + 1) * period;
  const nextDay = zonedMidnight(nextCalendarDay(parts), timeZone);
  if (candidate < nextDay) return candidate;
  if (24 * 60 % periodMinutes === 0) return nextDay;
  return nextDay + period;
}

export function earlyTarget(boundaryMs, earlySeconds, nowMs = Date.now()) {
  if (!Number.isFinite(boundaryMs) || !Number.isInteger(earlySeconds) || earlySeconds < 0 || !Number.isFinite(nowMs)) throw new TypeError('invalid early-target input');
  if (earlySeconds === 0) return null;
  const targetAt = boundaryMs - earlySeconds * 1000;
  return targetAt > nowMs ? targetAt : null;
}

export function mergeDueEvents(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event || !Number.isFinite(event.targetAt) || !['main', 'early'].includes(event.kind)) continue;
    const second = Math.floor(event.targetAt / 1000);
    if (!groups.has(second)) groups.set(second, []);
    groups.get(second).push(event);
  }
  const merged = [];
  for (const [second, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const hasMain = group.some(event => event.kind === 'main');
    const selected = hasMain ? group.filter(event => event.kind === 'main') : group;
    const deduped = new Map();
    for (const event of selected) {
      const key = `${event.kind}:${second}`;
      if (!deduped.has(key)) deduped.set(key, { ...event, slotIds: [] });
      const item = deduped.get(key);
      for (const slotId of event.slotIds || [event.slotId].filter(Boolean)) if (!item.slotIds.includes(slotId)) item.slotIds.push(slotId);
    }
    merged.push(...Array.from(deduped.values(), event => ({ ...event, targetSecond: second })));
  }
  return merged;
}

export function effectiveSlots(chime, runIntent, visible, audioUnlocked, isLeader) {
  if (!runIntent || !visible || !audioUnlocked || !isLeader || !Array.isArray(chime?.slots)) return [];
  return chime.slots.filter(slot => slot.enabled && !slot.paused);
}

export function clockLabel(timeMs, timeZone = CHIME_TIMEZONE, seconds = true) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(timeMs);
}
