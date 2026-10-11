import { intradayV6 } from './intraday-v6/index.js';
import { DIRECTIONS, SETUP_LABELS } from './model.js';
import { fullTime, captureRecordProgress } from './capture-persistence.js';

export function renderHistoryArchive(state, query = '') {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const records = intradayV6.archivedRecords(state, query);
  return records.map(record => `<tr><td data-label="登记时间 / ID">${esc(fullTime(record.registeredAt))}<small>${esc(record.id)}</small></td><td data-label="品种 / 方向">${esc(record.symbol)} · ${esc(DIRECTIONS[record.direction])}</td><td data-label="原始 Setup / 人工管理">${esc(SETUP_LABELS[record.type])}${intradayV6.currentManagement(record) ? `<small>人工管理：${esc(intradayV6.currentManagement(record))}</small>` : ''}</td><td data-label="结束事实">${captureRecordProgress(record)}<small>${esc(fullTime(record.endedAt))}</small></td><td data-label="查看"><button type="button" data-expectation-history="${esc(record.id)}">预期与完整历史</button></td></tr>`).join('');
}

// Full backup restores remain explicit replacement, but may not erase an existing
// ended archive or its event prefix. No merge and no second writable trade store.
export function assertArchiveRetention(current, restored) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  for (const record of current.records.filter(r => r.endedAt !== null)) {
    const next = restored.records.find(r => r.id === record.id);
    const facts = r => Object.fromEntries(Object.entries(r).filter(([key]) => key !== 'researchCapture'));
    if (!next || !same(facts(record),facts(next)) ||
        !same(record.researchCapture.manualEvents, next.researchCapture.manualEvents.slice(0,record.researchCapture.manualEvents.length))) {
      throw Object.assign(new Error('此备份会移除或改写现有历史档案，已阻止恢复。请先保全两份完整备份，在隔离环境核对；不能用删除历史实现恢复。'), {code:'V6_ARCHIVE_RETENTION_REQUIRED'});
    }
  }
  return true;
}
