// Local HTTP and temporary browser contexts only; all records are synthetic.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { intradayV6 as v6 } from '../src/intraday-v6/index.js';
import { makeEnvelope } from '../src/capture-persistence.js';
import { makeUnified, UNIFIED_KEY } from '../src/capture-unified.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.');
const output = resolve(process.argv[2] || 'docs/qa/v6-bias-helper-copy');
const base = '00aa5971a9f51c941b06c5b883e3966113fa2072';
const baseline = await mkdtemp(join(tmpdir(), 'v6-bias-copy-baseline-'));
execFileSync('tar', ['-x', '-C', baseline], {
  input: execFileSync('git', ['archive', base], { maxBuffer: 64 * 1024 * 1024 })
});
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (name.endsWith('/favicon.ico')) { response.writeHead(204); response.end(); return; }
    const before = name.startsWith('/baseline/');
    const directory = before ? baseline : root;
    if (before) name = name.slice('/baseline'.length);
    const path = resolve(directory, '.' + (name === '/' ? '/index.html' : name));
    assert.ok(path.startsWith(directory + '/'));
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
});
const oldNotes = ['HTF波段动能&新的未测试优质缺口', '价格拒绝（尾部/单打印）&价格接受（弱端点/震荡）'];
const newNotes = ['确定持仓预期（关注波段动能&未测试优质缺口）', '结合价格走势和VP分析TPO 确认价格拒绝和接受（尾部&单打印&弱端点）'];
const widths = [1440, 1024, 390, 375, 320];
const symbols = ['GC', 'CL', 'ES'];
const checks = [], screenshots = [], errors = [];
const time = 1791720000000;

function fixture(legacy, theme) {
  const state = v6.createWorkspace(time);
  for (const [index, symbol] of symbols.entries()) {
    v6.changeStructure(state, symbol, ['breakout_strong_pullback_weak', 'breakout_weak_pullback_strong', 'htf_range_v2'][index]);
    v6.changeBias(state, symbol, ['bullish', 'neutral', 'bearish'][index]);
    v6.changeDirection(state, symbol, index === 2 ? 'short' : 'long', time);
    if (legacy) state.cards[symbol].structure3m = ['trend_pullback_stronger', 'trend_pullback_weaker', 'bullish'][index];
  }
  v6.assertV6State(state);
  const unified = makeUnified(makeEnvelope(state, time));
  unified.preferences.appearance = theme;
  return JSON.stringify(unified);
}

async function pageFor(raw, width, theme, before) {
  const context = await browser.newContext({ viewport: { width, height: 1050 }, colorScheme: theme });
  await context.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: UNIFIED_KEY, raw });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', entry => { if (['error', 'warning'].includes(entry.type())) errors.push({ type: entry.type(), message: entry.text() }); });
  const response = await page.goto(origin + (before ? '/baseline/' : '/') + '#/home');
  assert.equal(response.status(), 200);
  await page.locator('#cards .capture-card').first().waitFor();
  return { context, page };
}

async function measure(page) {
  return page.evaluate(() => {
    const rectangle = element => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const style = element => {
      const s = getComputedStyle(element);
      return { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor, border: s.borderColor, whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, overflowX: s.overflowX, overflowY: s.overflowY, lineClamp: s.webkitLineClamp };
    };
    return {
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      cards: [...document.querySelectorAll('#cards .capture-card')].map(card => ({
        symbol: card.dataset.symbol,
        rect: rectangle(card),
        notes: [...card.querySelectorAll('.context-note')].map(note => {
          const range = document.createRange(); range.selectNodeContents(note);
          const lines = [...new Set([...range.getClientRects()].map(r => Math.round(r.top)))];
          const segment = note.closest('.classifier').querySelector('.segment');
          return { text: note.textContent, rect: rectangle(note), style: style(note), lines: lines.length, gap: segment.getBoundingClientRect().top - note.getBoundingClientRect().bottom, textRects: [...range.getClientRects()].map(r => ({ x: r.x, right: r.right, bottom: r.bottom })) };
        }),
        buttons: [...card.querySelectorAll('button')].map(button => ({ text: button.textContent, action: button.dataset.action, value: button.dataset.value, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled, rect: rectangle(button), style: style(button) })),
        legacy: card.querySelector('.structure-legacy-note')?.textContent || null
      }))
    };
  });
}

try {
  for (const theme of ['light', 'dark']) for (const width of widths) for (const legacy of [false, true]) {
    const raw = fixture(legacy, theme);
    const current = await pageFor(raw, width, theme, false);
    const before = await pageFor(raw, width, theme, true);
    try {
      const old = await measure(before.page), next = await measure(current.page);
      assert.equal(next.pageOverflow, false);
      assert.deepEqual(next.cards.map(card => card.symbol), symbols);
      for (const [index, card] of next.cards.entries()) {
        const original = old.cards[index];
        assert.deepEqual(card.notes.map(note => note.text), newNotes);
        assert.deepEqual(original.notes.map(note => note.text), oldNotes);
        assert.equal(card.legacy, original.legacy);
        assert.equal(Boolean(card.legacy), legacy);
        assert.ok(card.rect.x >= 0 && card.rect.right <= width);
        for (const [noteIndex, note] of card.notes.entries()) {
          assert.deepEqual(note.style, original.notes[noteIndex].style);
          assert.equal(note.style.fontSize, '11px'); assert.equal(note.style.fontWeight, '400');
          assert.equal(note.style.whiteSpace, 'normal'); assert.equal(note.style.textOverflow, 'clip');
          assert.ok(!['hidden', 'clip'].includes(note.style.overflowX));
          assert.ok(note.lines >= 1 && note.lines <= 2);
          assert.equal(note.gap, original.notes[noteIndex].gap); assert.ok(note.gap >= 0);
          assert.ok(note.textRects.every(r => r.x >= note.rect.x - 1 && r.right <= note.rect.right + 1 && r.bottom <= note.rect.bottom + 1));
        }
        assert.equal(card.buttons.length, original.buttons.length);
        for (const [buttonIndex, button] of card.buttons.entries()) {
          const oldButton = original.buttons[buttonIndex];
          assert.deepEqual({ ...button, rect: null }, { ...oldButton, rect: null });
          assert.equal(button.rect.width, oldButton.rect.width); assert.equal(button.rect.height, oldButton.rect.height);
          assert.ok(button.rect.x >= card.rect.x && button.rect.right <= card.rect.right);
        }
      }
      const originalHtml = await before.page.locator('#cards').innerHTML();
      let normalized = await current.page.locator('#cards').innerHTML();
      for (let i = 0; i < 2; i++) normalized = normalized.replaceAll(newNotes[i].replaceAll('&', '&amp;'), oldNotes[i].replaceAll('&', '&amp;'));
      assert.equal(normalized, originalHtml);
      assert.equal(await current.page.evaluate(key => localStorage.getItem(key), UNIFIED_KEY), raw);
      assert.equal(await before.page.evaluate(key => localStorage.getItem(key), UNIFIED_KEY), raw);
      const name = `${width}-${theme}${legacy ? '-legacy' : ''}.png`;
      if (!legacy || [1440, 320].includes(width)) {
        await current.page.screenshot({ path: join(output, name), fullPage: true }); screenshots.push(name);
      }
      checks.push({ theme, width, legacy, status: 'PASS', allThreeCards: true, canonicalUnchanged: true, markupOnlyTwoNotesChanged: true, metrics: next });
    } finally { await current.context.close(); await before.context.close(); }
  }
  assert.deepEqual(errors, []);
  const result = { status: 'PASS', base, browser: await browser.version(), fixture: 'synthetic only; no actual production storage', origin, widths, themes: ['light', 'dark'], scenarios: checks.length, screenshots, consoleErrorsOrWarnings: errors, checks, unverified: ['Real mobile keyboard/touch; physical monitors and native browser zoom were outside this copy-only task.'] };
  await writeFile(join(output, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', scenarios: checks.length, screenshots: screenshots.length, consoleErrorsOrWarnings: errors }));
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, errors, completedChecks: checks.length }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close(); await new Promise(done => server.close(done)); await rm(baseline, { recursive: true, force: true });
}
