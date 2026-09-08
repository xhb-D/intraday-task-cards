import test from 'node:test';
import assert from 'node:assert/strict';
import { runRiskEngineTests } from './risk-manager-legacy/risk-engine.test.js';
import { runPersistenceTests } from './risk-manager-legacy/persistence.test.js';
import { runV2SpecTests } from './risk-manager-legacy/v2-spec.test.js';
import { runRolloverTests } from './risk-manager-legacy/rollover.test.js';
import { runNavigationTests } from './risk-manager-legacy/navigation.test.js';

for (const result of [...runRiskEngineTests(), ...runPersistenceTests(), ...runV2SpecTests(), ...runRolloverTests(), ...runNavigationTests()]) {
  test(`legacy ${result.suite}: ${result.name}`, () => assert.equal(result.pass, true, result.error));
}
