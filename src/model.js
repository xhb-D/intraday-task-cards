export const ORDER = Object.freeze(['GC', 'CL', 'ES']);
export const BIASES = Object.freeze({ bullish: '偏多', neutral: '无偏见', bearish: '偏空' });
export const STRUCTURES_3M = Object.freeze({ unjudged: '未判断', bullish: '多头', range: '震荡', bearish: '空头' });
export const VISIBLE_STRUCTURES_3M = Object.freeze({ bullish: '多头', range: '震荡', bearish: '空头' });
export const DIRECTIONS = Object.freeze({ long: '只找多', short: '只找空', none: '暂无交易方向' });
export const SETUPS = Object.freeze({ pullback: '趋势回调', range: '区间反转', reversal: '趋势反转' });
export const STAGES = Object.freeze({ none: '无机会', wait: '等待', signal: '找信号', position: '持仓' });
export const RESULTS = Object.freeze({ invalid: '失效', canceled: '已取消', direction: '方向改变结束', closed: '已平仓' });
export const ATTENTION = Object.freeze(['wait', 'signal']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const stateError = (message, path) => Object.assign(new Error(message), { code: 'STATE_VALIDATION_ERROR', path });
const storedStage = stage => ATTENTION.includes(stage) || stage === 'position';
export const copy = value => JSON.parse(JSON.stringify(value));
export const stateOf = card => !card.opportunity ? 'none' : card.opportunity.enteredAt === null ? card.opportunity.attention : 'position';
export const hasRecord = (state, opportunity) => Boolean(opportunity && state.records.some(record => record.id === opportunity.id));
export const isDirectionAllowed = (bias, direction) => {
  if (!own(BIASES, bias) || !own(DIRECTIONS, direction)) return false;
  if (direction === 'none' || bias === 'neutral') return true;
  return bias === 'bullish' ? direction === 'long' : direction === 'short';
};
export const isSetupAllowed = (direction, structure3m, type) => {
  if (!own(DIRECTIONS, direction) || !own(STRUCTURES_3M, structure3m) || !own(SETUPS, type) || direction === 'none' || structure3m === 'unjudged') return false;
  if (structure3m === 'range') return type === 'range';
  if (direction === 'long') return structure3m === 'bullish' ? type !== 'reversal' : type !== 'pullback';
  return structure3m === 'bearish' ? type !== 'reversal' : type !== 'pullback';
};
export const holdingConflictWarning = card => {
  if (stateOf(card) !== 'position') return '';
  const warnings = [];
  if (!isDirectionAllowed(card.bias, card.direction)) warnings.push('当前偏见与本笔方向冲突；平仓后需重新选择方向。');
  if (!isSetupAllowed(card.direction, card.structure3m, card.opportunity.type)) warnings.push('当前市场结构与本笔机会不再匹配；不会自动平仓。');
  return warnings.join(' ');
};
export const recordSnapshot = opportunity => { const { zoneDraft, ...record } = opportunity; return copy(record); };

export function createWorkspace(time = Date.now()) {
  const cards = Object.fromEntries(ORDER.map(symbol => [symbol, {
    symbol, bias: 'neutral', structure3m: 'unjudged', needsStructureReview: false,
    direction: 'none', opportunity: null, idleSince: time
  }]));
  return { schemaVersion: 3, sequence: 0, revision: 0, lastSavedAt: null, cards, records: [] };
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
function closeOpportunity(state, card, reason, time, invalidReason = null) {
  const opportunity = opportunityFor(card);
  if (!own(RESULTS, reason) || (reason === 'closed') !== (opportunity.enteredAt !== null)) throw new Error('非法结束机会');
  opportunity.stages.at(-1).end = time; opportunity.endedAt = time; opportunity.reason = reason;
  if (reason === 'invalid') opportunity.invalidReason = invalidReason;
  syncRecord(state, opportunity); card.opportunity = null; card.idleSince = time;
}

export function changeBias(state, symbol, bias, time = Date.now(), confirmed = false) {
  if (!own(BIASES, bias)) throw new Error('偏见无效');
  const card = cardFor(state, symbol); if (card.bias === bias) return { changed: false, reason: 'same' };
  const holding = stateOf(card) === 'position';
  const directionWouldConflict = !isDirectionAllowed(bias, card.direction);
  if (!holding && card.opportunity && directionWouldConflict && !confirmed) return { changed: false, needsConfirmation: true };
  card.bias = bias;
  if (!holding && directionWouldConflict) {
    if (card.opportunity) closeOpportunity(state, card, 'invalid', time, 'bias_change');
    card.direction = 'none';
  }
  touch(state); assertState(state); return { changed: true, invalidated: directionWouldConflict && !holding, holdingConflict: directionWouldConflict && holding };
}
export function changeDirection(state, symbol, direction, time = Date.now(), confirmed = false) {
  if (!own(DIRECTIONS, direction)) throw new Error('交易方向无效');
  const card = cardFor(state, symbol);
  if (stateOf(card) === 'position') return { changed: false, reason: 'holding' };
  if (card.needsStructureReview) return { changed: false, reason: 'needs-structure-review' };
  if (!isDirectionAllowed(card.bias, direction)) return { changed: false, reason: 'bias' };
  if (card.direction === direction) return { changed: false, reason: 'same' };
  if (card.opportunity && !confirmed) return { changed: false, needsConfirmation: true };
  if (card.opportunity) closeOpportunity(state, card, 'direction', time);
  card.direction = direction; touch(state); assertState(state); return { changed: true };
}
export function changeStructure(state, symbol, structure3m, time = Date.now(), confirmed = false) {
  if (!own(STRUCTURES_3M, structure3m)) throw new Error('市场结构无效');
  const card = cardFor(state, symbol); const status = stateOf(card);
  if (card.structure3m === structure3m && !card.needsStructureReview) return { changed: false, reason: 'same' };
  if (status === 'position') { card.structure3m = structure3m; card.needsStructureReview = false; touch(state); assertState(state); return { changed: true }; }
  if (!card.opportunity) {
    card.structure3m = structure3m; card.needsStructureReview = false;
    touch(state); assertState(state); return { changed: true };
  }
  if (isSetupAllowed(card.direction, structure3m, card.opportunity.type)) { card.structure3m = structure3m; card.needsStructureReview = false; touch(state); assertState(state); return { changed: true }; }
  if (!confirmed) return { changed: false, needsConfirmation: true };
  closeOpportunity(state, card, 'invalid', time, 'structure_change');
  card.structure3m = structure3m; card.needsStructureReview = false;
  touch(state); assertState(state); return { changed: true, invalidated: true };
}
export function chooseSetup(state, symbol, type, time = Date.now()) {
  if (!own(SETUPS, type)) throw new Error('机会类型无效');
  const card = cardFor(state, symbol);
  if (card.needsStructureReview || !isSetupAllowed(card.direction, card.structure3m, type) || stateOf(card) === 'position' || card.opportunity?.type === type) return { changed: false };
  if (card.opportunity) closeOpportunity(state, card, 'canceled', time);
  card.opportunity = {
    id: nextId(state, time), symbol, direction: card.direction, type,
    zone: '', zoneDraft: '', createdAt: time, registeredAt: null, zoneConfirmedAt: null,
    biasAtRegistration: null, structure3mAtRegistration: null, invalidReason: null,
    enteredAt: null, endedAt: null, reason: null, attention: 'wait', stageSince: time,
    stages: [{ state: 'wait', start: time, end: null }]
  };
  touch(state); assertState(state); return { changed: true, opportunity: card.opportunity };
}
export function updateDraft(state, symbol, value) {
  const card = cardFor(state, symbol);
  if (!card.opportunity || stateOf(card) === 'position') return false;
  if (typeof value !== 'string' || value.length > 100) throw new Error('关键位置格式无效');
  if (card.opportunity.zoneDraft === value) return false;
  card.opportunity.zoneDraft = value; touch(state); assertState(state); return true;
}
export function registrationStatus(state, symbol) {
  const opportunity = cardFor(state, symbol).opportunity;
  if (!opportunity) return { enabled: false, label: '确认', text: '先建立机会，再确认关键位置', kind: 'empty' };
  const value = opportunity.zoneDraft.trim(); const present = hasRecord(state, opportunity);
  if (!present) return { enabled: Boolean(value), label: opportunity.registeredAt === null ? '确认' : '重新登记', text: opportunity.registeredAt === null ? '未登记 · 点击确认后写入记录' : '记录已删除 · 不会自动恢复', kind: opportunity.registeredAt === null ? 'draft' : 'removed' };
  if (value !== opportunity.zone) return { enabled: Boolean(value), label: '修改待确认', text: '修改待确认 · 记录保留原位置', kind: 'dirty' };
  return { enabled: false, label: '已确认', text: '已登记 · 状态变化更新同一行', kind: 'confirmed' };
}
export function confirmPosition(state, symbol, time = Date.now()) {
  const card = cardFor(state, symbol); const opportunity = opportunityFor(card);
  if (stateOf(card) === 'position') return false;
  const value = opportunity.zoneDraft.trim(); if (!value) return false;
  const exists = hasRecord(state, opportunity);
  opportunity.zone = value; opportunity.zoneDraft = value; opportunity.zoneConfirmedAt = time;
  if (!exists && opportunity.biasAtRegistration === null) { opportunity.biasAtRegistration = card.bias; opportunity.structure3mAtRegistration = card.structure3m; }
  if (exists) syncRecord(state, opportunity); else { opportunity.registeredAt = time; state.records.push(recordSnapshot(opportunity)); }
  touch(state); assertState(state); return true;
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
  const directionReset = !isDirectionAllowed(card.bias, card.direction);
  if (directionReset) card.direction = 'none';
  touch(state); assertState(state); return { changed: true, directionReset };
}
export function deleteRecord(state, id) { const index = state.records.findIndex(record => record.id === id); if (index < 0) return false; state.records.splice(index, 1); touch(state); assertState(state); return true; }

export function recordProgress(record) { return record.endedAt !== null ? RESULTS[record.reason] : record.enteredAt !== null ? '持仓中' : '已登记'; }
export function instruction(card) {
  const state = stateOf(card);
  if (card.needsStructureReview) return ['先确认市场结构', '旧版本机会暂不可继续执行'];
  if (state === 'none') return card.direction === 'none' ? ['先确认偏见、交易方向与市场结构', '不找入场'] : card.structure3m === 'unjudged' ? ['先确认市场结构', '不找入场'] : ['等具体机会', '不找入场'];
  if (state === 'wait') return ['等既定条件成熟', '不提前入场'];
  if (state === 'signal') return ['按既定规则找入场信号', '不临时更换入场理由'];
  return ['只管理当前持仓', '本卡不找新入场'];
}
export function assertState(state) {
  if (!state || state.schemaVersion !== 3 || !Array.isArray(state.records) || !Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.revision)) throw stateError('状态结构无效', 'state');
  const active = new Map(); const ids = new Set();
  for (const symbol of ORDER) {
    const card = state.cards?.[symbol];
    if (!card || card.symbol !== symbol || !own(BIASES, card.bias) || !own(STRUCTURES_3M, card.structure3m) || typeof card.needsStructureReview !== 'boolean' || !own(DIRECTIONS, card.direction) || !Number.isSafeInteger(card.idleSince)) throw stateError('卡片结构无效', `cards.${symbol}`);
    const opportunity = card.opportunity; if (!opportunity) { if (!isDirectionAllowed(card.bias, card.direction)) throw stateError('空闲交易方向不兼容', `cards.${symbol}.direction`); continue; }
    const holding = stateOf(card) === 'position';
    if (card.direction === 'none' || opportunity.symbol !== symbol || opportunity.direction !== card.direction || !own(SETUPS, opportunity.type) || !ATTENTION.includes(opportunity.attention) || opportunity.endedAt !== null || opportunity.reason !== null || active.has(opportunity.id)) throw stateError('活动机会无效', `cards.${symbol}.opportunity`);
    if (card.needsStructureReview && holding) throw stateError('持仓不应等待结构审查', `cards.${symbol}.needsStructureReview`);
    if (!holding && !isDirectionAllowed(card.bias, card.direction)) throw stateError('活动交易方向不兼容', `cards.${symbol}.direction`);
    if (!holding && !card.needsStructureReview && !isSetupAllowed(card.direction, card.structure3m, opportunity.type)) throw stateError('活动机会不兼容', `cards.${symbol}.opportunity.type`);
    if (typeof opportunity.zone !== 'string' || typeof opportunity.zoneDraft !== 'string' || opportunity.zone.length > 100 || opportunity.zoneDraft.length > 100 || !Array.isArray(opportunity.stages) || !opportunity.stages.length) throw stateError('机会字段无效', `cards.${symbol}.opportunity`);
    if ((opportunity.registeredAt === null) !== (opportunity.zone === '')) throw stateError('登记状态无效', `cards.${symbol}.opportunity.registeredAt`);
    if (opportunity.registeredAt === null ? opportunity.biasAtRegistration !== null || opportunity.structure3mAtRegistration !== null : !own(BIASES, opportunity.biasAtRegistration) || !own(STRUCTURES_3M, opportunity.structure3mAtRegistration)) throw stateError('登记快照无效', `cards.${symbol}.opportunity`);
    if (opportunity.invalidReason !== null && !['structure_change', 'bias_change'].includes(opportunity.invalidReason)) throw stateError('失效原因无效', `cards.${symbol}.opportunity.invalidReason`);
    const last = assertTimeline(opportunity, `cards.${symbol}.opportunity`, true);
    if (last.start !== opportunity.stageSince || last.state !== stateOf(card) || (opportunity.enteredAt !== null) !== holding) throw stateError('阶段状态无效', `cards.${symbol}.opportunity.stages`);
    active.set(opportunity.id, opportunity);
  }
  for (const [index, record] of state.records.entries()) {
    if (!record || ids.has(record.id) || Object.hasOwn(record, 'zoneDraft') || !record.zone?.trim() || !ORDER.includes(record.symbol) || !own(BIASES, record.biasAtRegistration) || !own(STRUCTURES_3M, record.structure3mAtRegistration)) throw stateError('记录无效', `records.${index}`);
    ids.add(record.id);
    if (!ATTENTION.includes(record.attention)) throw stateError('记录注意力状态无效', `records.${index}.attention`);
    const last = assertTimeline(record, `records.${index}`, record.endedAt === null);
    if (last.start !== record.stageSince || last.state !== (record.enteredAt === null ? record.attention : 'position')) throw stateError('记录阶段状态无效', `records.${index}.stages`);
    if (record.endedAt === null) { const current = active.get(record.id); if (!current || JSON.stringify(recordSnapshot(current)) !== JSON.stringify(record)) throw stateError('活动记录不一致', `records.${index}`); }
    else if (active.has(record.id) || !own(RESULTS, record.reason) || (record.reason === 'closed') !== (record.enteredAt !== null) || (record.invalidReason !== null && !['structure_change', 'bias_change'].includes(record.invalidReason))) throw stateError('结束记录无效', `records.${index}`);
  }
  return true;
}

function assertTimeline(item, path, active) {
  if (!Array.isArray(item.stages) || !item.stages.length || !Number.isSafeInteger(item.stageSince)) throw stateError('阶段字段无效', `${path}.stages`);
  for (let i = 0; i < item.stages.length; i += 1) {
    const stage = item.stages[i];
    if (!stage || !storedStage(stage.state) || !Number.isSafeInteger(stage.start) || (stage.end !== null && !Number.isSafeInteger(stage.end))) throw stateError('阶段字段无效', `${path}.stages.${i}`);
    if (i === item.stages.length - 1) {
      if ((active && stage.end !== null) || (!active && stage.end === null)) throw stateError('阶段结束状态无效', `${path}.stages.${i}`);
    } else if (stage.end !== item.stages[i + 1].start || stage.state === item.stages[i + 1].state) throw stateError('阶段不连续', `${path}.stages.${i + 1}`);
  }
  return item.stages.at(-1);
}
