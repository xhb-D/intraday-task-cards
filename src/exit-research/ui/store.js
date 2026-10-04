import { createResearchStore, assertResearchStore } from '../manual-matches.js';
export const RESEARCH_UI_KEY = 'exit-research:v1';
const workbenchStoreKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
export function createWorkbenchStore() {
  return { app: 'exit-research', ...createResearchStore(), preferences: { setup: 'ALL', family: 'ALL', quality: 'ALL', selectedOpportunityId: null }, settings: { tradeOverrides: {} } };
}
export function validateWorkbenchStore(store) {
  const bad = () => { throw new Error('INVALID_RESEARCH_UI_STORE'); };
  if (!workbenchStoreKeys(store, ['app','schemaVersion','sequence','manualDecisions','preferences','settings']) || store.app !== 'exit-research') bad();
  assertResearchStore(store);
  // Keep frozen decision validation while denying extra persisted payloads.
  for (const d of store.manualDecisions) if (!workbenchStoreKeys(d, ['id','sequence','action','opportunityId','logicalTradeId','executionFingerprint','recordedAt'])) bad();
  const p = store.preferences;
  if (!workbenchStoreKeys(p, ['setup','family','quality','selectedOpportunityId']) || !['ALL','PB','BOF','BOF_TO_PB'].includes(p.setup) || !['ALL','GC','CL','ES'].includes(p.family) || !['ALL','READY','REVIEW_REQUIRED','BLOCKED'].includes(p.quality) || !(p.selectedOpportunityId === null || typeof p.selectedOpportunityId === 'string' && p.selectedOpportunityId.trim())) bad();
  if (!workbenchStoreKeys(store.settings, ['tradeOverrides']) || !store.settings.tradeOverrides || typeof store.settings.tradeOverrides !== 'object' || Array.isArray(store.settings.tradeOverrides)) bad();
  for (const [id, v] of Object.entries(store.settings.tradeOverrides)) {
    if (!id.trim() || ['__proto__','constructor','prototype'].includes(id) || !workbenchStoreKeys(v, ['replayHardEndAt','executionTickSize']) || !(v.replayHardEndAt === null || Number.isSafeInteger(v.replayHardEndAt) && v.replayHardEndAt >= 0 && v.replayHardEndAt < Date.UTC(10000,0,1)) || !(v.executionTickSize === null || Number.isFinite(v.executionTickSize) && v.executionTickSize > 0)) bad();
  }
  return true;
}
export function parseWorkbenchStore(raw) {
  if (typeof raw !== 'string' || raw.length > 8 * 1024 * 1024) throw new Error('RESEARCH_STORE_SIZE_INVALID');
  const store = JSON.parse(raw); validateWorkbenchStore(store); return structuredClone(store);
}
export function serializeWorkbenchStore(store) { validateWorkbenchStore(store); return JSON.stringify(store, null, 2); }
