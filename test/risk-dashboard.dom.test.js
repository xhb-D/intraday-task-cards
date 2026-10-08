import test from 'node:test';
import assert from 'node:assert/strict';
import { initRiskDashboard } from '../src/risk-dashboard.js';
import { initRiskManagerView } from '../src/risk-manager-view.js';
import { createAccount } from '../src/risk-manager/account-service.js';
import { addBalanceUpdate } from '../src/risk-manager/session-service.js';
import { makeUnified, commitUnified, loadUnified, UNIFIED_KEY } from '../src/capture-unified.js';
import { makeEnvelope } from '../src/capture-persistence.js';
import { pair, T } from './fixtures/intraday-v6.js';
import { RISK_MANAGER_SCHEMA_VERSION } from '../src/risk-manager/migration.js';

import { FakeElement, FakeOption, byText, byButtonText, byName, byClass, all, renderedText } from '../scripts/qa-fixtures/risk-dom.js';

test('risk dashboard DOM: 点击表单确认会真实创建、更新、撤销、编辑，并保留无效表单', () => {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, Option: globalThis.Option };
  const body = new FakeElement('body'); const document = { body, createElement: tag => new FakeElement(tag) };
  const records = new Map(); const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)) };
  globalThis.document = document; globalThis.window = { addEventListener() {} }; globalThis.localStorage = localStorage; globalThis.Option = FakeOption;
  try {
    let state = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
    const host = new FakeElement('div'); body.appendChild(host); initRiskDashboard(host, { getState: () => state, commit: next => { state = next; }, isLocked: () => false });
    byText(host, '添加账户').click();
    byName(body, 'name').value = 'DEMO-ACCOUNT-001'; byName(body, 'nominal').value = '50000'; byName(body, 'reference').value = '50000'; byName(body, 'hardLoss').value = '2000'; byName(body, 'floor').value = '49400'; byName(body, 'initial').value = '50000';
    byButtonText(body, '添加账户').click();
    assert.ok(byClass(host, 'risk-account-card')); assert.ok(byClass(host, 'selected')); assert.equal(byText(host, '更新余额').disabled, false);
    const mobileAccount = byClass(host, 'risk-mobile-account');
    assert.ok(mobileAccount, '窄屏渲染账户与风险摘要卡');
    assert.equal(byClass(mobileAccount, 'risk-mobile-picker').value, state.selectedAccountId, '窄屏账户选择器保持当前账户');
    assert.match(renderedText(byClass(mobileAccount, 'risk-mobile-details')), /\$50,000\.00可以交易 · \$100\.00EOD 日终跟踪回撤/, '余额、1R 与回撤类型位于同一窄屏摘要卡');

    byText(host, '更新余额').click(); byName(body, 'balance').value = '50100'; byText(body, '确认更新').click();
    assert.ok(byText(host, '$50,100.00')); assert.equal(byText(host, '撤销上一条余额更新').disabled, false);

    byText(host, '撤销上一条余额更新').click(); byText(body, '确认撤销').click();
    assert.ok(byText(host, '$50,000.00')); assert.equal(byText(host, '撤销上一条余额更新').disabled, true);

    byText(host, '编辑账户').click(); byName(body, 'name').value = 'DEMO-ACCOUNT-001-EDITED'; byText(body, '保存账户').click();
    assert.ok(byText(host, 'DEMO-ACCOUNT-001-EDITED'));

    byText(host, '编辑账户').click(); byName(body, 'nominal').value = '0'; byText(body, '保存账户').click();
    assert.match(byClass(body, 'risk-form-error').textContent, /名义账户规模必须是正数/);
    assert.ok(byText(body, '保存账户'));
    byText(body, '取消').click();
  } finally {
    globalThis.document = prior.document; globalThis.window = prior.window; globalThis.localStorage = prior.localStorage; globalThis.Option = prior.Option;
  }
});

test('risk manager DOM: 完整页不重复首页摘要，限制 Floor、V1 编辑和全局 rollover 重入', () => {
  const prior = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage, Option: globalThis.Option };
  const body = new FakeElement('body'); const document = { body, createElement: tag => new FakeElement(tag) };
  globalThis.document = document; globalThis.window = { addEventListener() {} }; globalThis.Option = FakeOption;
  try {
    const base = { schemaVersion: RISK_MANAGER_SCHEMA_VERSION, selectedAccountId: null, accounts: [] };
    let state = createAccount(base, {
      name: 'EOD', nominalAccountSize: 50000, riskReferenceBalance: 50000,
      hardLossAmount: 2000, drawdownType: 'EOD_TRAILING', defaultHardLossFloor: 49000, initialBalance: 50000,
    });
    let commits = 0;
    const host = new FakeElement('div'); body.appendChild(host);
    initRiskManagerView(host, { getState: () => state, commit: next => { commits += 1; state = next; }, isLocked: () => false });
    assert.equal(byClass(host, 'risk-summary'), null, '完整页不渲染首页摘要');
    assert.equal(all(host, node => node.className.split(/\s+/).includes('decision-card')).length, 1, '完整页只有一个风险决策卡');
    assert.equal(byButtonText(host, 'Hard Loss Floor'), null, 'EOD trailing 不提供盘中 Floor 编辑');

    byText(host, '添加账户').click(); byText(host, '添加账户').click();
    assert.equal(all(body, node => node.tagName === 'dialog').length, 1, '重复打开不会叠加模态框');
    byText(body, '取消').click();

    byText(host, '编辑账户').click();
    const hardLoss = byName(body, 'hardLoss');
    assert.equal(hardLoss.required, false, 'V1 或历史账户允许清空下一时段最大亏损额度');
    hardLoss.value = '';
    byText(body, '保存账户').click();
    assert.equal(state.accounts[0].hardLossAmount, null, '空值保存为下一时段未设置，而不是 NaN');

    state = createAccount(base, {
      name: 'Tail', nominalAccountSize: 50000, riskReferenceBalance: 50000,
      hardLossAmount: 2000, drawdownType: 'INTRADAY_TRAILING', defaultHardLossFloor: 49000, initialBalance: 50000,
    });
    state = addBalanceUpdate(state, state.selectedAccountId, 49750);
    initRiskManagerView(host, { getState: () => state, commit: next => { commits += 1; state = next; }, isLocked: () => false });
    assert.ok(byButtonText(host, 'Hard Loss Floor'), '盘中 trailing 提供 Floor 编辑');
    assert.match(renderedText(byClass(host, 'tail-warning')), /当前可用风险低于 Low R/);
    assert.match(renderedText(byClass(host, 'decision-reason')), /剩余风险低于 Low R/);

    byText(host, '结束当前并开始新交易日').click();
    const confirm = byText(body, '确认开始新交易日');
    const beforeRollover = commits;
    confirm.click(); confirm.click();
    assert.equal(commits, beforeRollover + 1, '重复确认只能提交一次全局 rollover');
  } finally {
    globalThis.document = prior.document; globalThis.window = prior.window; globalThis.localStorage = prior.localStorage; globalThis.Option = prior.Option;
  }
});


test('Home layout relocated Risk mount: account creation/editing, balance events, selection, rail and reload use only the same Unified Risk section', () => {
  const prior = { document: globalThis.document, window: globalThis.window, Option: globalThis.Option };
  const body=new FakeElement('body'),home=new FakeElement('section'),history=new FakeElement('details'),host=new FakeElement('div');
  host.id='risk-dashboard-host';home.append(history,host);body.appendChild(home);
  globalThis.document={body,createElement:tag=>new FakeElement(tag)};globalThis.window={addEventListener(){}};globalThis.Option=FakeOption;
  try {
    const {state}=pair();let unified=makeUnified(makeEnvelope(state,T+100)),data=new Map([[UNIFIED_KEY,JSON.stringify(unified)]]),written=[];
    const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{written.push(k);data.set(k,String(v));}};
    const before=structuredClone(unified),controller={getState:()=>unified.sections.riskManager,isLocked:()=>false,commit:next=>{
      const candidate=structuredClone(unified);candidate.sections.riskManager=next;
      unified=commitUnified(storage,candidate,{expectedRaw:JSON.stringify(unified)});
    }};
    const view=initRiskDashboard(host,controller);assert.equal(home.children.indexOf(host),home.children.indexOf(history)+1);
    function add(name){byText(host,'添加账户').click();for(const [field,value] of Object.entries({name,nominal:'50000',reference:'50000',hardLoss:'2000',initial:'50000'}))byName(body,field).value=value;
      byName(body,'drawdown').value='NONE';byButtonText(body,'添加账户').click();}
    add('SYNTHETIC-A');add('SYNTHETIC-B');assert.equal(unified.sections.riskManager.accounts.length,2);
    const a=unified.sections.riskManager.accounts[0],b=unified.sections.riskManager.accounts[1],aId=a.id;
    byText(host,'更新余额').click();byName(body,'balance').value='50100';byText(body,'确认更新').click();
    assert.equal(unified.sections.riskManager.accounts[0].currentSession.balanceEvents.length,1);assert.equal(unified.sections.riskManager.accounts[0].currentSession.balanceEvents[0].newBalance,50100);
    byText(host,'撤销上一条余额更新').click();byText(body,'确认撤销').click();assert.equal(unified.sections.riskManager.accounts[0].currentSession.balanceEvents.length,0);
    byText(host,'编辑账户').click();byName(body,'name').value='SYNTHETIC-A-EDITED';byText(body,'保存账户').click();assert.equal(unified.sections.riskManager.accounts[0].id,aId);assert.equal(unified.sections.riskManager.accounts[0].name,'SYNTHETIC-A-EDITED');
    const picker=byClass(host,'risk-mobile-picker');picker.value=b.id;picker.dispatch('change');assert.equal(unified.sections.riskManager.selectedAccountId,b.id);
    const scroll=[];byClass(host,'risk-rail').scrollBy=options=>scroll.push(options);byButtonText(host,'›').click();byButtonText(host,'‹').click();assert.deepEqual(scroll.map(o=>o.left),[300,-300]);
    assert.equal(unified.sections.riskManager.accounts.length,2);assert.equal(unified.sections.riskManager.accounts[0].id,aId);
    assert.deepEqual(unified.sections.intraday,before.sections.intraday);assert.deepEqual(unified.sections.chime,before.sections.chime);assert.deepEqual(unified.preferences,before.preferences);
    assert.ok(written.length>0&&written.every(k=>k===UNIFIED_KEY));assert.equal(unified.schemaVersion,2);
    const reloaded=loadUnified(storage).state;assert.deepEqual(reloaded.sections,unified.sections);assert.deepEqual(reloaded.preferences,unified.preferences);view.destroy();
  } finally {globalThis.document=prior.document;globalThis.window=prior.window;globalThis.Option=prior.Option;}
});
