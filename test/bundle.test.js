import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production bundle: index 使用 classic bundle，包含统一持久化与双路由且不依赖网络', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.match(html, /<script src="dist\/app\.bundle\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="banner\.css">/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(bundle, /^import\s/m);
  assert.doesNotMatch(bundle, /engine\.calculateRiskDecision/);
  assert.doesNotMatch(bundle, /https?:\/\//);
  assert.match(bundle, /trading-control-center:v1/);
  assert.match(bundle, /mountRiskManager/);
  assert.match(html, /#\/home/);
  assert.match(html, /#\/risk/);
  assert.match(bundle, /renderTextBanner/);
});
