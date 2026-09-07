export const ORDER = Object.freeze(['GC', 'CL', 'ES']);
export const DIRECTIONS = Object.freeze({ long: '只找多', short: '只找空', none: '暂无方向' });
export const SETUPS = Object.freeze({ pullback: '趋势回调', range: '区间反转', reversal: '趋势反转' });
export const STAGES = Object.freeze({ none: '无机会', wait: '等待', near: '接近', signal: '找信号', position: '持仓' });
export const RESULTS = Object.freeze({ invalid: '失效', canceled: '已取消', direction: '方向改变结束', closed: '已平仓' });
export const ATTENTION = Object.freeze(['wait', 'near', 'signal']);

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const copy = value => JSON.parse(JSON.stringify(value));
export const stateOf = card => !card.opportunity ? 'none' : card.opportunity.enteredAt === null ? card.opportunity.attention : 'position';
export const hasRecord = (state, opportunity) => Boolean(opportunity && state.records.some(record => record.id === opportunity.id));
export const recordSnapshot = opportunity => {
  const { zoneDraft, ...record } = opportunity;
  return copy(record);
};

export function createWorkspace(time = Date.now()) {
  const cards = Object.fromEntries(ORDER.map(symbol => [symbol, { symbol, direction: 'none', opportunity: null, idleSince: time }]));
  return { schemaVersion: 1, sequence: 0, revision: 0, lastSavedAt: null, cards, records: [] };
}

function cardFor(state, symbol) {
  if (!ORDER.includes(symbol)) throw new Error('未知品种');
  return state.cards[symbol];
}
function opportunityFor(card) {
  if (!card.opportunity) throw new Error('当前没有机会');
  return card.opportunity;
}
function touch(state) { state.revision += 1; return state; }
function syncRecord(state, opportunity) {
  const index = state.records.findIndex(record => record.id === opportunity.id);
  if (index >= 0) state.records[index] = recordSnapshot(opportunity);
}
function nextId(state, time) { state.sequence += 1; return `op-${state.sequence}-${time.toString(36)}`; }
function transition(state, opportunity, stage, time) {
  const current = opportunity.stages.at(-1);
  if (current.state === stage) return false;
  current.end = time;
  opportunity.stageSince = time;
  if (stage === 'position') opportunity.enteredAt = time;
  else opportunity.attention = stage;
  opportunity.stages.push({ state: stage, start: time, end: null });
  syncRecord(state, opportunity);
  return true;
}

export function changeDirection(state, symbol, direction, time = Date.now(), confirmed = false) {
  if (!own(DIRECTIONS, direction)) throw new Error('方向无效');
  const card = cardFor(state, symbol);
  if (stateOf(card) === 'position') return { changed: false, reason: 'holding' };
  if (card.direction === direction) return { changed: false, reason: 'same' };
  if (card.opportunity && !confirmed) return { changed: false, needsConfirmation: true };
  if (card.opportunity) closeOpportunity(state, card, 'direction', time);
  card.direction = direction;
  touch(state); assertState(state);
  return { changed: true };
}

export function chooseSetup(state, symbol, type, time = Date.now()) {
  if (!own(SETUPS, type)) throw new Error('机会类型无效');
  const card = cardFor(state, symbol);
  if (card.direction === 'none' || stateOf(card) === 'position' || card.opportunity?.type === type) return { changed: false };
  if (card.opportunity) closeOpportunity(state, card, 'canceled', time);
  card.opportunity = {
    id: nextId(state, time), symbol, direction: card.direction, type,
    zone: '', zoneDraft: '', createdAt: time, registeredAt: null, zoneConfirmedAt: null,
    enteredAt: null, endedAt: null, reason: null, attention: 'wait', stageSince: time,
    stages: [{ state: 'wait', start: time, end: null }]
  };
  touch(state); assertState(state);
  return { changed: true, opportunity: card.opportunity };
}

export function updateDraft(state, symbol, value) {
  const card = cardFor(state, symbol);
  if (!card.opportunity || stateOf(card) === 'position') return false;
  if (typeof value !== 'string' || value.length > 100) throw new Error('关键位置格式无效');
  if (card.opportunity.zoneDraft === value) return false;
  card.opportunity.zoneDraft = value;
  touch(state); assertState(state);
  return true;
}

export function registrationStatus(state, symbol) {
  const opportunity = cardFor(state, symbol).opportunity;
  if (!opportunity) return { enabled: false, label: '确认', text: '先建立机会，再确认关键位置', kind: 'empty' };
  const value = opportunity.zoneDraft.trim();
  const present = hasRecord(state, opportunity);
  if (!present) return { enabled: Boolean(value), label: opportunity.registeredAt === null ? '确认' : '重新登记', text: opportunity.registeredAt === null ? '未登记 · 点击确认后写入记录' : '记录已删除 · 不会自动恢复', kind: opportunity.registeredAt === null ? 'draft' : 'removed' };
  if (value !== opportunity.zone) return { enabled: Boolean(value), label: '确认', text: '修改待确认 · 记录保留原位置', kind: 'dirty' };
  return { enabled: false, label: '已确认', text: '已登记 · 状态变化更新同一行', kind: 'confirmed' };
}

export function confirmPosition(state, symbol, time = Date.now()) {
  const card = cardFor(state, symbol); const opportunity = opportunityFor(card);
  if (stateOf(card) === 'position') return false;
  const value = opportunity.zoneDraft.trim();
  if (!value) return false;
  const exists = hasRecord(state, opportunity);
  opportunity.zone = value; opportunity.zoneDraft = value; opportunity.zoneConfirmedAt = time;
  if (exists) syncRecord(state, opportunity);
  else { opportunity.registeredAt = time; state.records.push(recordSnapshot(opportunity)); }
  touch(state); assertState(state);
  return true;
}

export function setStage(state, symbol, stage, time = Date.now()) {
  if (!ATTENTION.includes(stage)) throw new Error('注意力状态无效');
  const card = cardFor(state, symbol);
  if (!card.opportunity || stateOf(card) === 'position' || stateOf(card) === stage) return false;
  transition(state, card.opportunity, stage, time); touch(state); assertState(state); return true;
}

export function markEntered(state, symbol, time = Date.now(), confirmed = false) {
  const card = cardFor(state, symbol);
  if (!card.opportunity || !ATTENTION.includes(stateOf(card))) return { changed: false };
  if (!confirmed) return { changed: false, needsConfirmation: true };
  transition(state, card.opportunity, 'position', time); touch(state); assertState(state); return { changed: true };
}

function closeOpportunity(state, card, reason, time) {
  const opportunity = opportunityFor(card);
  if (!own(RESULTS, reason) || (reason === 'closed') !== (opportunity.enteredAt !== null)) throw new Error('非法结束机会');
  opportunity.stages.at(-1).end = time; opportunity.endedAt = time; opportunity.reason = reason;
  syncRecord(state, opportunity); card.opportunity = null; card.idleSince = time;
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
  closeOpportunity(state, card, 'closed', time); touch(state); assertState(state); return { changed: true };
}
export function deleteRecord(state, id) {
  const index = state.records.findIndex(record => record.id === id);
  if (index < 0) return false;
  state.records.splice(index, 1); touch(state); assertState(state); return true;
}

export function recordProgress(record) { return record.endedAt !== null ? RESULTS[record.reason] : record.enteredAt !== null ? '持仓中' : '已登记'; }
export function instruction(card) {
  const state = stateOf(card);
  if (state === 'none') return card.direction === 'none' ? ['先确定方向', '不找入场'] : ['等具体机会', '不找入场'];
  if (state === 'wait') return ['等价格到关键位置', '不追价'];
  if (state === 'near') return ['把注意力转回图表', '不提前入场'];
  if (state === 'signal') return ['按既定规则找入场信号', '不临时更换入场理由'];
  return ['只管理当前持仓', '本卡不找新入场'];
}

export function assertState(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.records) || !Number.isSafeInteger(state.sequence) || !Number.isSafeInteger(state.revision)) throw new Error('状态结构无效');
  const active = new Map(); const ids = new Set();
  for (const symbol of ORDER) {
    const card = state.cards?.[symbol];
    if (!card || card.symbol !== symbol || !own(DIRECTIONS, card.direction) || !Number.isSafeInteger(card.idleSince)) throw new Error('卡片结构无效');
    const o = card.opportunity; if (!o) continue;
    if (card.direction === 'none' || o.symbol !== symbol || o.direction !== card.direction || !own(SETUPS, o.type) || !ATTENTION.includes(o.attention) || o.endedAt !== null || o.reason !== null || active.has(o.id)) throw new Error('活动机会无效');
    if (typeof o.zone !== 'string' || typeof o.zoneDraft !== 'string' || o.zone.length > 100 || o.zoneDraft.length > 100 || !Array.isArray(o.stages) || !o.stages.length) throw new Error('机会字段无效');
    if ((o.registeredAt === null) !== (o.zone === '')) throw new Error('登记状态无效');
    const last = o.stages.at(-1);
    if (last.end !== null || last.start !== o.stageSince || last.state !== stateOf(card) || (o.enteredAt !== null) !== (stateOf(card) === 'position')) throw new Error('阶段状态无效');
    for (let i = 1; i < o.stages.length; i += 1) if (o.stages[i - 1].end !== o.stages[i].start || o.stages[i - 1].state === o.stages[i].state) throw new Error('阶段不连续');
    active.set(o.id, o);
  }
  for (const record of state.records) {
    if (!record || ids.has(record.id) || Object.hasOwn(record, 'zoneDraft') || !record.zone?.trim() || !ORDER.includes(record.symbol)) throw new Error('记录无效');
    ids.add(record.id);
    if (record.endedAt === null) {
      const current = active.get(record.id);
      if (!current || JSON.stringify(recordSnapshot(current)) !== JSON.stringify(record)) throw new Error('活动记录不一致');
    } else if (active.has(record.id) || !own(RESULTS, record.reason) || (record.reason === 'closed') !== (record.enteredAt !== null)) throw new Error('结束记录无效');
  }
  return true;
}
