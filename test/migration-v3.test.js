import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/model.js';
import { deserialize, makeEnvelope, serialize } from '../src/persistence.js';

test('current v3: unjudged internal state round-trips without migration', () => {
  const state = createWorkspace(1);
  const raw = serialize(state, 2);
  assert.deepEqual(deserialize(raw).state, state);
});

test('legacy standalone schemas: v1 and v2 reject fail-closed', () => {
  for (const version of [1, 2]) {
    const legacy = makeEnvelope(createWorkspace(1), 2);
    legacy.schemaVersion = version;
    legacy.state.schemaVersion = version;
    assert.throws(() => deserialize(JSON.stringify(legacy)), error => error.code === 'SCHEMA_ERROR');
  }
});
