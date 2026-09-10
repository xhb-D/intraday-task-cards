import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertState, copy } from '../src/model.js';
import { makeEnvelope } from '../src/persistence.js';
import { migrateState } from '../src/risk-manager/migration.js';
import { deriveDecision } from '../src/risk-manager/session-service.js';
import { validateImport as validateLegacyRiskImport } from '../src/risk-manager/backup-service.js';
import { applyRoute, normalizeRoute, parseRoute } from '../src/router.js';
import { LEGACY_RISK_KEY, PRE_IMPORT_KEY, UNIFIED_KEY, classifyBackup, commitUnified, loadUnified, makeUnified, normalizeImport, parseBackupRaw, validateRisk, validateUnified } from '../src/unified-persistence.js';
import { goldenFixtures } from './fixtures/compatibility/golden-fixtures.js';

const manifest = JSON.parse(readFileSync(new URL('./fixtures/compatibility/manifest.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const raw = value => typeof value === 'string' ? value : JSON.stringify(value);
const store = (entries = {}, hooks = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem(key) { return hooks.getItem ? hooks.getItem(key, map) : (map.has(key) ? map.get(key) : null); },
    setItem(key, value) { if (hooks.setItem) return hooks.setItem(key, value, map); map.set(key, String(value)); },
  };
};
const riskV2 = () => clone(goldenFixtures['risk-v2-multi-history'].value);
const unifiedActive = () => clone(goldenFixtures['unified-v1-active'].value);

test('Golden fixtures: manifest has deterministic SHA-256 metadata and only synthetic labels', () => {
  assert.equal(manifest.classification, 'synthetic-only');
  for (const [name, fixture] of Object.entries(goldenFixtures)) {
    const expected = manifest.fixtures[name];
    assert.ok(expected, `${name} manifest entry`);
    assert.deepEqual(expected.sections, fixture.sections);
    assert.equal(expected.expectedSchemaVersion, fixture.expectedSchemaVersion);
    assert.equal(createHash('sha256').update(raw(fixture.value)).digest('hex'), expected.sha256);
    assert.doesNotMatch(raw(fixture.value), /LFF\d|真实账户|Tradovate/i);
  }
});
test('Golden fixtures: old standalone intraday samples are rejection-only cases', () => {
  for (const name of ['intraday-v1-active', 'intraday-v2-near', 'intraday-v3-holding']) {
    const fixture = goldenFixtures[name];
    assert.equal(fixture.expectedSchemaVersion, null); assert.deepEqual(fixture.sections, []); assert.match(fixture.summary, /明确拒绝/);
  }
  assert.match(goldenFixtures['invalid-ambiguous'].summary, /优先明确拒绝/);
});

test('C01/C03 旧风险键迁移到统一 key，并创建空白 GC/CL/ES', () => {
  const risk = raw(goldenFixtures['risk-v2-multi-history'].value);
  const s = store({ [LEGACY_RISK_KEY]: risk }); const loaded = loadUnified(s);
  assert.equal(loaded.source, 'legacy-risk'); const saved = commitUnified(s, loaded.state); assert.deepEqual(JSON.parse(s.getItem(UNIFIED_KEY)), saved); assert.equal(s.getItem(LEGACY_RISK_KEY), risk);
  assert.equal(loaded.state.sections.riskManager.accounts.length, 2);
});
test('C02 旧独立状态卡备份被明确拒绝，当前状态保持不变', () => {
  const current = unifiedActive(); const before = raw(current);
  assert.throws(() => normalizeImport(goldenFixtures['intraday-v3-holding'].value, current), /不支持旧版独立日内状态卡备份/);
  assert.equal(raw(current), before);
});
test('C04 canonical 优先：不重新吸收旧键', () => {
  const canonical = unifiedActive(); const s = store({ [UNIFIED_KEY]: raw(canonical), [LEGACY_RISK_KEY]: raw({ schemaVersion: 2, selectedAccountId: 'missing', accounts: [] }) });
  const loaded = loadUnified(s); assert.equal(loaded.source, 'canonical'); assert.deepEqual(loaded.state, canonical);
});
test('C05 当前统一存档正常恢复，不读取独立状态卡键', () => {
  const canonical = unifiedActive(); const s = store({ [UNIFIED_KEY]: raw(canonical) }); const loaded = loadUnified(s);
  assert.equal(loaded.source, 'canonical'); assert.deepEqual(loaded.state, canonical);
});
test('C06/C07/C08 旧独立状态卡的任意历史 schema 均不迁移，统一格式仍可导入', () => {
  for (const fixture of ['intraday-v1-active', 'intraday-v2-near', 'intraday-v3-holding']) assert.throws(() => normalizeImport(goldenFixtures[fixture].value, makeUnified()), /不支持旧版独立日内状态卡备份/);
  const current = unifiedActive(); assert.deepEqual(normalizeImport(current, makeUnified()).state, current);
});
test('C09 风险 schema 1：迁移到 2、快照冻结且 hardLossAmount 为 null', () => {
  const migrated = migrateState(goldenFixtures['risk-v1-legacy'].value); validateRisk(migrated);
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.accounts[0].hardLossAmount, null); assert.equal(migrated.accounts[0].currentSession.riskSnapshot.version, 1);
});
test('C10 风险 schema 2：账户、选择、时段、事件与快照往返相等', () => {
  const fixture = riskV2(); validateRisk(fixture); assert.deepEqual(migrateState(fixture), fixture); assert.equal(fixture.selectedAccountId, fixture.accounts[0].id);
});
test('C11 统一 schema 1：两域与 preferences 完整恢复', () => {
  const fixture = unifiedActive(); validateUnified(fixture); assert.deepEqual(normalizeImport(fixture, makeUnified()).state, fixture);
});
test('C13 旧风险分项导入：仅 riskManager 改变', () => {
  const current = unifiedActive(); const result = normalizeImport(goldenFixtures['risk-v2-multi-history'].value, current).state;
  assert.deepEqual(result.sections.intraday, current.sections.intraday); assert.deepEqual(result.preferences, current.preferences);
});
test('C14 统一备份始终包含当前状态卡 section，不再生成独立状态卡备份', () => {
  const exported = unifiedActive(); validateUnified(exported); assert.equal(exported.app, 'trading-control-center'); assert.ok(exported.sections.intraday.state.cards.GC);
});
test('C15 风险分项导出：旧风险验证器可读取', () => {
  const exported = unifiedActive().sections.riskManager; validateRisk(exported); const result = validateLegacyRiskImport(raw(exported)); assert.equal(result.ok, true, result.error); assert.deepEqual(result.state, exported);
});
test('C16 非法 JSON：拒绝且当前内存与存储零变化', () => {
  const before = unifiedActive(); const s = store({ [UNIFIED_KEY]: raw(before) }); assert.throws(() => parseBackupRaw('{bad'));
  assert.equal(s.getItem(UNIFIED_KEY), raw(before)); assert.deepEqual(before, unifiedActive());
});
test('C17 未知顶层版本：拒绝，不猜测降级', () => {
  assert.throws(() => normalizeImport(goldenFixtures['invalid-future-version'].value, makeUnified()), /受支持/);
});
test('C18 未知 section 版本：拒绝整个拟提交结果', () => {
  const invalid = unifiedActive(); invalid.sections.riskManager.schemaVersion = 99; assert.throws(() => validateUnified(invalid), /风险管理器版本/);
});
test('C19 零类格式匹配：拒绝并提示无法识别', () => { assert.throws(() => classifyBackup({}), /无法识别/); });
test('C20 伪装为风险格式的旧独立状态卡：仍明确拒绝', () => { assert.throws(() => classifyBackup(goldenFixtures['invalid-ambiguous'].value), /不支持旧版独立日内状态卡备份/); });
test('C21 重复账户、会话、事件 ID：拒绝并返回字段路径', () => {
  for (const mutate of [state => { state.accounts[1].id = state.accounts[0].id; }, state => { state.accounts[1].currentSession.id = state.accounts[0].currentSession.id; }, state => { state.accounts[0].currentSession.balanceEvents[1].id = state.accounts[0].currentSession.balanceEvents[0].id; }]) {
    const invalid = riskV2(); mutate(invalid); assert.throws(() => validateRisk(invalid), error => Boolean(error.path));
  }
});
test('C22 余额事件链断裂：拒绝且不静默修补', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[1].previousBalance = 1; assert.throws(() => validateRisk(invalid), error => /链断裂/.test(error.message) && /previousBalance/.test(error.path)); });
test('C23 事件 delta 错误：拒绝且不静默重算', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[1].delta = 0; assert.throws(() => validateRisk(invalid), error => /delta/.test(error.path)); });
test('C24 非法时间戳：拒绝并定位字段', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[0].timestamp = 'tomorrow'; assert.throws(() => validateRisk(invalid), error => /timestamp/.test(error.path)); });
test('C25 当前统一存档的活动机会与记录身份不一致：assertState 拒绝', () => { const state = clone(unifiedActive()).sections.intraday.state; state.records[0].id = 'different-id'; assert.throws(() => assertState(state), /活动记录不一致/); });
test('C26 超过 8 MB：JSON 解析前拒绝', () => { assert.throws(() => parseBackupRaw('x'.repeat(8 * 1024 * 1024 + 1)), error => error.code === 'FILE_TOO_LARGE'); });
test('C27 canonical 写入失败：旧值保留，调用方仍拥有内存候选', () => {
  const prior = raw(unifiedActive()); const s = store({ [UNIFIED_KEY]: prior }, { setItem(key) { if (key === UNIFIED_KEY) throw new Error('quota'); } }); const candidate = unifiedActive();
  assert.throws(() => commitUnified(s, candidate), error => error.code === 'CANONICAL_WRITE_FAILED'); assert.equal(s.getItem(UNIFIED_KEY), prior); assert.equal(candidate.sections.riskManager.accounts.length, 2);
});
test('C28 写后回读不一致：安全停止错误且不返回新 state', () => {
  const s = store({}, { setItem(key, value, map) { map.set(key, key === UNIFIED_KEY ? `${value} tampered` : value); } });
  assert.throws(() => commitUnified(s, makeUnified()), error => error.code === 'POST_WRITE_MISMATCH');
});
test('C29 pre-import 快照失败：正式导入不开始', () => {
  let canonicalWrites = 0; const s = store({}, { setItem(key, value, map) { if (key === PRE_IMPORT_KEY) throw new Error('no snapshot'); if (key === UNIFIED_KEY) canonicalWrites += 1; map.set(key, value); } });
  assert.throws(() => commitUnified(s, makeUnified(), { preImport: true }), error => error.code === 'PRE_IMPORT_SNAPSHOT_FAILED'); assert.equal(canonicalWrites, 0);
});
test('C30 确认前另一标签页写入：revision guard 取消导入且不覆盖新值', () => {
  const s = store(); const initial = commitUnified(s, makeUnified()); const expectedRaw = s.getItem(UNIFIED_KEY); const external = commitUnified(s, initial); const externalRaw = s.getItem(UNIFIED_KEY);
  assert.throws(() => commitUnified(s, initial, { preImport: true, expectedRaw }), error => error.code === 'REVISION_CONFLICT'); assert.equal(s.getItem(UNIFIED_KEY), externalRaw); assert.equal(JSON.parse(externalRaw).revision, external.revision);
});
test('C31 同一备份重复导入：结果相同，不重复迁移或新增记录', () => {
  const current = makeUnified(); const fixture = goldenFixtures['unified-v1-active'].value; const first = normalizeImport(fixture, current).state; const second = normalizeImport(fixture, first).state;
  assert.deepEqual(second, first); assert.equal(second.sections.intraday.state.records.length, 1);
});
test('C32 多账户和长余额历史：顺序、选择与风险结论一致', () => {
  const state = riskV2(); const decisions = state.accounts.map(deriveDecision); validateRisk(state);
  assert.deepEqual(state.accounts.map(account => account.id), ['acct-demo-v2-a', 'acct-demo-v2-b']); assert.equal(state.selectedAccountId, 'acct-demo-v2-a'); assert.deepEqual(state.accounts.map(deriveDecision), decisions);
});
test('C33 小数金额与边界值：风险结论不漂移', () => {
  const state = riskV2(); state.accounts[0].currentSession.balanceEvents[1].newBalance = 50040.01; state.accounts[0].currentSession.balanceEvents[1].delta = -29.99; validateRisk(state);
  const decision = deriveDecision(state.accounts[0]); assert.equal(decision.currentRealizedBalance, 50040.01); assert.equal(decision.status, 'ALLOWED');
});
test('C34 Safari file:// 降级：无 storage 仍有空白工作区，当前统一 JSON 可解析', () => { assert.equal(loadUnified(null).source, 'storage-unavailable'); assert.deepEqual(parseBackupRaw(raw(unifiedActive())).app, 'trading-control-center'); });
test('C35 不同 localhost 端口：彼此不自动发现，JSON 仍可导入', () => { const a = store({ [UNIFIED_KEY]: raw(unifiedActive()) }); const b = store(); assert.equal(loadUnified(b).source, 'blank'); assert.equal(normalizeImport(JSON.parse(a.getItem(UNIFIED_KEY)), makeUnified()).kind, 'unified'); });
test('C36 #/risk 硬刷新目标：同一 index 和 route 规范化', () => { const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.equal(parseRoute('#/risk'), 'risk'); assert.equal(normalizeRoute('#/risk'), '#/risk'); assert.match(html, /data-route-view="risk"/); });
test('C37 浏览器返回/前进目标：路由切换不重复初始化', () => {
  const views = [{ dataset: { routeView: 'home' }, hidden: false }, { dataset: { routeView: 'risk' }, hidden: true }, { dataset: { routeView: 'error' }, hidden: true }]; const links = [{ dataset: { routeLink: 'home' }, setAttribute() {} }, { dataset: { routeLink: 'risk' }, setAttribute() {} }];
  const root = { querySelectorAll: selector => selector === '[data-route-view]' ? views : links }; applyRoute(root, '#/risk'); applyRoute(root, '#/home'); assert.equal(views[0].hidden, false); assert.equal(views[1].hidden, true);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'); assert.equal((app.match(/dashboardView = initRiskDashboard/g) || []).length, 1); assert.equal((app.match(/fullRiskView = initRiskManagerView/g) || []).length, 1);
});
test('Architecture 3 未知 hash：显示错误、保留 hash、提供返回入口并聚焦标题', () => {
  const views = [{ dataset: { routeView: 'home' }, hidden: false }, { dataset: { routeView: 'risk' }, hidden: true }, { dataset: { routeView: 'error' }, hidden: true }]; const links = [];
  const message = { textContent: '' }; const heading = { focused: false, focus() { this.focused = true; } };
  const root = { querySelectorAll: selector => selector === '[data-route-view]' ? views : links, querySelector: selector => selector === '[data-route-error]' ? message : selector === '[data-route-error-heading]' ? heading : null };
  assert.equal(normalizeRoute('#/missing'), '#/missing'); const result = applyRoute(root, '#/missing'); assert.deepEqual(result, { route: 'error', unknown: true }); assert.equal(views[2].hidden, false); assert.match(message.textContent, /#\/missing/); assert.equal(heading.focused, true);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.match(html, /data-route-view="error"/); assert.match(html, /href="#\/home" class="link route-error-home"/);
});
test('C38 导出界面只提供统一备份与风险管理器备份，线上验证待发布授权', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.match(html, /id="export-json"/); assert.match(html, /id="export-risk-json"/); assert.doesNotMatch(html, /export-intraday-json/);
});
test('退出播报：偏见冲突导致方向重置时不宣称保留方向', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /directionReset \? '已重置为暂无交易方向' : '保留方向'/);
});
