import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const css = fs.readFileSync(fileURLToPath(new URL('../../risk-dashboard.css', import.meta.url)), 'utf8');

const riskView = fs.readFileSync(fileURLToPath(new URL('../../src/risk-manager-view.js', import.meta.url)), 'utf8');

export function runNavigationTests() {
  const results = [];
  const check = (name, pass, error = '') => results.push({ suite: 'navigation', name, pass, error });
  check('header has internal return-home link', /href="#\/home"/.test(html));
  check('risk route has a visible return-home link', /← 返回日内交易状态卡/.test(html));
  check('appearance label and select remain accessible', /appearance-label[\s\S]*appearance-select/.test(html) && /aria-label="外观"/.test(html));
  check('compact risk controls keep a shared minimum height', /\.risk-button\{min-height:36px/.test(css) && /\.risk-mobile-picker\{display:none/.test(css));
  check('wide account rail scrolls and narrow layout exposes account summary', /\.risk-rail\{display:flex[\s\S]*overflow-x:auto/.test(css) && /\.risk-mobile-account\{display:none/.test(css) && /@media\(max-width:820px\)[\s\S]*\.risk-mobile-account\{display:grid/.test(css) && /\.risk-mobile-details\{[^}]*border-left:1px solid/.test(css));
  check('narrow layout keeps risk actions usable', /@media\(max-width:820px\)[\s\S]*\.risk-actions\{padding-left:0;flex-wrap:wrap/.test(css));
  check('narrow header retains appearance control and account module retains risk entry', /aria-label="外观"/.test(html) && /entry\.href = '#\/risk'/.test(riskView) && /id="risk-dashboard-host"/.test(html));
  return results;
}
