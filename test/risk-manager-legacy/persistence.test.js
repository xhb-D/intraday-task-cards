// Trading Risk Manager V2 — service, persistence, migration & backup tests.
// Uses injected storage so it runs in browser AND Node (mock).
//
// V2 account concepts:
//   riskReferenceBalance — Base upgrade reference; next-session only.
//   hardLossAmount       — R scaling base; next-session only, nullable.
//   hardLossFloor        — external BALANCE LINE; immediate effect.

import * as AccountService from '../../src/risk-manager/account-service.js';
import * as SessionService from '../../src/risk-manager/session-service.js';
import * as BackupService from '../../src/risk-manager/backup-service.js';
import * as Storage from '../../src/risk-manager/storage/local-storage-adapter.js';
import { migrateState, RISK_MANAGER_SCHEMA_VERSION as SCHEMA_VERSION } from '../../src/risk-manager/migration.js';
import * as engine from '../../src/risk-manager/risk-engine.js';
import { createSuite } from './harness.js';

function mockStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

const emptyState = { schemaVersion: SCHEMA_VERSION, selectedAccountId: null, accounts: [] };

function makeAccount(state, overrides = {}) {
  return AccountService.createAccount(state, {
    name: 'Test Acct',
    propFirm: 'Firm',
    accountType: 'Eval',
    nominalAccountSize: 50000,
    riskReferenceBalance: 50000,
    hardLossAmount: 2000,
    drawdownType: 'NONE',
    defaultHardLossFloor: null,
    initialBalance: 51400,
    ...overrides,
  });
}

export function runPersistenceTests() {
  const s = createSuite('persistence');

  // ============ E. V2 config semantics: next-session only ============

  s.test('E1 — risk config changes are next-session only: snapshot untouched', () => {
    let state = makeAccount(emptyState);
    const acct = state.accounts[0];
    state = AccountService.updateAccountMeta(state, acct.id, { riskReferenceBalance: 100000, hardLossAmount: 3000 });
    const a = state.accounts[0];
    s.assertEq(a.riskReferenceBalance, 100000);
    s.assertEq(a.hardLossAmount, 3000);
    const snap = a.currentSession.riskSnapshot;
    s.assertEq(snap.sessionRiskReferenceBalance, 50000, 'session snapshot reference frozen');
    s.assertEq(snap.sessionHardLossAmount, 2000, 'session snapshot hard loss frozen');
    s.assertEq(snap.lowR, 100, 'session Low R frozen');
    s.assertEq(snap.midR, 150, 'session Mid R frozen');
    s.assertEq(snap.highR, 200, 'session High R frozen');
  });

  s.test('E2 — lowering config never recomputes the active session', () => {
    let state = makeAccount(emptyState, { riskReferenceBalance: 100000, hardLossAmount: 4000, initialBalance: 105000 });
    const id = state.accounts[0].id;
    s.assertEq(state.accounts[0].currentSession.riskSnapshot.lowR, 200);
    state = AccountService.updateAccountMeta(state, id, { riskReferenceBalance: 50000, hardLossAmount: 2000 });
    s.assertEq(state.accounts[0].currentSession.riskSnapshot.lowR, 200, 'active session tiers unchanged by lowering');
    const d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.lowR, 200);
  });

  // ============ Account service ============

  s.test('ACCT — create account builds initial session with V2 snapshot', () => {
    const state = makeAccount(emptyState);
    s.assertEq(state.accounts.length, 1);
    const a = state.accounts[0];
    s.assertEq(a.riskReferenceBalance, 50000);
    s.assertEq(a.hardLossAmount, 2000);
    s.assertEq(a.currentSession.sessionStartBalance, 51400);
    s.assertEq(a.currentSession.previousEodBalance, 51400);
    s.assertEq(a.currentSession.balanceEvents.length, 0);
    const snap = a.currentSession.riskSnapshot;
    s.assertEq(snap.version, 2);
    s.assertEq(snap.lowR, 100);
    s.assertEq(snap.midR, 150);
    s.assertEq(snap.highR, 200);
    s.assertEq(snap.baseUpgradeThreshold, 51200);
    s.assertEq(snap.baseR, 150);
    s.assertEq(state.selectedAccountId, a.id, 'first account auto-selected');
  });

  s.test('ACCT — create account validates required fields', () => {
    let threw = false;
    try {
      AccountService.createAccount(emptyState, { name: '', riskReferenceBalance: 50000, hardLossAmount: 2000 });
    } catch (e) { threw = true; }
    s.assert(threw, 'empty name must throw');
    threw = false;
    try {
      AccountService.createAccount(emptyState, { name: 'X', riskReferenceBalance: -1, hardLossAmount: 2000 });
    } catch (e) { threw = true; }
    s.assert(threw, 'negative risk reference must throw');
    threw = false;
    try {
      AccountService.createAccount(emptyState, { name: 'X', riskReferenceBalance: 50000, hardLossAmount: 0 });
    } catch (e) { threw = true; }
    s.assert(threw, 'missing hard loss amount must throw on create');
  });

  s.test('ACCT — updateAccountMeta: hardLossAmount may be cleared (next-session)', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = AccountService.updateAccountMeta(state, id, { hardLossAmount: null });
    s.assertEq(state.accounts[0].hardLossAmount, null);
    s.assertEq(state.accounts[0].currentSession.riskSnapshot.sessionHardLossAmount, 2000, 'session snapshot untouched');
    let threw = false;
    try {
      AccountService.updateAccountMeta(state, id, { hardLossAmount: -5 });
    } catch (e) { threw = true; }
    s.assert(threw, 'negative hard loss must throw');
  });

  s.test('ACCT — delete account and selection fallback', () => {
    let state = makeAccount(emptyState);
    const id1 = state.accounts[0].id;
    state = makeAccount(state, { name: 'Second' });
    const id2 = state.accounts[1].id;
    state = AccountService.deleteAccount(state, id1);
    s.assertEq(state.accounts.length, 1);
    s.assertEq(state.selectedAccountId, id2, 'selection falls back to remaining account');
    state = AccountService.deleteAccount(state, id2);
    s.assertEq(state.accounts.length, 0);
    s.assertEq(state.selectedAccountId, null);
  });

  // ============ Session service / balance events ============

  s.test('SESS — balance update appends event with correct previous/delta', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 51620);
    const evt = state.accounts[0].currentSession.balanceEvents[0];
    s.assertEq(evt.previousBalance, 51400);
    s.assertEq(evt.newBalance, 51620);
    s.assertEq(evt.delta, 220);
    s.assertEq(SessionService.deriveCurrentBalance(state.accounts[0].currentSession), 51620);
  });

  s.test('SESS — balance update rejects invalid values', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    for (const bad of [NaN, -100, 'abc', undefined, 0]) {
      let threw = false;
      try { state = SessionService.addBalanceUpdate(state, id, bad); } catch (e) { threw = true; }
      s.assert(threw, `value ${bad} must be rejected`);
      s.assertEq(state.accounts[0].currentSession.balanceEvents.length, 0, 'no event appended on rejection');
    }
  });

  s.test('F — undo/replay rederives peak, profit lock and floors', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 51800); // Event 1
    state = SessionService.addBalanceUpdate(state, id, 51650); // Event 2
    let d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.currentRealizedBalance, 51650);
    s.assertEq(d.peakRealizedBalance, 51800, 'peak before undo');

    state = SessionService.undoLastBalanceUpdate(state, id); // Undo Event 2
    d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.currentRealizedBalance, 51800);
    s.assertEq(d.peakRealizedBalance, 51800);

    state = SessionService.undoLastBalanceUpdate(state, id); // Undo Event 1
    d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.currentRealizedBalance, 51400);
    s.assertEq(d.peakRealizedBalance, 51400);
    s.assertEq(d.peakRealizedProfit, 0);
    s.assertEq(d.profitLockActive, false, 'no stale lock after undo');

    const st2 = SessionService.undoLastBalanceUpdate(state, id); // no-op on empty
    s.assertEq(st2.accounts[0].currentSession.balanceEvents.length, 0);
  });

  s.test('F2 — undo can legitimately deactivate profit lock', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 51700); // +300 => lock ON
    let d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.profitLockActive, true);
    state = SessionService.undoLastBalanceUpdate(state, id);
    d = engine.calculateRiskDecision(SessionService.deriveEngineInput(state.accounts[0]));
    s.assertEq(d.profitLockActive, false, 'lock reverts after undoing the peak event');
  });

  s.test('SESS — new session: previous EOD from current balance, fresh history', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 52000);
    state = SessionService.startNewSession(state, id, { startBalance: 52000 });
    const a = state.accounts[0];
    s.assertEq(a.currentSession.previousEodBalance, 52000);
    s.assertEq(a.currentSession.sessionStartBalance, 52000);
    s.assertEq(a.currentSession.balanceEvents.length, 0);
    const snap = a.currentSession.riskSnapshot;
    s.assertEq(snap.version, 2);
    s.assertEq(snap.sessionRiskReferenceBalance, 50000);
    s.assertEq(snap.sessionHardLossAmount, 2000);
  });

  s.test('SESS — startNewSession applies pending configured changes (next-session)', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = AccountService.updateAccountMeta(state, id, { riskReferenceBalance: 100000, hardLossAmount: 3000 });
    state = SessionService.startNewSession(state, id, { startBalance: 51400 });
    const snap = state.accounts[0].currentSession.riskSnapshot;
    s.assertEq(snap.sessionRiskReferenceBalance, 100000, 'new reference applies at next session');
    s.assertEq(snap.sessionHardLossAmount, 3000, 'new hard loss applies at next session');
    s.assertEq(snap.lowR, 150);
    s.assertEq(snap.midR, 225);
    s.assertEq(snap.highR, 300);
  });

  s.test('SESS — new session blocked without configured Hard Loss Amount', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = AccountService.updateAccountMeta(state, id, { hardLossAmount: null });
    let threw = false;
    try {
      state = SessionService.startNewSession(state, id, { startBalance: 51400 });
    } catch (e) {
      threw = true;
      s.assertEq(e.message, '请先设置最大亏损额度。');
    }
    s.assert(threw, 'must reject new session without hardLossAmount');
    s.assertEq(state.accounts[0].currentSession.balanceEvents.length, 0);
  });

  // ============ Hard Loss Floor rules ============

  s.test('DD — EOD_TRAILING floor is session-frozen', () => {
    let state = makeAccount(emptyState, { drawdownType: 'EOD_TRAILING', defaultHardLossFloor: 50000 });
    const id = state.accounts[0].id;
    s.assertEq(state.accounts[0].currentSession.hardLossFloor, 50000);
    let threw = false;
    try { state = SessionService.updateHardLossFloor(state, id, 49500); } catch (e) { threw = true; }
    s.assert(threw, 'EOD floor must not change mid-session');
    s.assertEq(state.accounts[0].currentSession.hardLossFloor, 50000, 'floor unchanged');
  });

  s.test('DD — INTRADAY_TRAILING floor updateable mid-session (immediate)', () => {
    let state = makeAccount(emptyState, { drawdownType: 'INTRADAY_TRAILING', defaultHardLossFloor: 50000 });
    const id = state.accounts[0].id;
    state = SessionService.updateHardLossFloor(state, id, 49500);
    s.assertEq(state.accounts[0].currentSession.hardLossFloor, 49500);
  });

  s.test('DD — STATIC floor editable (immediate)', () => {
    let state = makeAccount(emptyState, { drawdownType: 'STATIC', defaultHardLossFloor: 50000 });
    const id = state.accounts[0].id;
    state = SessionService.updateHardLossFloor(state, id, 49000);
    s.assertEq(state.accounts[0].currentSession.hardLossFloor, 49000);
  });

  s.test('DD — NONE persists null floor', () => {
    let state = makeAccount(emptyState, { drawdownType: 'NONE' });
    s.assertEq(state.accounts[0].currentSession.hardLossFloor, null);
  });

  // ============ Migration ============

  function buildV1State() {
    return {
      schemaVersion: 1,
      selectedAccountId: 'acct_1',
      accounts: [
        {
          id: 'acct_1',
          name: 'Legacy',
          propFirm: '',
          accountType: '',
          nominalAccountSize: 50000,
          configuredRiskBaseCapital: 50000,
          drawdownType: 'NONE',
          defaultHardLossFloor: null,
          previousSession: null,
          currentSession: {
            id: 'sess_1',
            startedAt: '2026-08-10T00:00:00.000Z',
            previousEodBalance: 51100,
            sessionStartBalance: 51100,
            sessionRiskBaseCapital: 50000,
            hardLossFloor: null,
            balanceEvents: [
              { id: 'evt_1', timestamp: '2026-08-11T00:00:00.000Z', previousBalance: 51100, newBalance: 51200, delta: 100 },
              { id: 'evt_2', timestamp: '2026-08-11T01:00:00.000Z', previousBalance: 51200, newBalance: 50850, delta: -350 },
            ],
          },
        },
      ],
    };
  }

  s.test('MIG — account migration: riskReferenceBalance preserved, hardLossAmount null', () => {
    const migrated = migrateState(buildV1State());
    s.assertEq(migrated.schemaVersion, 2);
    const a = migrated.accounts[0];
    s.assertEq(a.riskReferenceBalance, 50000, 'configuredRiskBaseCapital preserved');
    s.assertEq(a.hardLossAmount, null, 'never guessed');
    s.assertEq(a.configuredRiskBaseCapital, undefined, 'old field removed');
    s.assertEq(a.nominalAccountSize, 50000);
  });

  s.test('MIG — active V1 session: snapshot frozen legacy, everything else untouched', () => {
    const migrated = migrateState(buildV1State());
    const session = migrated.accounts[0].currentSession;
    s.assertEq(session.previousEodBalance, 51100);
    s.assertEq(session.sessionStartBalance, 51100);
    s.assertEq(session.balanceEvents.length, 2);
    s.assertEq(session.hardLossFloor, null);
    const snap = session.riskSnapshot;
    s.assertEq(snap.version, 1);
    s.assertEq(snap.sessionRiskBaseCapital, 50000);
    s.assertEq(snap.lowR, 100);
    s.assertEq(snap.midR, 150);
    s.assertEq(snap.highR, 200);
    s.assertEq(snap.baseUpgradeThreshold, 51200);
    s.assertEq(snap.baseR, 100);
    const d = engine.calculateRiskDecision(SessionService.deriveEngineInput(migrated.accounts[0]));
    s.assertEq(d.currentRealizedBalance, 50850);
    s.assertEq(d.peakRealizedBalance, 51200);
    s.assertEq(d.peakRealizedProfit, 100);
    s.assertEq(d.dailyCapitalFloor, 50800);
    s.assertEq(d.availableRisk, 50);
    s.assertEq(d.status, 'TAIL_RISK', 'Final Risk applies to migrated session');
    s.assertEq(d.finalRisk, 50);
  });

  s.test('MIG — migrateState passes v2 through untouched', () => {
    const state = makeAccount(emptyState);
    const migrated = migrateState(state);
    s.assertEq(migrated, state);
    s.assertEq(migrated.schemaVersion, 2);
  });

  // ============ Storage adapter ============

  s.test('STORAGE — save/load round trip (schemaVersion 2)', () => {
    const storage = mockStorage();
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 51620);
    Storage.saveAppState(state, storage, 'test:key');
    const loaded = Storage.loadAppState(storage, 'test:key');
    s.assertEq(loaded.schemaVersion, 2);
    s.assertEq(loaded.accounts.length, 1);
    s.assertEq(loaded.accounts[0].currentSession.balanceEvents.length, 1);
    s.assertEq(loaded.accounts[0].currentSession.balanceEvents[0].newBalance, 51620);
  });

  s.test('STORAGE — corrupt JSON recovers to null (no invented state)', () => {
    const storage = mockStorage();
    storage.setItem('test:key', '{corrupt!!');
    const loaded = Storage.loadAppState(storage, 'test:key');
    s.assertEq(loaded, null, 'corrupt storage must not fabricate accounts');
  });

  s.test('STORAGE — clear removes the key', () => {
    const storage = mockStorage();
    Storage.saveAppState(emptyState, storage, 'test:key');
    Storage.clearAppState(storage, 'test:key');
    s.assertEq(Storage.loadAppState(storage, 'test:key'), null);
  });

  // ============ Backup ============

  s.test('BK — export/import round trip preserves state (v2)', () => {
    let state = makeAccount(emptyState);
    const id = state.accounts[0].id;
    state = SessionService.addBalanceUpdate(state, id, 51700);
    const raw = BackupService.exportAppState(state);
    const parsed = JSON.parse(raw);
    s.assertEq(parsed.schemaVersion, 2);
    s.assertEq(parsed.accounts[0].hardLossAmount, 2000);
    const res = BackupService.validateImport(raw);
    s.assertEq(res.ok, true);
    s.assertEq(res.state.accounts[0].currentSession.balanceEvents[0].newBalance, 51700);
  });

  s.test('BK — V1 JSON import auto-migrates and preserves data', () => {
    const raw = JSON.stringify(buildV1State());
    const res = BackupService.validateImport(raw);
    s.assertEq(res.ok, true, res.error || '');
    s.assertEq(res.state.schemaVersion, 2);
    const a = res.state.accounts[0];
    s.assertEq(a.riskReferenceBalance, 50000);
    s.assertEq(a.hardLossAmount, null);
    s.assertEq(a.currentSession.balanceEvents.length, 2);
    s.assertEq(a.currentSession.balanceEvents[1].newBalance, 50850);
  });

  s.test('BK — invalid JSON rejected, current state untouched', () => {
    const res = BackupService.validateImport('{not json');
    s.assertEq(res.ok, false);
    s.assert(res.error && res.error.length > 0, 'has error message');
  });

  s.test('BK — unsupported schemaVersion rejected', () => {
    const res = BackupService.validateImport(JSON.stringify({ schemaVersion: 99, accounts: [] }));
    s.assertEq(res.ok, false);
  });

  s.test('BK — structurally invalid account rejected', () => {
    const bad = JSON.stringify({ schemaVersion: 2, selectedAccountId: null, accounts: [{ id: 'a', name: '' }] });
    const res = BackupService.validateImport(bad);
    s.assertEq(res.ok, false);
  });

  s.test('BK — export filename pattern', () => {
    const name = BackupService.buildExportFilename(new Date('2026-08-11T20:30:00+08:00'));
    s.assert(/^trading-risk-manager-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(name), `bad filename: ${name}`);
  });

  return s.results;
}
