import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production bundle: index 使用 classic script；仅保留 Trading Risk Manager 导航入口', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../dist/app.bundle.js', import.meta.url), 'utf8');
  assert.match(html, /<script src="dist\/app\.bundle\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="banner\.css">/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(bundle, /^import\s/m);
  assert.doesNotMatch(bundle, /engine\.calculateRiskDecision/);
  const navigationUrl = 'https://xhb-d.github.io/trading-risk-manager/';
  assert.match(bundle, new RegExp(navigationUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(bundle.replace(navigationUrl, ''), /https?:\/\//);
  assert.match(bundle, /loadInitialWorkspace/);
  assert.match(bundle, /diagnosticFromError/);
  assert.match(bundle, /renderTextBanner/);
});
