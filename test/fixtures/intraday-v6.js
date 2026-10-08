import * as v6 from '../../src/intraday-v6/model.js';
import * as v5 from '../../src/model.js';
export const T = 1_750_000_000_000;
export const clone = state => structuredClone(state);
export function ready(symbol = 'GC', direction = 'long') {
  const state = v6.createWorkspace(T);
  v6.changeStructure(state, symbol, 'bullish');
  v6.changeDirection(state, symbol, direction, T + 1);
  return state;
}
export function addTrade(state, type = 'mtf_bof', at = T + 10, symbol = 'GC') {
  const { opportunity } = v6.chooseSetup(state, symbol, type, at);
  v6.markEntered(state, opportunity.id, at + 1, true);
  return opportunity;
}
export function pair() {
  const state = ready();
  const a = addTrade(state, 'mtf_bof', T + 10), b = addTrade(state, 'mtf_bof', T + 20);
  return { state, a, b };
}
export function v5Active(stage = 'position', symbol = 'GC') {
  const state = v5.createWorkspace(T);
  v5.changeStructure(state, symbol, 'bullish', T + 1);
  v5.changeDirection(state, symbol, 'long', T + 2);
  v5.chooseSetup(state, symbol, 'htf_bof', T + 3);
  if (stage === 'position') v5.markEntered(state, symbol, T + 4, true);
  if (stage === 'signal') v5.setStage(state, symbol, 'signal', T + 4);
  return state;
}
