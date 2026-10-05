// Read-only V6 compatibility boundary. Old flat-to-flat execution engines cannot
// attribute overlapping independent capture trades. Never feed those to matching.
export function captureResearchInput(intraday) {
  const records = structuredClone(intraday?.records || []), blockedIds = new Set();
  if (intraday?.schemaVersion === 6) {
    const entered = records.filter(record => record.enteredAt !== null);
    for (let i = 0; i < entered.length; i++) for (let j = i + 1; j < entered.length; j++) {
      const a = entered[i], b = entered[j];
      if (a.symbol === b.symbol && Math.max(a.enteredAt,b.enteredAt) < Math.min(a.endedAt ?? Infinity,b.endedAt ?? Infinity)) { blockedIds.add(a.id); blockedIds.add(b.id); }
    }
  }
  return { records, eligible: records.filter(record => record.enteredAt !== null && !blockedIds.has(record.id)), blocked: records.filter(record => blockedIds.has(record.id)) };
}

export function blockOverlappingResearch(result) {
  const reason = 'V6_OVERLAP_EXECUTION_UNSUPPORTED';
  for (const match of result.matches) Object.assign(match, { matchingStatus:'NO_MATCH', logicalTradeId:null, candidateLogicalTradeIds:[], matchingReasons:[reason] });
  for (const trade of result.researchTrades) Object.assign(trade, { matchingStatus:'NO_MATCH', logicalTradeId:null, matchingReasons:[reason], qualityStatus:'BLOCKED', qualityReasons:[reason] });
  return result;
}
