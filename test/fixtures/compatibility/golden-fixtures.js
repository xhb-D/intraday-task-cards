import { copy, createWorkspace, changeBias, changeDirection, changeStructure, chooseSetup, confirmPosition, markEntered, updateDraft } from '../../../src/model.js';
import { makeEnvelope } from '../../../src/persistence.js';
import { makeUnified } from '../../../src/unified-persistence.js';

const T0 = 1735689600000;
const T1 = T0 + 60_000;
const T2 = T1 + 60_000;
const T3 = T2 + 60_000;

function activeWorkspace() {
  const state = createWorkspace(T0);
  changeBias(state, 'GC', 'bullish');
  changeStructure(state, 'GC', 'bullish', T1);
  changeDirection(state, 'GC', 'long', T1);
  chooseSetup(state, 'GC', 'pullback', T2);
  updateDraft(state, 'GC', '50,000–50,010');
  confirmPosition(state, 'GC', T3);
  state.cards.GC.opportunity.id = 'op-demo-gc';
  state.records[0].id = 'op-demo-gc';
  return state;
}

function intradayV1() {
  const state = activeWorkspace();
  state.schemaVersion = 1;
  for (const card of Object.values(state.cards)) {
    delete card.bias; delete card.structure3m; delete card.needsStructureReview;
    if (card.opportunity) {
      delete card.opportunity.biasAtRegistration;
      delete card.opportunity.structure3mAtRegistration;
      delete card.opportunity.invalidReason;
    }
  }
  for (const record of state.records) {
    delete record.biasAtRegistration;
    delete record.structure3mAtRegistration;
    delete record.invalidReason;
  }
  return { app: 'intraday-task-cards', schemaVersion: 1, savedAt: T3, timezone: 'Asia/Shanghai', state };
}

function intradayV2() {
  const state = activeWorkspace();
  state.schemaVersion = 2;
  state.cards.GC.opportunity.attention = 'near';
  state.cards.GC.opportunity.stages = [{ state: 'wait', start: T2, end: T3 }, { state: 'near', start: T3, end: null }];
  state.cards.GC.opportunity.stageSince = T3;
  state.records[0] = copy(state.cards.GC.opportunity);
  delete state.records[0].zoneDraft;
  state.records[0].attention = 'near';
  state.records[0].stages = [{ state: 'wait', start: T2, end: T3 }, { state: 'near', start: T3, end: null }];
  return { app: 'intraday-task-cards', schemaVersion: 2, savedAt: T3, timezone: 'Asia/Shanghai', state };
}

function intradayV3() {
  const state = activeWorkspace();
  markEntered(state, 'GC', T3 + 1, true);
  return makeEnvelope(state, T3 + 1);
}

function riskV1() {
  return {
    schemaVersion: 1,
    selectedAccountId: 'acct-demo-v1',
    accounts: [{
      id: 'acct-demo-v1', name: 'Demo Legacy', propFirm: '', accountType: 'Simulation', nominalAccountSize: 50000,
      configuredRiskBaseCapital: 50000, drawdownType: 'NONE', defaultHardLossFloor: null, previousSession: null,
      currentSession: {
        id: 'sess-demo-v1', startedAt: '2025-01-01T00:00:00.000Z', previousEodBalance: 51100, sessionStartBalance: 51100,
        sessionRiskBaseCapital: 50000, hardLossFloor: null,
        balanceEvents: [{ id: 'evt-demo-v1-1', timestamp: '2025-01-01T01:00:00.000Z', previousBalance: 51100, newBalance: 50850, delta: -250 }],
      },
    }],
  };
}

function riskV2() {
  const snapshot = { version: 2, sessionRiskReferenceBalance: 50000, sessionHardLossAmount: 2000, lowR: 100, midR: 150, highR: 200, baseUpgradeCushion: 1200, baseUpgradeThreshold: 51200, baseR: 100 };
  const first = {
    id: 'acct-demo-v2-a', name: 'Demo Alpha', propFirm: 'Simulation', accountType: 'Practice', nominalAccountSize: 50000,
    riskReferenceBalance: 50000, hardLossAmount: 2000, drawdownType: 'NONE', defaultHardLossFloor: null,
    previousSession: { id: 'sess-demo-v2-previous', endedAt: '2025-01-01T00:30:00.000Z', endBalance: 50020, peakRealizedBalance: 50050, peakRealizedProfit: 50 },
    currentSession: { id: 'sess-demo-v2-a', startedAt: '2025-01-01T01:00:00.000Z', previousEodBalance: 50020, sessionStartBalance: 50020, riskSnapshot: snapshot, hardLossFloor: null, balanceEvents: [
      { id: 'evt-demo-v2-a1', timestamp: '2025-01-01T01:10:00.000Z', previousBalance: 50020, newBalance: 50070, delta: 50 },
      { id: 'evt-demo-v2-a2', timestamp: '2025-01-01T01:20:00.000Z', previousBalance: 50070, newBalance: 50040, delta: -30 },
    ] },
  };
  const second = copy(first);
  second.id = 'acct-demo-v2-b'; second.name = 'Demo Beta'; second.currentSession.id = 'sess-demo-v2-b'; second.currentSession.balanceEvents = [];
  second.previousSession = null;
  return { schemaVersion: 2, selectedAccountId: first.id, accounts: [first, second] };
}

const emptyIntraday = makeEnvelope(createWorkspace(T0), T0);
const emptyRisk = { schemaVersion: 2, selectedAccountId: null, accounts: [] };
const unifiedEmpty = makeUnified(emptyIntraday, emptyRisk, { appearance: 'system' });
unifiedEmpty.savedAt = T0;
const unifiedComplete = makeUnified(intradayV3(), riskV2(), { appearance: 'dark' });
unifiedComplete.savedAt = T3 + 1;

export const goldenFixtures = Object.freeze({
  'intraday-v1-active': { value: intradayV1(), expectedSchemaVersion: 3, sections: ['intraday'], summary: '旧活动机会迁移后待结构审查。' },
  'intraday-v2-near': { value: intradayV2(), expectedSchemaVersion: 3, sections: ['intraday'], summary: 'near 确定性映射为 wait 并合并阶段。' },
  'intraday-v3-holding': { value: intradayV3(), expectedSchemaVersion: 3, sections: ['intraday'], summary: '已登记且持仓中的 V3 状态往返。' },
  'risk-v1-legacy': { value: riskV1(), expectedSchemaVersion: 2, sections: ['riskManager'], summary: '旧快照冻结，最大亏损额度保持 null。' },
  'risk-v2-multi-history': { value: riskV2(), expectedSchemaVersion: 2, sections: ['riskManager'], summary: '多账户、余额事件及 previousSession 往返。' },
  'unified-v1-empty': { value: unifiedEmpty, expectedSchemaVersion: 1, sections: ['intraday', 'riskManager', 'preferences'], summary: '空白统一工作区。' },
  'unified-v1-active': { value: unifiedComplete, expectedSchemaVersion: 1, sections: ['intraday', 'riskManager', 'preferences'], summary: '完整活动状态、多账户与外观偏好。' },
  'invalid-corrupt-json': { value: '{not-json', expectedSchemaVersion: null, sections: [], summary: '损坏 JSON。' },
  'invalid-future-version': { value: { app: 'trading-control-center', schemaVersion: 99, sections: {} }, expectedSchemaVersion: null, sections: [], summary: '未知未来版本。' },
  'invalid-ambiguous': { value: { app: 'intraday-task-cards', schemaVersion: 2, state: {}, accounts: [], selectedAccountId: null }, expectedSchemaVersion: null, sections: [], summary: '多类格式匹配。' },
});

export const fixtureTimes = Object.freeze({ T0, T1, T2, T3 });
