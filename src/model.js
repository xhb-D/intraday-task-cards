export const ORDER = Object.freeze(['GC', 'CL', 'ES']);
export const SCHEMA_VERSION = 4;
export const LEGACY_SCHEMA_VERSION = 3;
export const BIASES = Object.freeze({ bullish: '偏多', neutral: '无偏见', bearish: '偏空' });
export const STRUCTURES_3M = Object.freeze({ unjudged: '未判断', bullish: '多头', range: '震荡（观察拍卖完成）', bearish: '空头' });
export const VISIBLE_STRUCTURES_3M = Object.freeze({ bullish: '多头', range: '震荡（观察拍卖完成）', bearish: '空头' });
export const DIRECTIONS = Object.freeze({ long: '做多', short: '做空', none: '暂无交易方向' });
export const SETUPS = Object.freeze({ mtf_pb: 'MTF PB', htf_pb: 'HTF PB', htf_bof: 'HTF BOF' });
export const LEGACY_SETUPS = Object.freeze({ pullback: '趋势回调', range: '区间反转', reversal: '趋势反转' });
export const SETUP_LABELS = Object.freeze({ ...LEGACY_SETUPS, ...SETUPS });
export const STAGES = Object.freeze({ none: '无机会', wait: '等待', signal: '找信号', position: '持仓' });
export const RESULTS = Object.freeze({ invalid: '失效', canceled: '已取消', direction: '方向改变结束', closed: '已平仓', rules_upgrade: '规则升级结束' });
export const ATTENTION = Object.freeze(['wait', 'signal']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const stateError = (message, path) => Object.assign(new Error(message), { code: 'STATE_VALIDATION_ERROR', path });
const storedStage = stage => ATTENTION.includes(stage) || stage === 'position';
const safeTime = value => Number.isSafeInteger(value) && value >= 0;
const validSetup = type => own(SETUPS, type) || own(LEGACY_SETUPS, type);
const newSetup = type => own(SETUPS, type);
const legacySetup = type => own(LEGACY_SETUPS, type);

export const copy = value => JSON.parse(JSON.stringify(value));
export const stateOf = card => !card.opportunity ? 'none' : card.opportunity.enteredAt === null ? card.opportunity.attention : 'position';
export const hasRecord = (state, opportunity) => Boolean(opportunity && state.records.some(record => record.id === opportunity.id));
export const setupLabel = type => SETUP_LABELS[type] || type;

// Bias is descriptive context only. Every valid bias permits every direction.
export const isDirectionAllowed = (bias, direction) => own(BIASES, bias) && own(DIRECTIONS, direction);
export const isSetupAllowed = (direction, structure3m, type) => own(DIRECTIONS, direction) && own(STRUCTURES_3M, structure3m) && newSetup(type) && direction !== 'none' && structure3m !== 'unjudged';
export const holdingConflictWarning = () => '';
export const recordSnapshot = opportunity => { const { zoneDraft, ...record } = opportunity; return copy(record); };

export function createWorkspace(time = Date.now()) {
  const cards = Object.fromEntries(ORDER.map(symbol => [symbol, {
    symbol, bias: 'neutral', structure3m: 'unjudged', needsStructureReview: false,
    direction: 'none', opportunity: null, idleSince: time
  }]));
  return { schemaVersion: SCHEMA_VERSION, sequence: 0, revision: 0, lastSavedAt: null, cards, records: [], migrationAudit: [] };
}

function cardFor(state, symbol) { if (!ORDER.includes(symbol)) throw new Error('未知品种'); return state.cards[symbol]; }
function opportunityFor(card) { if (!card.opportunity) throw new Error('当前没有机会'); return card.opportunity; }
function touch(state) { state.revision += 1; return state; }
function syncRecord(state, opportunity) { const index = state.records.findIndex(record => record.id === opportunity.id); if (index >= 0) state.records[index] = recordSnapshot(opportunity); }
function nextId(state, time) { state.sequence += 1; return `op-${state.sequence}-${time.toString(36)}`; }
function transition(state, opportunity, stage, time) {
  const current = opportunity.stages.at(-1); if (current.state === stage) return false;
  current.end = time; opportunity.stageSince = time;
  if (stage === 'position') opportunity.enteredAt = time; else opportunity.attention = stage;
  opportunity.stages.push({ state: stage, start: time, end: null }); syncRecord(state, opportunity); return true;
}
function closeOpportunity(state, card, reason, time, migrationReason = null) {
  const opportunity = opportunityFor(card);
  if (!own(RESULTS, reason) || (reason === 'closed' && opportunity.enteredAt === null) || (reason !== 'closed' && reason !== 'rules_upgrade' && opportunity.enteredAt !== null)) throw new Error('非法结束机会');
  opportunity.stages.at(-1).end = time; opportunity.endedAt = time; opportunity.reason = reason;
  if (reason === 'rules_upgrade') opportunity.migrationReason = migrationReason;
  syncRecord(state, opportunity); card.opportunity = null; card.idleSince = time;
}

export function changeBias(state, symbol, bias, time = Date.now()) {
  if (!own(BIASES, bias)) throw new Error('偏见无效');
  const card = cardFor(state, symbol); if (card.bias === bias) return { changed: false, reason: 'same' };
  card.bias = bias; touch(state); assertState(state); return { changed: true };
}

export function changeDirection(state, symbol, direction, time = Date.now(), confirmed = false) {
  if (!own(DIRECTIONS, direction)) throw new Error('交易方向无效');
  const card = cardFor(state, symbol);
  if (stateOf(card) === 'position') return { changed: false, reason: 'holding' };
  if (card.direction === direction) return { changed: false, reason: 'same' };
  if (card.opportunity && !confirmed) return { changed: false, needsConfirmation: true };
  if (card.opportunity) closeOpportunity(state, card, 'direction', time);
  card.direction = direction; touch(state); assertState(state); return { changed: true };
}

export function changeStructure(state, symbol, structure3m, time = Date.now()) {
  if (!own(STRUCTURES_3M, structure3m)) throw new Error('市场结构无效');
  const card = cardFor(state, symbol); if (card.structure3m === structure3m && !card.needsStructureReview) return { changed: false, reason: 'same' };
  card.structure3m = structure3m; card.needsStructureReview = false;
  touch(state); assertState(state); return { changed: true };
}

export function chooseSetup(state, symbol, type, time = Date.now()) {
  if (!newSetup(type)) throw new Error('机会类型无效');
  const card = cardFor(state, symbol);
  if (card.needsStructureReview || !isSetupAllowed(card.direction, card.structure3m, type) || stateOf(card) === 'position' || card.opportunity?.type === type) return { changed: false };
  if (card.opportunity) closeOpportunity(state, card, 'canceled', time);
  const opportunity = {
    id: nextId(state, time), symbol, direction: card.direction, type,
    zone: null, createdAt: time, registeredAt: time,
    biasAtRegistration: card.bias, structure3mAtRegistration: card.structure3m,
    invalidReason: null, migrationReason: null,
    enteredAt: null, endedAt: null, reason: null, attention: 'wait', stageSince: time,
    stages: [{ state: 'wait', start: time, end: null }]
  };
  card.opportunity = opportunity; state.records.push(recordSnapshot(opportunity));
  touch(state); assertState(state); return { changed: true, opportunity: card.opportunity };
}

export function setStage(state, symbol, stage, time = Date.now()) {
  if (!ATTENTION.includes(stage)) throw new Error('注意力状态无效');
  const card = cardFor(state, symbol);
  if (!card.opportunity || card.needsStructureReview || stateOf(card) === 'position' || stateOf(card) === stage) return false;
  transition(state, card.opportunity, stage, time); touch(state); assertState(state); return true;
}

export function markEntered(state, symbol, time = Date.now(), confirmed = false) {
  const card = cardFor(state, symbol);
  if (!card.opportunity || card.needsStructureReview || !ATTENTION.includes(stateOf(card))) return { changed: false };
  if (!confirmed) return { changed: false, needsConfirmation: true };
  transition(state, card.opportunity, 'position', time); touch(state); assertState(state); return { changed: true };
}

export function endOpportunity(state, symbol, reason, time = Date.now()) {
  if (!['invalid', 'canceled'].includes(reason)) throw new Error('结束原因无效');
  const card = cardFor(state, symbol);
  if (!card.opportunity || stateOf(card) === 'position') return false;
  closeOpportunity(state, card, reason, time); touch(state); assertState(state); return true;
}

export function markExited(state, symbol, time = Date.now(), confirmed = false) {
  const card = cardFor(state, symbol);
  if (stateOf(card) !== 'position') return { changed: false };
  if (!confirmed) return { changed: false, needsConfirmation: true };
  closeOpportunity(state, card, 'closed', time);
  touch(state); assertState(state); return { changed: true, directionReset: false };
}

export function deleteRecord(state, id) { const index = state.records.findIndex(record => record.id === id); if (index < 0) return false; state.records.splice(index, 1); touch(state); assertState(state); return true; }

export function recordProgress(record) { return record.endedAt !== null ? RESULTS[record.reason] : record.enteredAt !== null ? '持仓中' : '已登记'; }
export function instruction(card) {
  const status = stateOf(card);
  if (status === 'none') return card.direction === 'none' ? ['先确认偏见、交易方向与市场结构', '不找入场'] : card.structure3m === 'unjudged' ? ['先确认市场结构', '不找入场'] : ['等具体机会', '不找入场'];
  if (status === 'wait') return ['等既定条件成熟', '不提前入场'];
  if (status === 'signal') return ['按既定规则找入场信号', '不临时更换入场理由'];
  return ['只管理当前持仓', '本卡不找新入场'];
}

export function assertState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !Array.isArray(state.records) || !Array.isArray(state.migrationAudit) || !Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.revision)) throw stateError('状态结构无效', 'state');
  const active = new Map(); const ids = new Set();
  for (const symbol of ORDER) {
    const card = state.cards?.[symbol];
    if (!card || card.symbol !== symbol || !own(BIASES, card.bias) || !own(STRUCTURES_3M, card.structure3m) || card.needsStructureReview !== false || !own(DIRECTIONS, card.direction) || !safeTime(card.idleSince)) throw stateError('卡片结构无效', `cards.${symbol}`);
    const opportunity = card.opportunity; if (!opportunity) continue;
    const holding = stateOf(card) === 'position';
    if (typeof opportunity.id !== 'string' || opportunity.id.trim() === '' || card.direction === 'none' || opportunity.symbol !== symbol || opportunity.direction !== card.direction || !newSetup(opportunity.type) || !ATTENTION.includes(opportunity.attention) || opportunity.endedAt !== null || opportunity.reason !== null || active.has(opportunity.id)) throw stateError('活动机会无效', `cards.${symbol}.opportunity`);
    if (opportunity.zone !== null || !safeTime(opportunity.createdAt) || !safeTime(opportunity.registeredAt) || opportunity.registeredAt < opportunity.createdAt || !own(BIASES, opportunity.biasAtRegistration) || !own(STRUCTURES_3M, opportunity.structure3mAtRegistration) || opportunity.structure3mAtRegistration === 'unjudged' || opportunity.invalidReason !== null || opportunity.migrationReason !== null) throw stateError('活动机会字段无效', `cards.${symbol}.opportunity`);
    if ((opportunity.enteredAt !== null && !safeTime(opportunity.enteredAt)) || !Array.isArray(opportunity.stages) || !opportunity.stages.length) throw stateError('活动机会时间字段无效', `cards.${symbol}.opportunity`);
    const last = assertTimeline(opportunity, `cards.${symbol}.opportunity`, true);
    if (last.start !== opportunity.stageSince || last.state !== stateOf(card) || (opportunity.enteredAt !== null) !== holding) throw stateError('阶段状态无效', `cards.${symbol}.opportunity.stages`);
    active.set(opportunity.id, opportunity);
  }
  for (const [index, record] of state.records.entries()) {
    const path = `records.${index}`;
    if (!record || typeof record.id !== 'string' || record.id.trim() === '' || ids.has(record.id) || Object.hasOwn(record, 'zoneDraft') || !ORDER.includes(record.symbol) || !validSetup(record.type) || !['long', 'short'].includes(record.direction) || !own(BIASES, record.biasAtRegistration) || !own(STRUCTURES_3M, record.structure3mAtRegistration) || !safeTime(record.createdAt) || !safeTime(record.registeredAt) || !safeTime(record.stageSince) || !Array.isArray(record.stages) || !record.stages.length) throw stateError('记录无效', path);
    if (newSetup(record.type) ? record.zone !== null : typeof record.zone !== 'string' || !record.zone.trim()) throw stateError('记录关键位置字段无效', `${path}.zone`);
    if (!['wait', 'signal'].includes(record.attention) || (record.enteredAt !== null && !safeTime(record.enteredAt)) || (record.endedAt !== null && !safeTime(record.endedAt))) throw stateError('记录时间或阶段无效', path);
    if (record.invalidReason !== null && !['structure_change', 'bias_change'].includes(record.invalidReason)) throw stateError('失效原因无效', `${path}.invalidReason`);
    if (record.migrationReason !== null && record.migrationReason !== 'opportunity_taxonomy_upgrade') throw stateError('迁移原因无效', `${path}.migrationReason`);
    ids.add(record.id);
    const last = assertTimeline(record, path, record.endedAt === null);
    if (last.start !== record.stageSince || last.state !== (record.enteredAt === null ? record.attention : 'position')) throw stateError('记录阶段状态无效', `${path}.stages`);
    if (record.endedAt === null) { const current = active.get(record.id); if (!current || JSON.stringify(recordSnapshot(current)) !== JSON.stringify(record)) throw stateError('活动记录不一致', path); }
    else if (active.has(record.id) || !own(RESULTS, record.reason) || (record.reason !== 'rules_upgrade' && (record.reason === 'closed') !== (record.enteredAt !== null)) || (record.reason === 'rules_upgrade' && record.migrationReason !== 'opportunity_taxonomy_upgrade')) throw stateError('结束记录无效', path);
  }
  for (const [index, audit] of state.migrationAudit.entries()) {
    const path = `migrationAudit.${index}`;
    if (!audit || audit.fromSchemaVersion !== LEGACY_SCHEMA_VERSION || audit.toSchemaVersion !== SCHEMA_VERSION || audit.reason !== 'opportunity_taxonomy_upgrade' || !ORDER.includes(audit.symbol) || typeof audit.opportunityId !== 'string' || !legacySetup(audit.legacyType) || typeof audit.legacyTypeLabel !== 'string' || typeof audit.zone !== 'string' || typeof audit.originalStage !== 'string' || typeof audit.hadRecord !== 'boolean' || (audit.recordId !== null && typeof audit.recordId !== 'string') || !safeTime(audit.migratedAt) || !safeTime(audit.endedAt)) throw stateError('迁移审计无效', path);
  }
  return true;
}

function assertTimeline(item, path, active) {
  if (!Array.isArray(item.stages) || !item.stages.length || !safeTime(item.stageSince)) throw stateError('阶段字段无效', `${path}.stages`);
  for (let i = 0; i < item.stages.length; i += 1) {
    const stage = item.stages[i];
    if (!stage || !storedStage(stage.state) || !safeTime(stage.start) || (stage.end !== null && !safeTime(stage.end))) throw stateError('阶段字段无效', `${path}.stages.${i}`);
    if (i === item.stages.length - 1) {
      if ((active && stage.end !== null) || (!active && stage.end === null)) throw stateError('阶段结束状态无效', `${path}.stages.${i}`);
    } else if (stage.end !== item.stages[i + 1].start || stage.state === item.stages[i + 1].state) throw stateError('阶段不连续', `${path}.stages.${i + 1}`);
  }
  return item.stages.at(-1);
}

const legacyDirectionAllowed = (bias, direction) => {
  if (!own(BIASES, bias) || !own(DIRECTIONS, direction)) return false;
  if (direction === 'none' || bias === 'neutral') return true;
  return bias === 'bullish' ? direction === 'long' : direction === 'short';
};
const legacySetupAllowed = (direction, structure3m, type) => {
  if (!own(DIRECTIONS, direction) || !own(STRUCTURES_3M, structure3m) || !legacySetup(type) || direction === 'none' || structure3m === 'unjudged') return false;
  if (structure3m === 'range') return type === 'range';
  if (direction === 'long') return structure3m === 'bullish' ? type !== 'reversal' : type !== 'pullback';
  return structure3m === 'bearish' ? type !== 'reversal' : type !== 'pullback';
};
const legacyRecordSnapshot = opportunity => { const { zoneDraft, ...record } = opportunity; return copy(record); };

export function assertLegacyState(state) {
  if (!state || state.schemaVersion !== LEGACY_SCHEMA_VERSION || !Array.isArray(state.records) || !Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.revision)) throw stateError('V3 状态结构无效', 'state');
  const active = new Map(); const ids = new Set();
  for (const symbol of ORDER) {
    const card = state.cards?.[symbol];
    if (!card || card.symbol !== symbol || !own(BIASES, card.bias) || !own(STRUCTURES_3M, card.structure3m) || typeof card.needsStructureReview !== 'boolean' || !own(DIRECTIONS, card.direction) || !safeTime(card.idleSince)) throw stateError('V3 卡片结构无效', `cards.${symbol}`);
    const opportunity = card.opportunity; if (!opportunity) { if (!legacyDirectionAllowed(card.bias, card.direction)) throw stateError('V3 空闲交易方向不兼容', `cards.${symbol}.direction`); continue; }
    const holding = opportunity.enteredAt !== null;
    if (card.direction === 'none' || opportunity.symbol !== symbol || opportunity.direction !== card.direction || !legacySetup(opportunity.type) || !ATTENTION.includes(opportunity.attention) || opportunity.endedAt !== null || opportunity.reason !== null || active.has(opportunity.id)) throw stateError('V3 活动机会无效', `cards.${symbol}.opportunity`);
    if (!holding && !legacyDirectionAllowed(card.bias, card.direction)) throw stateError('V3 活动交易方向不兼容', `cards.${symbol}.direction`);
    if (!card.needsStructureReview && !legacySetupAllowed(card.direction, card.structure3m, opportunity.type)) throw stateError('V3 活动机会不兼容', `cards.${symbol}.opportunity.type`);
    if (typeof opportunity.zone !== 'string' || typeof opportunity.zoneDraft !== 'string' || opportunity.zone.length > 100 || opportunity.zoneDraft.length > 100 || !Array.isArray(opportunity.stages) || !opportunity.stages.length || !safeTime(opportunity.createdAt) || (opportunity.registeredAt !== null && !safeTime(opportunity.registeredAt))) throw stateError('V3 机会字段无效', `cards.${symbol}.opportunity`);
    if ((opportunity.registeredAt === null) !== (opportunity.zone === '')) throw stateError('V3 登记状态无效', `cards.${symbol}.opportunity.registeredAt`);
    if (opportunity.registeredAt === null ? opportunity.biasAtRegistration !== null || opportunity.structure3mAtRegistration !== null : !own(BIASES, opportunity.biasAtRegistration) || !own(STRUCTURES_3M, opportunity.structure3mAtRegistration)) throw stateError('V3 登记快照无效', `cards.${symbol}.opportunity`);
    if (opportunity.invalidReason !== null && !['structure_change', 'bias_change'].includes(opportunity.invalidReason)) throw stateError('V3 失效原因无效', `cards.${symbol}.opportunity.invalidReason`);
    const last = assertLegacyTimeline(opportunity, `cards.${symbol}.opportunity`, true);
    if (last.start !== opportunity.stageSince || last.state !== stateOf(card) || (opportunity.enteredAt !== null) !== holding) throw stateError('V3 阶段状态无效', `cards.${symbol}.opportunity.stages`);
    active.set(opportunity.id, opportunity);
  }
  for (const [index, record] of state.records.entries()) {
    const path = `records.${index}`;
    if (!record || ids.has(record.id) || Object.hasOwn(record, 'zoneDraft') || typeof record.zone !== 'string' || !record.zone.trim() || !ORDER.includes(record.symbol) || !legacySetup(record.type) || !['long', 'short'].includes(record.direction) || !own(BIASES, record.biasAtRegistration) || !own(STRUCTURES_3M, record.structure3mAtRegistration) || !safeTime(record.createdAt) || !safeTime(record.registeredAt)) throw stateError('V3 记录无效', path);
    if (!ATTENTION.includes(record.attention) || (record.enteredAt !== null && !safeTime(record.enteredAt)) || (record.endedAt !== null && !safeTime(record.endedAt)) || !Array.isArray(record.stages) || !record.stages.length) throw stateError('V3 记录阶段无效', path);
    if (record.invalidReason !== null && !['structure_change', 'bias_change'].includes(record.invalidReason)) throw stateError('V3 记录失效原因无效', path);
    ids.add(record.id); const last = assertLegacyTimeline(record, path, record.endedAt === null);
    if (last.start !== record.stageSince || last.state !== (record.enteredAt === null ? record.attention : 'position')) throw stateError('V3 记录阶段状态无效', `${path}.stages`);
    if (record.endedAt === null) { const current = active.get(record.id); if (!current || JSON.stringify(legacyRecordSnapshot(current)) !== JSON.stringify(record)) throw stateError('V3 活动记录不一致', path); }
    else if (active.has(record.id) || !['invalid', 'canceled', 'direction', 'closed'].includes(record.reason) || (record.reason === 'closed') !== (record.enteredAt !== null)) throw stateError('V3 结束记录无效', path);
  }
  return true;
}

function assertLegacyTimeline(item, path, active) {
  if (!Array.isArray(item.stages) || !item.stages.length || !safeTime(item.stageSince)) throw stateError('V3 阶段字段无效', `${path}.stages`);
  for (let i = 0; i < item.stages.length; i += 1) {
    const stage = item.stages[i];
    if (!stage || !storedStage(stage.state) || !safeTime(stage.start) || (stage.end !== null && !safeTime(stage.end))) throw stateError('V3 阶段字段无效', `${path}.stages.${i}`);
    if (i === item.stages.length - 1) {
      if ((active && stage.end !== null) || (!active && stage.end === null)) throw stateError('V3 阶段结束状态无效', `${path}.stages.${i}`);
    } else if (stage.end !== item.stages[i + 1].start || stage.state === item.stages[i + 1].state) throw stateError('V3 阶段不连续', `${path}.stages.${i + 1}`);
  }
  return item.stages.at(-1);
}

function collectLegacyTimes(state) {
  const times = [];
  const collect = value => { if (safeTime(value)) times.push(value); };
  for (const card of Object.values(state.cards || {})) {
    collect(card.idleSince);
    const opportunity = card.opportunity;
    if (opportunity) { ['createdAt', 'registeredAt', 'zoneConfirmedAt', 'enteredAt', 'endedAt', 'stageSince'].forEach(key => collect(opportunity[key])); opportunity.stages.forEach(stage => { collect(stage.start); collect(stage.end); }); }
  }
  state.records.forEach(record => { ['createdAt', 'registeredAt', 'zoneConfirmedAt', 'enteredAt', 'endedAt', 'stageSince'].forEach(key => collect(record[key])); record.stages.forEach(stage => { collect(stage.start); collect(stage.end); }); });
  return times;
}

export function migrateWorkspace(legacyState, migrationTime) {
  assertLegacyState(legacyState);
  const next = copy(legacyState); const times = collectLegacyTimes(next); const requested = safeTime(migrationTime) ? migrationTime : 0;
  const migratedAt = Math.max(requested, ...times, 0); const audits = [];
  for (const symbol of ORDER) {
    const card = next.cards[symbol]; const opportunity = card.opportunity;
    if (!opportunity) { card.needsStructureReview = false; continue; }
    const record = next.records.find(candidate => candidate.id === opportunity.id && candidate.endedAt === null);
    const audit = {
      fromSchemaVersion: LEGACY_SCHEMA_VERSION, toSchemaVersion: SCHEMA_VERSION, reason: 'opportunity_taxonomy_upgrade', migratedAt: migratedAt,
      endedAt: migratedAt, symbol, opportunityId: opportunity.id, legacyType: opportunity.type, legacyTypeLabel: setupLabel(opportunity.type),
      zone: record?.zone || opportunity.zone || '', originalStage: stateOf(card), hadRecord: Boolean(record), recordId: record?.id || null
    };
    if (record) {
      record.stages.at(-1).end = migratedAt; record.endedAt = migratedAt; record.reason = 'rules_upgrade'; record.migrationReason = 'opportunity_taxonomy_upgrade';
    }
    card.opportunity = null; card.idleSince = migratedAt; card.needsStructureReview = false; audits.push(audit);
  }
  for (const record of next.records) if (!Object.hasOwn(record, 'migrationReason')) record.migrationReason = null;
  next.schemaVersion = SCHEMA_VERSION; next.migrationAudit = [...(Array.isArray(next.migrationAudit) ? next.migrationAudit : []), ...audits];
  assertState(next); return { state: next, migratedAt, audits };
}
