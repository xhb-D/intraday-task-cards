import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { externalConflictPolicy } from '../src/conflict.js';
import { createWorkspace } from '../src/model.js';
import { saveWorkspace } from '../src/startup.js';

test('external conflict: persist guard never writes a stale workspace', () => {
  let writes = 0;
  const storage = {
    getItem: () => null,
    setItem() { writes += 1; }
  };
  const result = saveWorkspace(storage, createWorkspace(1), 2, { allowWrite: externalConflictPolicy(true).allowPersist });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Conflict');
  assert.equal(result.diagnostic.errorCode, 'EXTERNAL_WRITE_CONFLICT');
  assert.equal(result.diagnostic.phase, 'external_write');
  assert.equal(writes, 0);
});

test('external conflict: policy fails closed for edits and dangerous data actions while exports remain available', () => {
  const locked = externalConflictPolicy(true);
  assert.deepEqual(locked, {
    locked: true,
    allowMutation: false,
    allowPersist: false,
    cardsInert: true,
    historyInert: true,
    disableDangerousDataActions: true,
    hideRetry: true,
    exportsAvailable: true,
    message: '其他页面修改了存档；当前页面已锁定为只读。请先导出 JSON 或 Markdown 备份，再刷新读取最新状态。'
  });
  const freshDocument = externalConflictPolicy(false);
  assert.equal(freshDocument.allowMutation, true);
  assert.equal(freshDocument.allowPersist, true);
  assert.equal(freshDocument.exportsAvailable, true);
  assert.equal(freshDocument.message, '');
});

test('external conflict: app binds the lock to all mutation paths, including an already-open confirmation', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /return commitUnified\(storage, candidate, options\)/);
  assert.match(app, /storageUnsafe = true/);
  assert.match(app, /cardsEl\.inert = policy\.cardsInert/);
  assert.match(app, /historyBody\.inert = policy\.historyInert/);
  assert.match(app, /risk-dashboard-host'\)\.inert = policy\.cardsInert/);
  assert.match(app, /importJson\.disabled = policy\.disableDangerousDataActions/);
  assert.match(app, /retry\.hidden = true; startFresh\.hidden = true/);
  assert.match(app, /if \(pending \|\| corruption \|\| writeLocked\(\) \|\| button\.disabled\) return/);
  assert.match(app, /if \(!input \|\| pending \|\| corruption \|\| writeLocked\(\)\) return/);
  assert.match(app, /if \(!button \|\| writeLocked\(\) \|\| event\.detail > 1\) return/);
  assert.match(app, /if \(writeLocked\(\)\) \{ announce\('检测到存档冲突或回读不一致；当前页面已锁定，本次确认未应用'\); return; \}/);
  assert.match(app, /expectedRaw: action\.storageRaw/);
  assert.match(app, /externalConflict = true; saveError = 'Conflict'; storageStatus\(\);/);
});
