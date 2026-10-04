import { parseTradovateFillsCsv, parseTradovateOrdersCsv, parseTradovatePositionHistoryCsv } from '../tradovate-csv.js';
import { validateMarketDataBundle } from '../market-data.js';
import { applyManualMatch, applyManualReject } from '../manual-matches.js';
import { parseTradovateTime } from '../time.js';
import { epochMillis } from '../research-common.js';
import { RESEARCH_UI_KEY, createWorkbenchStore, parseWorkbenchStore, serializeWorkbenchStore, validateWorkbenchStore } from './store.js';
import { buildWorkbenchModel } from './view-model.js';
import { renderWorkbench } from './render.js';
import { buildMarketRequestExport, downloadResearchJson } from './export.js';
export function createWorkbenchController({getIntraday, storage, onChange = () => {}}) {
  let store = createWorkbenchStore(), raw = null, storeError = '', files = {fills:[],orders:[],positions:[],bundle:null}, flatConfirmed = false;
  function loadStore() {
    try { raw = storage?.getItem(RESEARCH_UI_KEY) ?? null; store = raw === null ? createWorkbenchStore() : parseWorkbenchStore(raw); storeError = ''; }
    catch (e) { storeError = 'RESEARCH_STORE_UNAVAILABLE_OR_INVALID'; }
  }
  loadStore();
  function persist(next, explicitImport = false) {
    validateWorkbenchStore(next);
    if (storeError && !explicitImport) throw new Error(storeError);
    if (!storage?.setItem || !storage?.getItem) throw new Error('RESEARCH_STORAGE_UNAVAILABLE');
    if (storage.getItem(RESEARCH_UI_KEY) !== raw) { storeError='RESEARCH_STORE_CHANGED';throw new Error(storeError); }
    const serialized = serializeWorkbenchStore(next); storage.setItem(RESEARCH_UI_KEY, serialized);
    if (storage.getItem(RESEARCH_UI_KEY) !== serialized) throw new Error('RESEARCH_STORE_WRITE_FAILED');
    store = structuredClone(next); raw = serialized; storeError = ''; onChange();
  }
  const snapshot = () => ({ ...buildWorkbenchModel({intraday:getIntraday(),files,flatConfirmed,store}), storeError });
  return {
    get store() { return structuredClone(store); }, snapshot,
    importFile(kind, text) {
      if (typeof text !== 'string' || new TextEncoder().encode(text).length > 8*1024*1024) throw new Error('RESEARCH_FILE_TOO_LARGE');
      let value;
      if (kind === 'bundle') { value = JSON.parse(text); const validation = validateMarketDataBundle(value); if (!validation.valid) throw new Error(validation.qualityReasons.join(', ')); }
      else { const parser = {fills:parseTradovateFillsCsv,orders:parseTradovateOrdersCsv,positions:parseTradovatePositionHistoryCsv}[kind]; if (!parser) throw new Error('RESEARCH_FILE_KIND_INVALID'); value = parser(text).rows; }
      const nextFiles={...files,[kind]:value}, nextFlat=kind==='fills'?false:flatConfirmed;
      buildWorkbenchModel({intraday:getIntraday(),files:nextFiles,flatConfirmed:nextFlat,store});
      files=nextFiles;flatConfirmed=nextFlat;onChange();
    },
    confirmFlat(value) { if(typeof value!=='boolean')throw new Error('FLAT_CONFIRMATION_INVALID');buildWorkbenchModel({intraday:getIntraday(),files,flatConfirmed:value,store});flatConfirmed=value;onChange(); },
    select(id) { const next=structuredClone(store);next.preferences.selectedOpportunityId=id;persist(next); },
    filters(patch) {const next=structuredClone(store);Object.assign(next.preferences,patch);next.preferences.selectedOpportunityId=null;persist(next);},
    setReplaySettings(id, settings) {const next=structuredClone(store);next.settings.tradeOverrides[id]=structuredClone(settings);persist(next);},
    decide(action, opportunityId, logicalTradeId) {
      const m=snapshot(), t=m.logicalTrades.find(t=>t.logicalTradeId===logicalTradeId), record=m.trades.find(r=>r.opportunityId===opportunityId);
      if(!t || !record || !['confirm','reject'].includes(action))throw new Error('MANUAL_CANDIDATE_UNAVAILABLE');
      const next=(action==='confirm'?applyManualMatch:applyManualReject)(store,opportunityId,t,Date.now());persist(next);
    },
    exportStore: () => serializeWorkbenchStore(store),
    importStore(text) {persist(parseWorkbenchStore(text),true);},
    reloadStore() {loadStore();onChange();}
  };
}
export function parseResearchHardEnd(value) {
  if(!value.trim())return null;
  const parsed=parseTradovateTime(value.trim(),0,'Replay Hard End');return epochMillis(parsed);
}
export function initExitResearchWorkbench(host, {getIntraday,storage}) {
  let message='', pendingStore=null, active=false, controller;
  const importGenerations = new Map();
  const paint=()=>{
    if(!active)return;
    try { host.innerHTML=renderWorkbench({...controller.snapshot(),message,pendingStore:pendingStore?{sequence:pendingStore.sequence}:null}); }
    catch (e) {host.innerHTML='<p class="er-feedback" role="alert">研究数据暂不可用。首页状态卡不受影响，请检查输入。</p>';}
  };
  controller=createWorkbenchController({getIntraday,storage,onChange:paint});
  const feedback=e=>{message='处理未完成：'+(e.code||e.message||'RESEARCH_INPUT_ERROR');paint();};
  host.addEventListener('change',async event=>{
    const el=event.target;
    const kind=el.dataset.erFile, generation=kind?(importGenerations.get(kind)||0)+1:null;
    if(kind)importGenerations.set(kind,generation);
    try {
      message='';
      if(el.dataset.erFile){ const file=el.files?.[0];if(!file)return;if(file.size>8*1024*1024)throw new Error('RESEARCH_FILE_TOO_LARGE');el.disabled=true;const text=await file.text();
        if(importGenerations.get(kind)!==generation)return;
        if(kind==='store'){pendingStore=parseWorkbenchStore(text);paint();}else {controller.importFile(kind,text);message='已在本地内存解析；未写入 Task Card。';paint();} }
      else if(el.dataset.erFlat!==undefined)controller.confirmFlat(el.checked);
      else if(el.dataset.erFilter)controller.filters({[el.dataset.erFilter]:el.value});
    }catch(e){if(!kind||importGenerations.get(kind)===generation)feedback(e);}
    finally{if(el.dataset.erFile){el.disabled=false;el.value='';}}
  });
  host.addEventListener('click',event=>{
    const el=event.target.closest('[data-er-action]');if(!el)return;
    try{
      message='';const action=el.dataset.erAction;
      if(action==='select')controller.select(el.dataset.opportunity);
      else if(action==='confirm'||action==='reject'){ const t=controller.snapshot().trades.find(t=>t.opportunityId===el.dataset.opportunity); const candidate=t?.candidates[Number(el.dataset.candidate)]; controller.decide(action,el.dataset.opportunity,candidate?.logicalTradeId||t?.logicalTradeId); }
      else if(action==='store-export')downloadResearchJson(controller.store,'Exit_Research_Store_V1.json');
      else if(action==='request-export'){const request=buildMarketRequestExport(controller.snapshot());if(!request.trades.length)throw new Error('MATCHED_RESEARCH_TRADE_REQUIRED');downloadResearchJson(request,'Exit_Research_Market_Request.json');}
      else if(action==='store-confirm'){if(!pendingStore)throw new Error('RESEARCH_IMPORT_NOT_PREVIEWED');controller.importStore(serializeWorkbenchStore(pendingStore));pendingStore=null;message='Research Store 已恢复；Task Card 未修改。';paint();}
      else if(action==='store-cancel'){pendingStore=null;paint();}
      else if(action==='store-reload'){controller.reloadStore();}
    }catch(e){feedback(e);}
  });
  host.addEventListener('submit',event=>{
    if(!event.target.matches('[data-er-settings]'))return;event.preventDefault();
    try{const form=event.target,m=controller.snapshot(),id=m.selected?.opportunityId;if(!id)return;
      const end=parseResearchHardEnd(form.elements.hardEnd.value),tick=form.elements.tick.value.trim()?Number(form.elements.tick.value):null;
      if(end!==null&&(!(end>m.selected.actualEntryTime)||m.selected.actualEntryTime===null))throw new Error('REPLAY_HARD_END_INVALID');
      controller.setReplaySettings(id,{replayHardEndAt:end,executionTickSize:tick});message='本次交易研究设置已保存。';paint();
    }catch(e){feedback(e);}
  });
  return {refresh(){active=true;paint();},hide(){active=false;},controller};
}
