import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNoDuplicateTopLevelSymbols, collectTopLevelSymbols } from '../scripts/top-level-symbols.mjs';

test('build: 顶层声明收集仅接受模块级符号', () => {
  assert.deepEqual(collectTopLevelSymbols('const alpha = 1;\n  const nested = 2;\nexport function beta() {}', 'sample.js').map(item => item.name), ['alpha', 'beta']);
});

test('build: 故意重复顶层符号会在写入 bundle 前失败', () => {
  assert.throws(() => assertNoDuplicateTopLevelSymbols([{ file: 'a.js', source: 'export const duplicate = 1;' }, { file: 'b.js', source: 'function duplicate() {}' }]), /重复顶层符号 duplicate: a\.js:1 与 b\.js:1/);
  assert.match(readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8'), /assertNoDuplicateTopLevelSymbols\(sources\)/);
});
