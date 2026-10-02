import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutputAdapter } from '../src/natural-chime/output.js';

function makeAudioEnvironment() {
  const oscillators = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    async resume() { this.state = 'running'; }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() { return this; }
      };
    }
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        onended: null,
        connect() { return this; },
        start() {},
        stop() {}
      };
      oscillators.push(oscillator);
      return oscillator;
    }
  }
  return { environment: { AudioContext }, oscillators };
}

test('Preview keeps its temporary audio leadership until both beeps finish', async () => {
  const { environment, oscillators } = makeAudioEnvironment();
  const output = createOutputAdapter(environment);
  assert.equal((await output.unlock()).ok, true);

  let settled = false;
  const preview = output.preview({ voiceEnabled: false }, async () => true).then(result => {
    settled = true;
    return result;
  });
  await Promise.resolve();

  assert.equal(oscillators.length, 2);
  assert.equal(settled, false, 'leader release must not stop a newly scheduled preview');
  oscillators[0].onended();
  await Promise.resolve();
  assert.equal(settled, false, 'preview remains active until its final beep ends');
  oscillators[1].onended();

  const result = await preview;
  assert.equal(result.sound.ok, true);
  assert.equal(settled, true);
});
