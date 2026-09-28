import { copy, createWorkspace } from '../../../src/model.js';
import { makeEnvelope } from '../../../src/persistence.js';
import { makeUnified } from '../../../src/unified-persistence.js';

const T0 = 1_735_689_600_000;
const T1 = T0 + 60_000;
const T2 = T1 + 60_000;
const T3 = T2 + 60_000;
const T4 = T3 + 60_000;

const card = symbol => ({ symbol, bias: 'neutral', structure3m: 'unjudged', needsStructureReview: false, direction: 'none', opportunity: null, idleSince: T0 });
const stage = (state, start, end = null) => ({ state, start, end });

function legacyActiveOpportunity() {
  return {
    id: 'op-legacy-gc', symbol: 'GC', direction: 'long', type: 'pullback',
    zone: '50,000–50,010', zoneDraft: '50,000–50,010', zoneConfirmedAt: T3,
    createdAt: T2, registeredAt: T3, biasAtRegistration: 'bullish', structure3mAtRegistration: 'bullish',
    invalidReason: null, enteredAt: T4, endedAt: null, reason: null, attention: 'wait', stageSince: T4,
    stages: [stage('wait', T3, T4), stage('position', T4)]
  };
}

function legacyEndedRecord() {
  return {
    id: 'op-legacy-cl', symbol: 'CL', direction: 'short', type: 'reversal',
    zone: '74.20–74.30', createdAt: T0, registeredAt: T1, zoneConfirmedAt: T1,
    biasAtRegistration: 'bearish', structure3mAtRegistration: 'bearish', invalidReason: null,
    enteredAt: null, endedAt: T2, reason: 'invalid', attention: 'wait', stageSince: T1,
    stages: [stage('wait', T1, T2)]
  };
}

function legacyState() {
  const cards = Object.fromEntries(['GC', 'CL', 'ES'].map(symbol => [symbol, card(symbol)]));
  const opportunity = legacyActiveOpportunity();
  cards.GC.bias = 'bullish'; cards.GC.structure3m = 'bullish'; cards.GC.direction = 'long'; cards.GC.opportunity = opportunity;
  cards.CL.bias = 'bearish'; cards.CL.structure3m = 'bearish'; cards.CL.direction = 'short';
  return { schemaVersion: 3, sequence: 1, revision: 4, lastSavedAt: T3, cards, records: [{ ...copy(opportunity), zoneDraft: undefined }, legacyEndedRecord()] };
}

function cleanRecord(opportunity) {
  const record = copy(opportunity); delete record.zoneDraft; return record;
}

function legacyStateWithActiveRecord() {
  const state = legacyState(); state.records[0] = cleanRecord(state.cards.GC.opportunity); return state;
}

function intradayV3() {
  return { app: 'intraday-task-cards', schemaVersion: 3, savedAt: T3, timezone: 'Asia/Shanghai', state: legacyStateWithActiveRecord() };
}

function standalone(version) {
  const value = intradayV3(); value.schemaVersion = version; value.state.schemaVersion = version; return value;
}

function riskV1() {
  return {
    schemaVersion: 1, selectedAccountId: 'acct-demo-v1', accounts: [{
      id: 'acct-demo-v1', name: 'Demo Legacy', propFirm: '', accountType: 'Simulation', nominalAccountSize: 50000,
      configuredRiskBaseCapital: 50000, drawdownType: 'NONE', defaultHardLossFloor: null, previousSession: null,
      currentSession: { id: 'sess-demo-v1', startedAt: '2025-01-01T00:00:00.000Z', previousEodBalance: 51100, sessionStartBalance: 51100, sessionRiskBaseCapital: 50000, hardLossFloor: null,
        balanceEvents: [{ id: 'evt-demo-v1-1', timestamp: '2025-01-01T01:00:00.000Z', previousBalance: 51100, newBalance: 50850, delta: -250 }] }
    }]
  };
}

function riskV2() {
  const snapshot = { version: 2, sessionRiskReferenceBalance: 50000, sessionHardLossAmount: 2000, lowR: 100, midR: 150, highR: 200, baseUpgradeCushion: 1200, baseUpgradeThreshold: 51200, baseR: 100 };
  const first = { id: 'acct-demo-v2-a', name: 'Demo Alpha', propFirm: 'Simulation', accountType: 'Practice', nominalAccountSize: 50000, riskReferenceBalance: 50000, hardLossAmount: 2000, drawdownType: 'NONE', defaultHardLossFloor: null,
    previousSession: { id: 'sess-demo-v2-previous', endedAt: '2025-01-01T00:30:00.000Z', endBalance: 50020, peakRealizedBalance: 50050, peakRealizedProfit: 50 },
    currentSession: { id: 'sess-demo-v2-a', startedAt: '2025-01-01T01:00:00.000Z', previousEodBalance: 50020, sessionStartBalance: 50020, riskSnapshot: snapshot, hardLossFloor: null, balanceEvents: [
      { id: 'evt-demo-v2-a1', timestamp: '2025-01-01T01:10:00.000Z', previousBalance: 50020, newBalance: 50070, delta: 50 },
      { id: 'evt-demo-v2-a2', timestamp: '2025-01-01T01:20:00.000Z', previousBalance: 50070, newBalance: 50040, delta: -30 }
    ] }
  };
  const second = copy(first); second.id = 'acct-demo-v2-b'; second.name = 'Demo Beta'; second.currentSession.id = 'sess-demo-v2-b'; second.currentSession.balanceEvents = []; second.previousSession = null;
  return { schemaVersion: 2, selectedAccountId: first.id, accounts: [first, second] };
}

const emptyIntraday = makeEnvelope(createWorkspace(T0), T0);
const emptyRisk = { schemaVersion: 2, selectedAccountId: null, accounts: [] };
const unifiedEmpty = makeUnified(emptyIntraday, emptyRisk, { appearance: 'system' });
unifiedEmpty.savedAt = T0;
const unifiedComplete = makeUnified();
unifiedComplete.sections.intraday = intradayV3();
unifiedComplete.sections.riskManager = riskV2();
unifiedComplete.preferences.appearance = 'dark';
unifiedComplete.savedAt = T4;

export const goldenFixtures = Object.freeze({
  'intraday-v1-active': { value: standalone(1), expectedSchemaVersion: null, sections: [], summary: '旧独立日内状态卡 V1：明确拒绝，不迁移。' },
  'intraday-v2-near': { value: standalone(2), expectedSchemaVersion: null, sections: [], summary: '旧独立日内状态卡 V2：明确拒绝，不迁移。' },
  'intraday-v3-holding': { value: intradayV3(), expectedSchemaVersion: null, sections: [], summary: '旧独立日内状态卡 V3：明确拒绝；仅统一存档内允许确定性迁移。' },
  'risk-v1-legacy': { value: riskV1(), expectedSchemaVersion: 2, sections: ['riskManager'], summary: '旧快照冻结，最大亏损额度保持 null。' },
  'risk-v2-multi-history': { value: riskV2(), expectedSchemaVersion: 2, sections: ['riskManager'], summary: '多账户、余额事件及 previousSession 往返。' },
  'unified-v1-empty': { value: unifiedEmpty, expectedSchemaVersion: 1, sections: ['intraday', 'riskManager', 'preferences'], summary: '空白统一工作区。' },
  'unified-v1-active': { value: unifiedComplete, expectedSchemaVersion: 1, sections: ['intraday', 'riskManager', 'preferences'], summary: '统一 V3 日内活动机会、旧历史与多账户外观偏好。' },
  'invalid-corrupt-json': { value: '{not-json', expectedSchemaVersion: null, sections: [], summary: '损坏 JSON。' },
  'invalid-future-version': { value: { app: 'trading-control-center', schemaVersion: 99, sections: {} }, expectedSchemaVersion: null, sections: [], summary: '未知未来版本。' },
  'invalid-ambiguous': { value: { app: 'intraday-task-cards', schemaVersion: 2, state: {}, accounts: [], selectedAccountId: null }, expectedSchemaVersion: null, sections: [], summary: '伪装为风险格式的旧独立状态卡：优先明确拒绝。' }
});

export const fixtureTimes = Object.freeze({ T0, T1, T2, T3, T4 });
