import test from 'node:test';
import assert from 'node:assert/strict';
import { CHIME_PRESETS, defaultChime, migrateLegacyChime, maxEarlySeconds, periodMinutes, updateSlot, updateChimePreference, validateChime } from '../src/natural-chime/model.js';
import { earlyTarget, effectiveSlots, mergeDueEvents, nextBoundary, zonedParts } from '../src/natural-chime/time.js';

const BJ_MIDNIGHT = Date.UTC(2024, 11, 31, 16, 0, 0);

test('Natural Chime defaults contain exactly five stable independent slots', () => {
  const state = defaultChime();
  assert.equal(state.schemaVersion, 1); assert.deepEqual(state.slots.map(slot => slot.slotId), ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5']);
  assert.deepEqual(state.slots.map(slot => slot.enabled), [true, false, false, false, false]);
  assert.ok(state.slots.every(slot => slot.paused === false && slot.preset === '5' && slot.minutes === 5 && slot.earlySeconds === 30));
  assert.equal(state.voiceEnabled, true); assert.equal(state.selectedVoiceURI, ''); assert.equal(state.notifyEnabled, false); assert.equal(validateChime(state), true);
});

test('Verified legacy V1 maps only to slot 1 and applies documented UI defaults', () => {
  const state = migrateLegacyChime({ preset: 'custom', minutes: '7', early: '60', voice: false, notify: true });
  assert.equal(state.legacyImport.status, 'legacy-v1'); assert.equal(state.legacyImport.sourceVersion, 1);
  assert.deepEqual(state.slots.map(slot => [slot.enabled, slot.paused]), [[true, false], [false, false], [false, false], [false, false], [false, false]]);
  assert.deepEqual(state.slots[0], { slotId: 'slot-1', enabled: true, paused: false, preset: 'custom', minutes: 7, earlySeconds: 60 });
  assert.equal(state.voiceEnabled, false); assert.equal(state.notifyEnabled, true);
  const defaults = migrateLegacyChime({ version: 1 });
  assert.deepEqual(defaults.slots[0], { slotId: 'slot-1', enabled: true, paused: false, preset: '5', minutes: 5, earlySeconds: 30 });
  assert.equal(defaults.voiceEnabled, true); assert.equal(defaults.notifyEnabled, false);
});

test('Legacy version 2, unknown versions, fields, types and unrepresentable values fail closed', () => {
  for (const value of [
    { version: 2, schedules: [], voice: true, notify: false },
    { version: 3 }, { version: null }, { preset: '5', unexpected: true },
    { preset: '5', minutes: 5 }, { preset: 'custom', minutes: '1', early: '60' },
    { preset: 'custom', minutes: '0' }, { early: '61' }, { voice: 'true' }, { notify: 1 }
  ]) assert.throws(() => migrateLegacyChime(value), error => error.code === 'CHIME_VALIDATION_ERROR');
  assert.equal(CHIME_PRESETS.includes('240'), true);
  assert.equal(maxEarlySeconds(1), 59);
});

test('Slot updates are immutable, targeted, and reject invalid domains', () => {
  const original = defaultChime();
  const changed = updateSlot(original, 'slot-2', { enabled: true, paused: true });
  assert.equal(original.slots[1].enabled, false); assert.equal(original.slots[1].paused, false);
  assert.equal(changed.slots[1].enabled, true); assert.equal(changed.slots[1].paused, true);
  assert.deepEqual(changed.slots[0], original.slots[0]);
  assert.throws(() => updateSlot(changed, 'slot-6', { paused: true }));
  assert.throws(() => updateSlot(changed, 'slot-1', { paused: 'true' }));
  assert.throws(() => updateChimePreference(changed, 'runIntent', 'running'));
});

test('Preset and custom periods map consistently', () => {
  for (const preset of ['3', '5', '15', '30', '60', '240']) assert.equal(periodMinutes({ preset, minutes: 99 }), Number(preset));
  assert.equal(periodMinutes({ preset: 'custom', minutes: 7 }), 7);
});

test('Asia/Shanghai boundary uses strictly future wall-clock targets and exact midnight anchoring', () => {
  assert.equal(nextBoundary(5, BJ_MIDNIGHT), BJ_MIDNIGHT + 5 * 60_000);
  const exactSix = BJ_MIDNIGHT + 6 * 60_000;
  assert.equal(nextBoundary(3, exactSix), exactSix + 3 * 60_000);
  const localBrowserDifferent = Date.UTC(2025, 0, 1, 0, 2, 0);
  const expected = Date.UTC(2025, 0, 1, 0, 5, 0);
  assert.equal(nextBoundary(5, localBrowserDifferent), expected);
  assert.deepEqual(zonedParts(BJ_MIDNIGHT, 'Asia/Shanghai'), { year: 2025, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
});

test('Non-divisor periods re-anchor at Beijing midnight; 1440 minutes means next midnight', () => {
  const lateDay = BJ_MIDNIGHT + (23 * 60 + 58) * 60_000;
  assert.equal(nextBoundary(7, lateDay), BJ_MIDNIGHT + 24 * 60 * 60_000 + 7 * 60_000);
  const afterNextMidnight = BJ_MIDNIGHT + 24 * 60 * 60_000 + 4 * 60_000;
  assert.equal(nextBoundary(7, afterNextMidnight), BJ_MIDNIGHT + 24 * 60 * 60_000 + 7 * 60_000);
  assert.equal(nextBoundary(1440, BJ_MIDNIGHT), BJ_MIDNIGHT + 24 * 60 * 60_000);
});

test('Early events omit past/equal targets; coincident main events suppress early and dedupe deterministically', () => {
  assert.equal(earlyTarget(100_000, 30, 69_999), 70_000);
  assert.equal(earlyTarget(100_000, 30, 70_000), null);
  assert.equal(earlyTarget(100_000, 0, 0), null);
  const merged = mergeDueEvents([
    { kind: 'early', targetAt: 10_000, slotId: 'slot-1' },
    { kind: 'main', targetAt: 10_200, slotId: 'slot-2' },
    { kind: 'main', targetAt: 10_900, slotId: 'slot-3' },
    { kind: 'early', targetAt: 11_100, slotId: 'slot-4' }
  ]);
  assert.deepEqual(merged, [
    { kind: 'main', targetAt: 10_200, slotId: 'slot-2', slotIds: ['slot-2', 'slot-3'], targetSecond: 10 },
    { kind: 'early', targetAt: 11_100, slotId: 'slot-4', slotIds: ['slot-4'], targetSecond: 11 }
  ]);
});

test('Effective slot eligibility requires every global gate and preserves individual pause', () => {
  const state = defaultChime(); state.slots[0].paused = true; state.slots[1].enabled = true;
  assert.deepEqual(effectiveSlots(state, true, true, true, true).map(slot => slot.slotId), ['slot-2']);
  for (const gates of [[false, true, true, true], [true, false, true, true], [true, true, false, true], [true, true, true, false]]) {
    assert.deepEqual(effectiveSlots(state, gates[0], gates[1], gates[2], gates[3]), []);
  }
});
