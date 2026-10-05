// Synthetic-only browser QA. Generates local pages; never touches browser storage.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureUi } from '../src/capture-ui.js';
import * as v6 from '../src/intraday-v6/model.js';

// Used with actual getComputedStyle results in the generated browser pages.
export function assertDirectionComputedStyle(sample) {
  const rgb = hex => `rgb(${hex.slice(1).match(/../g).map(x => parseInt(x, 16)).join(', ')})`;
  const expected = rgb(sample.semanticToken.trim());
  if (sample.color !== expected || sample.borderColor !== expected) throw new Error('DIRECTION_SEMANTIC_COLOR_LOST');
  if (sample.neutralColors.includes(sample.color)) throw new Error('DIRECTION_BECAME_NEUTRAL');
  if (sample.backgroundColor === sample.surfaceColor || sample.backgroundColor === 'rgba(0, 0, 0, 0)') throw new Error('DIRECTION_TINT_LOST');
  if (sample.ancestorOpacities.some(value => Number(value) !== 1)) throw new Error('DIRECTION_DIMMED_BY_OPACITY');
  if (sample.ancestorFilters.some(value => value !== 'none')) throw new Error('DIRECTION_DIMMED_BY_FILTER');
  if (sample.editableDirectionCount !== 0) throw new Error('LOCKED_DIRECTION_BECAME_EDITABLE');
  return true;
}

export async function makeLockedDirectionQa(directory) {
  const output = resolve(directory), base = new URL('../', import.meta.url);
  await mkdir(output, { recursive: true });
  const index = await readFile(new URL('index.html', base), 'utf8');
  const styles = [...index.matchAll(/<link rel="stylesheet" href="([^?]+)(\?v=[^"]+)"/g)];
  for (const [, filename] of styles) await copyFile(new URL(filename, base), resolve(output, filename));
  await copyFile(new URL('appearance.css', base), resolve(output, 'candidate-appearance.css'));
  const T = 1750000000000, cards = [];
  for (const [context, stage] of [['locked', 'signal'], ['holding', 'position']]) {
    const state = v6.createWorkspace(T);
    for (const [symbol, direction, structure] of [['GC', 'long', 'bullish'], ['CL', 'short', 'bearish']]) {
      v6.changeStructure(state, symbol, structure);
      v6.changeDirection(state, symbol, direction, T + 1);
      const { opportunity } = v6.chooseSetup(state, symbol, 'mtf_pb', T + 2);
      v6.setOpportunityStage(state, opportunity.id, 'signal', T + 3);
      if (stage === 'position') v6.markEntered(state, opportunity.id, T + 4, true);
      cards.push(`<section id="${context}-${direction}" data-qa-context="${context}" data-qa-direction="${direction}"><h2>${context === 'locked' ? '当前机会锁定' : '跟随当前持仓'} · ${direction}</h2>${captureUi.renderCard(state, symbol)}</section>`);
    }
  }
  const browserTest = `const verify = ${assertDirectionComputedStyle.toString()};
    const root = getComputedStyle(document.documentElement), rows = [];
    const rgb = hex => 'rgb(' + hex.trim().slice(1).match(/../g).map(x => parseInt(x,16)).join(', ') + ')';
    try {
      for (const panel of document.querySelectorAll('[data-qa-context]')) {
        const element = panel.querySelector('.direction-field .readonly'), style = getComputedStyle(element);
        const ancestors = []; for(let e=element; e; e=e.parentElement) ancestors.push(getComputedStyle(e));
        const sample = {theme:document.documentElement.dataset.theme,context:panel.dataset.qaContext,direction:panel.dataset.qaDirection,
          text:element.textContent, color:style.color, borderColor:style.borderTopColor, backgroundColor:style.backgroundColor,
          surfaceColor:rgb(root.getPropertyValue('--bg-surface')),
          neutralColors:['--text-primary','--text-secondary','--text-tertiary'].map(key=>rgb(root.getPropertyValue(key))),
          semanticToken:root.getPropertyValue(panel.dataset.qaDirection==='long'?'--semantic-bullish':'--semantic-bearish'),
          ancestorOpacities:ancestors.map(s=>s.opacity),ancestorFilters:ancestors.map(s=>s.filter),
          editableDirectionCount:panel.querySelectorAll('[data-action="direction"]').length};
        verify(sample); rows.push(sample);
      }
      const status=document.getElementById('qa-status');status.textContent='COMPUTED STYLE PASS: '+rows.length+'/4';status.dataset.result='PASS';
    } catch(error) {const status=document.getElementById('qa-status');status.textContent='FAIL: '+error.message;status.dataset.result='FAIL';}
    document.getElementById('qa-results').textContent=JSON.stringify(rows,null,2);`;
  for (const theme of ['light', 'dark']) {
    await writeFile(resolve(output, `${theme}.html`), `<!doctype html><html lang="zh-CN" data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles.map(([,f,v])=>`<link rel="stylesheet" href="${f}${v}">`).join('')}<title>Locked Direction ${theme} synthetic QA</title><body><main class="shell"><h1>${theme} · synthetic computed-style QA</h1><p id="qa-status">RUNNING</p><div class="cards">${cards.join('')}</div><details><summary>Computed styles</summary><pre id="qa-results"></pre></details></main><script>${browserTest}</script></body></html>`);
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/qa-v6-locked-direction.mjs <temporary QA directory>');
  console.log(await makeLockedDirectionQa(process.argv[2]));
}
