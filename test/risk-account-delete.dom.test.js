import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, FakeOption } from '../scripts/qa-fixtures/risk-dom.js';
import { setupDeleteDom, deleteDomCases } from '../scripts/qa-fixtures/risk-account-delete-cases.js';

for (const compact of [true, false]) for (const [name, run] of deleteDomCases) {
  test(`Risk delete DOM ${compact ? 'home' : 'risk'}: ${name}`, async () => {
    const prior = { document: globalThis.document, Option: globalThis.Option };
    globalThis.document = { body: new FakeElement('body'), createElement: tag => new FakeElement(tag) };
    globalThis.Option = FakeOption;
    const context = setupDeleteDom(compact);
    try { await run(context, assert); }
    finally { context.dispose(); await Promise.resolve(); Object.assign(globalThis, prior); }
  });
}
