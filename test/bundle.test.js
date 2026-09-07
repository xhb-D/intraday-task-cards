import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production bundle: index 使用 classic script，bundle 没有 ES module 或网络依赖', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.match(html, /<script src="dist\/app\.bundle\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="banner\.css">/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(bundle, /^import\s/m);
  assert.doesNotMatch(bundle, /https?:\/\//);
  assert.match(bundle, /loadInitialWorkspace/);
  assert.match(bundle, /diagnosticFromError/);
  assert.match(bundle, /renderTextBanner/);
});
