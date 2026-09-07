import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSetup, changeStructure, changeDirection } from '../src/model.js';
import { makeEnvelope } from '../src/persistence.js';
import { loadInitialWorkspace, saveWorkspace } from '../src/startup.js';

const time = 1_700_000_000_000;
const cardsExist = state => Object.keys(state.cards).sort().join(',') === 'CL,ES,GC';

test('startup: getItem 抛异常时仍返回可操作的 GC/CL/ES 内存工作区', () => {
  const result = loadInitialWorkspace({ getItem() { throw new DOMException('blocked', 'SecurityError'); } }, time);
  assert.equal(result.mode, 'storage-unavailable'); assert.equal(cardsExist(result.state), true);
  assert.equal(changeStructure(result.state, 'GC', 'bullish', time + 1).changed, true);
  assert.equal(changeDirection(result.state, 'GC', 'long', time + 2).changed, true);
  assert.equal(chooseSetup(result.state, 'GC', 'pullback', time + 3).changed, true);
});

test('startup: storage 不存在时不阻塞 UI，JSON/Markdown 所需的状态保持可用', () => {
  const result = loadInitialWorkspace(null, time);
  assert.equal(result.mode, 'storage-unavailable'); assert.equal(cardsExist(result.state), true);
  assert.doesNotThrow(() => makeEnvelope(result.state, time));
});

test('startup: JSON parse 或 schema 不兼容不覆盖原始存档，转入明确恢复态并仍创建三卡', () => {
  for (const raw of ['{not json', JSON.stringify({ app: 'intraday-task-cards', schemaVersion: 999 })]) {
    const result = loadInitialWorkspace({ getItem: () => raw }, time);
    assert.equal(result.mode, 'recovery-required'); assert.equal(result.lastRaw, raw); assert.equal(cardsExist(result.state), true);
  }
});

test('startup: setItem 抛异常不丢失当前内存状态，保存结果明确失败且后续状态机仍可用', () => {
  const initial = loadInitialWorkspace(null, time); const before = JSON.stringify(initial.state);
  const saved = saveWorkspace({ setItem() { throw new DOMException('quota', 'QuotaExceededError'); }, getItem() { return null; } }, initial.state, time + 1);
  assert.equal(saved.ok, false); assert.equal(saved.error, 'STORAGE_WRITE_ERROR'); assert.equal(saved.diagnostic.errorCode, 'STORAGE_WRITE_ERROR'); assert.equal(saved.diagnostic.phase, 'storage_write'); assert.equal(JSON.stringify(initial.state), before);
  changeStructure(initial.state, 'CL', 'bearish', time + 2);
  assert.equal(changeDirection(initial.state, 'CL', 'short', time + 3).changed, true);
});

test('startup: 可用存档正常恢复；正常保存可回读', () => {
  const backing = new Map(); const storage = { getItem: key => backing.get(key) ?? null, setItem: (key, value) => backing.set(key, value) };
  const blank = loadInitialWorkspace(storage, time); assert.equal(blank.mode, 'blank');
  const saved = saveWorkspace(storage, blank.state, time + 10); assert.equal(saved.ok, true);
  const restored = loadInitialWorkspace(storage, time + 20); assert.equal(restored.mode, 'restored'); assert.equal(cardsExist(restored.state), true);
});
