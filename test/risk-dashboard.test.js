import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RISK_MANAGER_SCHEMA_VERSION } from '../src/risk-manager/migration.js';
import { STORAGE_KEY } from '../src/risk-manager/storage/local-storage-adapter.js';
import { createAccount } from '../src/risk-manager/account-service.js';
import { addBalanceUpdate, deriveDecision, deriveCurrentBalance, undoLastBalanceUpdate } from '../src/risk-manager/session-service.js';

test('risk dashboard: 复用 V2 账户、余额更新、撤销与风险重算', () => {
  let state = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
  state = createAccount(state, {
    name: 'LFF05073435950005', propFirm: 'Demo', accountType: '50K', nominalAccountSize: 50000,
    riskReferenceBalance: 50000, hardLossAmount: 2000, drawdownType: 'NONE', defaultHardLossFloor: null, initialBalance: 50000
  });
  const id = state.selectedAccountId;
  let decision = deriveDecision(state.accounts[0]);
  assert.equal(decision.status, 'ALLOWED'); assert.equal(decision.allowedR, 100); assert.equal(decision.baseR, 100);
  state = addBalanceUpdate(state, id, 49850); decision = deriveDecision(state.accounts[0]);
  assert.equal(deriveCurrentBalance(state.accounts[0].currentSession), 49850); assert.equal(decision.allowedR, 100);
  state = undoLastBalanceUpdate(state, id); decision = deriveDecision(state.accounts[0]);
  assert.equal(deriveCurrentBalance(state.accounts[0].currentSession), 50000); assert.equal(decision.allowedR, 100);
});

test('risk dashboard: 首页保留真实存储键与指定操作入口', () => {
  const source = readFileSync(new URL('../src/risk-dashboard.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(STORAGE_KEY, 'trading-risk-manager:v1');
  assert.match(source, /saveAppState\(riskDashboardState, riskDashboardStorage\)/);
  assert.match(source, /addBalanceUpdate\(riskDashboardState, account\.id/);
  assert.match(source, /undoLastBalanceUpdate\(riskDashboardState, account\.id\)/);
  assert.match(source, /更新余额/); assert.match(source, /撤销上一条余额更新/); assert.match(source, /编辑账户/); assert.match(source, /查看全部/);
  assert.match(html, /id="risk-dashboard-host"/);
});

test('risk dashboard: 窄屏空账户始终可通过下拉创建首个账户，且初始化失败不阻断状态卡', () => {
  const source = readFileSync(new URL('../src/risk-dashboard.js', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /const placeholder = new Option\('选择账户', '', !account, !account\);[\s\S]*?placeholder\.disabled = true/);
  assert.match(source, /picker\.value === '__add__'/);
  assert.match(source, /picker\.value = riskDashboardState\.selectedAccountId \|\| ''/);
  assert.match(app, /try \{ initRiskDashboard\(document\.querySelector\('#risk-dashboard-host'\)\); \} catch \(error\)/);
  assert.match(app, /GC \/ CL \/ ES 状态卡仍可正常使用/);
});
