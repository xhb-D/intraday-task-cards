import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDirectionComputedStyle } from '../scripts/qa-v6-locked-direction.mjs';

for (const [theme, colors, neutrals, surface] of [
  ['light', ['#187a41', '#c53445'], ['rgb(110, 110, 115)', 'rgb(134, 134, 139)'], 'rgb(255, 255, 255)'],
  ['dark', ['#6cefa6', '#ff6879'], ['rgb(147, 161, 184)', 'rgb(107, 122, 148)'], 'rgb(26, 34, 51)']
]) for (const [i, direction] of ['long', 'short'].entries()) {
  test(`Browser computed-style contract ${theme}/${direction}: exact semantic color, reject neutral cascade/opacity/filters`, () => {
    const token = colors[i], color = `rgb(${token.slice(1).match(/../g).map(x => parseInt(x, 16)).join(', ')})`;
    const sample = { color, borderColor: color, backgroundColor: 'color(srgb 0.2 0.3 0.4)', semanticToken: token,
      neutralColors: neutrals, surfaceColor: surface, ancestorOpacities: ['1','1'], ancestorFilters: ['none','none'], editableDirectionCount: 0 };
    assert.equal(assertDirectionComputedStyle(sample), true);
    for (const neutral of neutrals) assert.throws(() => assertDirectionComputedStyle({...sample,color:neutral,borderColor:neutral}), /SEMANTIC_COLOR_LOST/);
    assert.throws(() => assertDirectionComputedStyle({...sample,borderColor:neutrals[0]}), /SEMANTIC_COLOR_LOST/);
    assert.throws(() => assertDirectionComputedStyle({...sample,backgroundColor:surface}), /TINT_LOST/);
    assert.throws(() => assertDirectionComputedStyle({...sample,ancestorOpacities:['1','.5']}), /DIMMED_BY_OPACITY/);
    assert.throws(() => assertDirectionComputedStyle({...sample,ancestorFilters:['grayscale(1)']}), /DIMMED_BY_FILTER/);
    assert.throws(() => assertDirectionComputedStyle({...sample,editableDirectionCount:3}), /BECAME_EDITABLE/);
  });
}
