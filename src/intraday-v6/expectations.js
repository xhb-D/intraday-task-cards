// Manual Decision Truth. No market/broker inference and no writable derived state.
export const EXPECTATION_LIMIT = 200;
export const HOLDING_EXPECTATION_STATES = Object.freeze({ observing: '待观察', met: '符合预期', exceeded: '超出预期', underperformed: '不及预期' });
export const EXPECTATION_EVENT_TYPES = Object.freeze(['ENTRY_EXPECTATION_RECORDED', 'ENTRY_EXPECTATION_CORRECTED', 'HOLDING_EXPECTATION_UPDATED']);
export const isExpectationEvent = event => EXPECTATION_EVENT_TYPES.includes(event?.type);
const keys = (o, names) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === names.length && names.every(k => Object.hasOwn(o, k));
const time = n => Number.isSafeInteger(n) && n >= 0;
const reject = () => { throw Object.assign(new Error('预期事件链无效'), { code: 'V6_EXPECTATION_INVALID', path: 'researchCapture' }); };
const same = (a, b) => ['path', 'keyLevels', 'focus'].every(k => a?.[k] === b?.[k]);
const text = s => typeof s === 'string' && s === s.trim() && Array.from(s).length <= EXPECTATION_LIMIT;
export function normalizeExpectationContent(content) {
  if (!keys(content, ['path', 'keyLevels', 'focus']) || !Object.values(content).every(s => typeof s === 'string')) reject();
  const result = Object.fromEntries(['path','keyLevels','focus'].map(k => [k, content[k].trim()]));
  if (!Object.values(result).every(text) || !Object.values(result).some(Boolean)) reject();
  return result;
}
export function expectationTiming(record, recordedAt) {
  return record.endedAt !== null && recordedAt >= record.endedAt ? 'post_close_review' :
    record.enteredAt !== null && recordedAt >= record.enteredAt ? 'after_html_entry' : 'before_html_entry';
}
export function expectationTimingLabel(timing) {
  return ({ before_html_entry: 'HTML 入场确认前', after_html_entry: '入场后补录（依据 HTML 确认）', post_close_review: '复盘补写（结束后）' })[timing] || '';
}
export function expectationHistory(record) { return (record?.researchCapture?.manualEvents || []).filter(isExpectationEvent); }
export function entryExpectation(record) {
  const versions = expectationHistory(record).filter(e => e.type.startsWith('ENTRY_EXPECTATION_'));
  return versions.length ? { original: versions[0], current: versions.at(-1), versions } : null;
}
export function holdingExpectationHistory(record) { return expectationHistory(record).filter(e => e.type === 'HOLDING_EXPECTATION_UPDATED'); }
export function currentHoldingExpectation(record) { return holdingExpectationHistory(record).at(-1) || null; }

export function expectationPayload(record, submissionId, recordedAt) {
  if (typeof submissionId !== 'string' || !submissionId.trim() || submissionId.length > 100) reject();
  return { recordId: record.id, submissionId, timing: expectationTiming(record, recordedAt),
    htmlEnteredAtAtRecording: record.enteredAt, htmlEndedAtAtRecording: record.endedAt };
}

// Validate the full mixed chain before projecting legacy events for frozen V5 rules.
export function assertExpectationChain(record) {
  const capture = record.researchCapture;
  if (!keys(capture, ['eventSequence', 'manualEvents']) || !Array.isArray(capture.manualEvents) || capture.eventSequence !== capture.manualEvents.length) reject();
  let previousTime = record.registeredAt, original = null, current = null;
  const submissions = new Set();
  for (const [index, event] of capture.manualEvents.entries()) {
    if (!keys(event, ['id', 'type', 'recordedAt', 'effectiveAt', 'source', 'payload']) || event.id !== `${record.id}:manual-${index + 1}` ||
        event.source !== 'manual_intraday' || !time(event.recordedAt) || !time(event.effectiveAt) || event.recordedAt < previousTime || event.effectiveAt > event.recordedAt) reject();
    previousTime = event.recordedAt;
    if (!isExpectationEvent(event)) continue; // frozen legacy validator rejects unknown types
    const p = event.payload, common = ['recordId', 'submissionId', 'timing', 'htmlEnteredAtAtRecording', 'htmlEndedAtAtRecording'];
    const fields = event.type === 'ENTRY_EXPECTATION_CORRECTED' ? ['content', 'originalEventId', 'previousEventId', 'originalRecordedAt', 'originalContent', 'previousContent'] :
      event.type === 'ENTRY_EXPECTATION_RECORDED' ? ['content'] : ['status', 'reason'];
    if (!keys(p, [...common, ...fields]) || p.recordId !== record.id || typeof p.submissionId !== 'string' || !p.submissionId.trim() || p.submissionId.length > 100 ||
        submissions.has(p.submissionId) || event.effectiveAt !== event.recordedAt || p.timing !== expectationTiming({ enteredAt: p.htmlEnteredAtAtRecording, endedAt: p.htmlEndedAtAtRecording }, event.recordedAt)) reject();
    submissions.add(p.submissionId);
    // Snapshots reflect facts already confirmed at that instant; later entry/exit never rewrites them.
    for (const [field, actual] of [['htmlEnteredAtAtRecording', record.enteredAt], ['htmlEndedAtAtRecording', record.endedAt]]) {
      const snapshot = p[field];
      if (snapshot === null ? actual !== null && actual < event.recordedAt : snapshot !== actual || !time(snapshot) || snapshot > event.recordedAt) reject();
    }
    if (event.type === 'HOLDING_EXPECTATION_UPDATED') {
      if (record.enteredAt === null || event.recordedAt < record.enteredAt || record.endedAt !== null && event.recordedAt > record.endedAt || p.htmlEndedAtAtRecording !== null ||
          !Object.hasOwn(HOLDING_EXPECTATION_STATES, p.status) || !text(p.reason)) reject();
    } else {
      const normalized = normalizeExpectationContent(p.content);
      if (!same(normalized, p.content)) reject();
      if (event.type === 'ENTRY_EXPECTATION_RECORDED') { if (original) reject(); original = event; }
      else if (!original || p.originalEventId !== original.id || p.previousEventId !== current.id || p.originalRecordedAt !== original.recordedAt ||
          !keys(p.originalContent, ['path', 'keyLevels', 'focus']) || !keys(p.previousContent, ['path', 'keyLevels', 'focus']) ||
          !same(p.originalContent, original.payload.content) || !same(p.previousContent, current.payload.content)) reject();
      current = event;
    }
  }
  return true;
}

// Compatibility view only: canonical IDs, references and sequence are never changed.
export function legacyCaptureProjection(record) {
  const manualEvents = structuredClone(record.researchCapture.manualEvents.filter(e => !isExpectationEvent(e)));
  const ids = new Map(manualEvents.map((event, i) => [event.id, `${record.id}:manual-${i + 1}`]));
  for (const event of manualEvents) {
    event.id = ids.get(event.id);
    if (event.type === 'BOF_TO_PB_REVERTED') event.payload.revertedEventId = ids.get(event.payload.revertedEventId) || `INVALID_REFERENCE:${event.payload.revertedEventId}`;
  }
  return { eventSequence: manualEvents.length, manualEvents };
}

export function manualDecisionReview(record) {
  return { recordId: record.id, setup: record.type, truthSource: 'manual_intraday', timeBasis: 'HTML_CONFIRMATION_NOT_BROKER_FILL',
    htmlEnteredAt: record.enteredAt, htmlExitedAt: record.endedAt, entryExpectation: structuredClone(entryExpectation(record)),
    holdingExpectations: structuredClone(holdingExpectationHistory(record)), manualEvents: structuredClone(record.researchCapture.manualEvents) };
}
