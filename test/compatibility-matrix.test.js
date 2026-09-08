import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertState, copy } from '../src/model.js';
import { deserialize, makeEnvelope, validateEnvelope } from '../src/persistence.js';
import { migrateState } from '../src/risk-manager/migration.js';
import { deriveDecision } from '../src/risk-manager/session-service.js';
import { validateImport as validateLegacyRiskImport } from '../src/risk-manager/backup-service.js';
import { applyRoute, normalizeRoute, parseRoute } from '../src/router.js';
import { LEGACY_INTRADAY_KEY, LEGACY_RISK_KEY, PRE_IMPORT_KEY, UNIFIED_KEY, classifyBackup, commitUnified, loadUnified, makeUnified, normalizeImport, parseBackupRaw, validateRisk, validateUnified } from '../src/unified-persistence.js';
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

test('C01 两个旧键均存在：迁移到统一 key 且旧字节不变', () => {
  const intraday = raw(goldenFixtures['intraday-v3-holding'].value); const risk = raw(goldenFixtures['risk-v2-multi-history'].value);
  const s = store({ [LEGACY_INTRADAY_KEY]: intraday, [LEGACY_RISK_KEY]: risk }); const loaded = loadUnified(s);
  assert.equal(loaded.source, 'legacy'); const saved = commitUnified(s, loaded.state); assert.deepEqual(JSON.parse(s.getItem(UNIFIED_KEY)), saved); assert.equal(s.getItem(LEGACY_INTRADAY_KEY), intraday); assert.equal(s.getItem(LEGACY_RISK_KEY), risk);
  assert.equal(loaded.state.sections.riskManager.accounts.length, 2);
});
test('C02 仅旧状态卡键：风险域为空且不虚构账户', () => {
  const s = store({ [LEGACY_INTRADAY_KEY]: raw(goldenFixtures['intraday-v3-holding'].value) }); const loaded = loadUnified(s);
  assert.equal(loaded.source, 'legacy'); assert.deepEqual(loaded.state.sections.riskManager.accounts, []);
});
test('C03 仅旧风险键：创建合法空白 GC/CL/ES', () => {
  const s = store({ [LEGACY_RISK_KEY]: raw(goldenFixtures['risk-v2-multi-history'].value) }); const loaded = loadUnified(s);
  assert.deepEqual(Object.keys(loaded.state.sections.intraday.state.cards), ['GC', 'CL', 'ES']); assert.equal(loaded.state.sections.riskManager.accounts.length, 2);
});
test('C04 canonical 优先：不重新吸收旧键', () => {
  const canonical = unifiedActive(); const s = store({ [UNIFIED_KEY]: raw(canonical), [LEGACY_RISK_KEY]: raw({ schemaVersion: 2, selectedAccountId: 'missing', accounts: [] }) });
  const loaded = loadUnified(s); assert.equal(loaded.source, 'canonical'); assert.deepEqual(loaded.state, canonical);
});
test('C05 较新的旧键仅提示：不自动覆盖 canonical', () => {
  const canonical = unifiedActive(); canonical.savedAt = 1; const newer = clone(goldenFixtures['intraday-v3-holding'].value); newer.savedAt = 2;
  const s = store({ [UNIFIED_KEY]: raw(canonical), [LEGACY_INTRADAY_KEY]: raw(newer) }); const loaded = loadUnified(s);
  assert.equal(loaded.source, 'canonical'); assert.match(loaded.notice, /时间更新的旧状态卡存档/); assert.equal(loaded.state.savedAt, 1);
});
test('C06 状态卡 schema 1：迁移到 3 并要求旧活动机会结构审查', () => {
  const migrated = deserialize(raw(goldenFixtures['intraday-v1-active'].value));
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.state.schemaVersion, 3); assert.equal(migrated.state.cards.GC.needsStructureReview, true);
});
test('C07 状态卡 schema 2：near 映射为 wait 且阶段合并', () => {
  const migrated = deserialize(raw(goldenFixtures['intraday-v2-near'].value)); const opportunity = migrated.state.cards.GC.opportunity;
  assert.equal(opportunity.attention, 'wait'); assert.deepEqual(opportunity.stages, [{ state: 'wait', start: 1735689720000, end: null }]);
});
test('C08 状态卡 schema 3：状态、记录、草稿与计时往返相等', () => {
  const fixture = goldenFixtures['intraday-v3-holding'].value; assert.deepEqual(deserialize(raw(fixture)), fixture);
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
test('C12 旧状态卡分项导入：仅 intraday 改变', () => {
  const current = unifiedActive(); const result = normalizeImport(goldenFixtures['intraday-v3-holding'].value, current).state;
  assert.deepEqual(result.sections.riskManager, current.sections.riskManager); assert.deepEqual(result.preferences, current.preferences);
});
test('C13 旧风险分项导入：仅 riskManager 改变', () => {
  const current = unifiedActive(); const result = normalizeImport(goldenFixtures['risk-v2-multi-history'].value, current).state;
  assert.deepEqual(result.sections.intraday, current.sections.intraday); assert.deepEqual(result.preferences, current.preferences);
});
test('C14 状态卡分项导出：旧状态卡验证器可读取', () => {
  const exported = unifiedActive().sections.intraday; validateEnvelope(exported); assert.deepEqual(deserialize(raw(exported)), exported);
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
test('C20 多类格式匹配：拒绝并提示格式歧义', () => { assert.throws(() => classifyBackup(goldenFixtures['invalid-ambiguous'].value), /歧义/); });
test('C21 重复账户、会话、事件 ID：拒绝并返回字段路径', () => {
  for (const mutate of [state => { state.accounts[1].id = state.accounts[0].id; }, state => { state.accounts[1].currentSession.id = state.accounts[0].currentSession.id; }, state => { state.accounts[0].currentSession.balanceEvents[1].id = state.accounts[0].currentSession.balanceEvents[0].id; }]) {
    const invalid = riskV2(); mutate(invalid); assert.throws(() => validateRisk(invalid), error => Boolean(error.path));
  }
});
test('C22 余额事件链断裂：拒绝且不静默修补', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[1].previousBalance = 1; assert.throws(() => validateRisk(invalid), error => /链断裂/.test(error.message) && /previousBalance/.test(error.path)); });
test('C23 事件 delta 错误：拒绝且不静默重算', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[1].delta = 0; assert.throws(() => validateRisk(invalid), error => /delta/.test(error.path)); });
test('C24 非法时间戳：拒绝并定位字段', () => { const invalid = riskV2(); invalid.accounts[0].currentSession.balanceEvents[0].timestamp = 'tomorrow'; assert.throws(() => validateRisk(invalid), error => /timestamp/.test(error.path)); });
test('C25 活动机会与记录身份不一致：assertState 拒绝', () => { const state = deserialize(raw(goldenFixtures['intraday-v3-holding'].value)).state; state.records[0].id = 'different-id'; assert.throws(() => assertState(state), /活动记录不一致/); });
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
test('C34 Safari file:// 降级：无 storage 仍有空白工作区，JSON 可解析', () => { assert.equal(loadUnified(null).source, 'storage-unavailable'); assert.deepEqual(parseBackupRaw(raw(goldenFixtures['intraday-v3-holding'].value)).app, 'intraday-task-cards'); });
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
test('C38 发布前静态目标：旧站点保持只读跳转，线上验证待发布授权', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8'); assert.match(html, /href="#\/home"/); assert.doesNotMatch(html, /LEGACY_INTRADAY_KEY|LEGACY_RISK_KEY/);
});
