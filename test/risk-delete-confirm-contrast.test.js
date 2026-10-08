import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../appearance.css', import.meta.url), 'utf8');
const selector = '.risk-dialog-body:has(> .risk-dialog-note + .risk-form-error) > .risk-dialog-actions > .risk-button.danger';
const rule = suffix => {
  const start = css.indexOf(selector + suffix + '{');
  assert.ok(start >= 0, `Missing scoped ${suffix || 'normal'} rule`);
  return css.slice(start).split('{')[1].split('}')[0];
};
const luminance = hex => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
};
const contrast = (fg, bg) => (Math.max(luminance(fg), luminance(bg)) + .05) / (Math.min(luminance(fg), luminance(bg)) + .05);

test('Risk delete confirm contrast: narrowly scoped white text, opaque red background on both themes', () => {
  assert.match(rule(''), /color:#fff(?:;|$)/);
  assert.match(rule(''), /background:#542e30/);
  assert.match(rule(''), /opacity:1/);
  assert.ok(css.indexOf(selector) > css.indexOf('.risk-button:hover:not(:disabled)'), 'Scoped declarations follow generic appearance overrides');
  assert.doesNotMatch(rule(''), /!important/);
});
for (const [state, suffix, background] of [
  ['normal/focus', '', '542e30'], ['hover', ':hover:not(:disabled)', '6b3336'], ['disabled', ':disabled', '744b4d'],
]) test(`Risk delete confirm contrast: ${state} meets 4.5:1 with white text`, () => {
  assert.ok(rule(suffix).includes(`background:#${background}`));
  assert.ok(contrast('ffffff', background) >= 4.5);
});
test('Risk delete confirm contrast: selector excludes Cancel, Save and editor Delete', () => {
  assert.ok(selector.endsWith('> .risk-button.danger'));
  const source = readFileSync(new URL('../src/risk-manager-view.js', import.meta.url), 'utf8');
  const editor = source.slice(source.indexOf('function accountForm'), source.indexOf('function deleteConfirm'));
  assert.ok(editor.includes("field(form, { label: '账户名称'"));
  assert.ok(editor.indexOf('field(form,') < editor.indexOf("const error = el('p', 'risk-form-error')"));
  const confirmation = source.slice(source.indexOf('function deleteConfirm'), source.indexOf('function balanceForm'));
  assert.ok(confirmation.includes("const error = el('p', 'risk-form-error');\n      form.appendChild(error);"));
  assert.ok(confirmation.includes("const cancel = button('取消');"));
});
